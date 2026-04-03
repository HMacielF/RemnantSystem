const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const cookieParser = require("cookie-parser");
const { createClient } = require("@supabase/supabase-js");
const supabase = require("./supabaseClient");

const app = express();
const port = 3000;
const loginPath = "/portal";
const managePath = "/manage";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ALLOWED_MANAGEMENT_ROLES = new Set(["super_admin", "manager", "status_user"]);

// This server is intentionally very thin:
// - it serves the static public/private HTML files
// - it handles login / logout / password-reset routes
// - it exposes the browser-safe Supabase config
// - it mounts the larger remnant API router under /api
//
// Most business logic lives in api/remnants.js. This file mainly decides
// which HTML page a visitor can reach and how browser auth cookies are used.
app.use(bodyParser.json({ limit: "20mb" }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public"), {
    setHeaders(res, filePath) {
        // HTML and JS are forced to no-store because this project evolves fast
        // and stale cached frontend code caused confusing bugs earlier,
        // especially around the public hold-request flow.
        if (/\.(html|js)$/i.test(filePath)) {
            res.setHeader("Cache-Control", "no-store, max-age=0");
        }
    },
}));

app.use("/api", require("./api/remnants"));

app.get("/auth/config.js", (_req, res) => {
    // The frontend needs the public Supabase URL + anon key for browser auth
    // flows, but it should never receive the service-role key. We generate this
    // tiny JS file dynamically so the browser can read window.__SUPABASE_CONFIG__.
    res.type("application/javascript").send(
        `window.__SUPABASE_CONFIG__ = ${JSON.stringify({
            url: SUPABASE_URL || "",
            anonKey: SUPABASE_ANON_KEY || "",
        })};`
    );
});

function getAuthedSupabase(req) {
    // Management pages keep auth in an HTTP-only cookie. When we need to query
    // Supabase as the current browser user, we create a per-request client that
    // forwards that access token. This lets RLS evaluate the user naturally.
    const token = req.cookies?.access_token;
    if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;

    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        accessToken: async () => token,
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
        },
        global: {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        },
    });
}

app.post("/forgot-password", async (req, res) => {
    // Password reset remains on the server so the reset redirect URL can be
    // generated from the current host cleanly.
    const { email } = req.body;

    if (!email) {
        return res.redirect("/error?msg=Email%20is%20required");
    }

    const redirectTo = `${req.protocol}://${req.get("host")}/set-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

    if (error) {
        return res.redirect(`/error?msg=${encodeURIComponent(error.message)}`);
    }

    res.redirect("/password-reset-sent");
});

app.post("/login", async (req, res) => {
    // Login uses Supabase email/password auth, then stores only the access
    // token in an HTTP-only cookie. The browser never needs to manage that
    // token itself for normal page access.
    const { email, password } = req.body;

    if (!email || !password) {
        return res.redirect("/error?msg=Email%20and%20password%20are%20required");
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data?.session?.access_token) {
        return res.redirect(`/error?msg=${encodeURIComponent(error?.message || "Login failed")}`);
    }

    res.cookie("access_token", data.session.access_token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 1000 * 60 * 60 * 24,
    });

    res.redirect(managePath);
});

app.get(loginPath, (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/portal.html", (_req, res) => {
    res.redirect(loginPath);
});

app.get("/forgot-password", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "forgot-password.html"));
});

app.get("/password-reset-sent", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "reset_requested.html"));
});

app.get("/set-password", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "set-password.html"));
});

app.get("/error", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "error.html"));
});

app.get(managePath, (_req, res) => {
    res.redirect("/private");
});

app.get("/private", async (req, res) => {
    // /private is the single protected HTML entry point for the management UI.
    // We verify:
    // 1. a cookie exists
    // 2. Supabase recognizes the user
    // 3. the matching profile is active
    // 4. the role is one of the management roles
    //
    // If any of those fail, we clear the cookie and bounce back to /portal.
    const token = req.cookies.access_token;
    if (!token) return res.redirect(loginPath);

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
        res.clearCookie("access_token");
        return res.redirect(loginPath);
    }

    try {
        const authedSupabase = getAuthedSupabase(req);
        if (!authedSupabase) {
            res.clearCookie("access_token");
            return res.redirect(`${loginPath}?error=missing_config`);
        }

        const { data: profile, error: profileError } = await authedSupabase
            .from("profiles")
            .select("active,system_role")
            .eq("id", data.user.id)
            .maybeSingle();

        if (
            profileError ||
            !profile ||
            profile.active !== true ||
            !ALLOWED_MANAGEMENT_ROLES.has(profile.system_role)
        ) {
            res.clearCookie("access_token");
            return res.redirect(loginPath);
        }
    } catch (_err) {
        res.clearCookie("access_token");
        return res.redirect(loginPath);
    }

    res.sendFile(path.join(__dirname, "private.html"));
});

app.get("/logout", (req, res) => {
    res.clearCookie("access_token");
    res.redirect(loginPath);
});

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get(["/quick", "/prime"], (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use("/api", (_req, res) => {
    // Unknown API routes should return JSON, not the HTML 404 page, so callers
    // like fetch()/Insomnia get a predictable response shape.
    res.status(404).json({ error: "API route not found" });
});

app.use((_req, res) => {
    // Everything else is a normal page navigation, so send the branded 404 page.
    res.status(404).sendFile(path.join(__dirname, "public", "404.html"));
});

const server = app.listen(port, () => {
    console.log(`✅ Server running at http://localhost:${port}`);
});

// Node 25 in this environment was exiting immediately after listen() in local
// development, so we keep one benign timer alive until the server closes.
const serverKeepAlive = setInterval(() => {}, 60 * 60 * 1000);

server.on("close", () => {
    clearInterval(serverKeepAlive);
});
