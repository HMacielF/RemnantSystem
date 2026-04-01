const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const cookieParser = require("cookie-parser");
const supabase = require("./supabaseClient");

const app = express();
const port = 3030;
const loginPath = "/portal";
const managePath = "/manage";

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

app.use("/api", require("./api/remnants"));

app.get("/auth/config.js", (_req, res) => {
    const publicKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || "";
    res.type("application/javascript").send(
        `window.__SUPABASE_CONFIG__ = ${JSON.stringify({
            url: process.env.SUPABASE_URL || "",
            anonKey: publicKey,
        })};`
    );
});

app.post("/forgot-password", async (req, res) => {
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
    const token = req.cookies.access_token;
    if (!token) return res.redirect(loginPath);

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
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

app.get("/:owner", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

const server = app.listen(port, () => {
    console.log(`✅ Server running at http://localhost:${port}`);
});

// Node 25 in this environment is exiting immediately after listen(),
// so keep one timer alive until the server closes.
const serverKeepAlive = setInterval(() => {}, 60 * 60 * 1000);

server.on("close", () => {
    clearInterval(serverKeepAlive);
});
