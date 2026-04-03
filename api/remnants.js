const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const supabase = require("../supabaseClient");

const router = express.Router();

// This router serves both the public inventory and the authenticated
// management workspace. The large helper layer exists so those two audiences
// can share one remnant codepath while still enforcing different permissions
// and response shapes.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "remnant-images";
const SUPABASE_HOSTNAME = (() => {
    try {
        return SUPABASE_URL ? new URL(SUPABASE_URL).hostname : null;
    } catch (_error) {
        return null;
    }
})();
const MORAWARE_HOSTNAME = (() => {
    try {
        return process.env.MORAWARE_URL ? new URL(process.env.MORAWARE_URL).hostname : null;
    } catch (_error) {
        return null;
    }
})();
const VALID_STATUSES = new Set(["available", "hold", "sold"]);
const PUBLIC_MATERIAL_ORDER = [
    "Granite",
    "Marble",
    "Porcelain",
    "Quartz",
    "Quartzite",
    "Quick Quartz",
    "Soapstone",
];
const REMNANT_SELECT = `
    id,
    moraware_remnant_id,
    company_id,
    material_id,
    thickness_id,
    name,
    width,
    height,
    l_shape,
    l_width,
    l_height,
    status,
    image,
    source_image_url,
    updated_at,
    created_at,
    company:companies(id,name),
    material:materials(id,name),
    thickness:thicknesses(id,name)
`;
const ACTIVE_REMNANT_SELECT = "*";
const HOLD_SELECT = `
    id,
    remnant_id,
    company_id,
    hold_owner_user_id,
    hold_started_at,
    expires_at,
    status,
    notes,
    project_reference,
    job_number,
    released_at,
    released_by_user_id,
    reassigned_from_user_id,
    created_at,
    updated_at,
    hold_owner:profiles!hold_owner_user_id(id,email,full_name,system_role,company_id)
`;
const SALE_SELECT = `
    id,
    remnant_id,
    company_id,
    sold_by_user_id,
    sold_at,
    job_number,
    notes,
    created_at,
    updated_at,
    sold_by_profile:profiles!sold_by_user_id(id,email,full_name,email)
`;

if (!SUPABASE_URL) {
    throw new Error("SUPABASE_URL is required");
}

if (!SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_ANON_KEY is required for authenticated app requests");
}

const serviceSupabase = SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    })
    : null;

// Client selection is one of the most important ideas in this file:
// - public reads should stay on the safe/public path
// - authenticated reads should prefer the user-scoped client
// - writes often use the service-role client after app-level permission checks
//   so the server can complete trusted workflows without being blocked by RLS
//   on every intermediate table write
function getReadClient() {
    return serviceSupabase || supabase;
}

function getPublicReadClient() {
    return supabase;
}

function getWriteClient(authedClient) {
    return serviceSupabase || authedClient;
}

function logHoldRequestDebug(step, data = {}) {
    // The public hold-request flow caused a lot of edge-case debugging because
    // it combines anonymous form posting, hidden iframe responses, and server
    // side remnant resolution. These logs stay narrowly scoped to that path.
    console.log("[hold-request]", step, data);
}

function wantsHoldRequestIframeResponse(req) {
    return String(req.body?.response_mode || "").trim().toLowerCase() === "iframe";
}

function serializeInlinePayload(payload) {
    return JSON.stringify(payload)
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/&/g, "\\u0026");
}

function sendHoldRequestResponse(req, res, statusCode, payload) {
    // Public hold requests can ask for an iframe-friendly response instead of
    // raw JSON. In that mode the API responds with a tiny HTML page that sends
    // a postMessage back to the parent window so the public page can react
    // without navigating away from the inventory grid.
    if (!wantsHoldRequestIframeResponse(req)) {
        return res.status(statusCode).json(payload);
    }

    const serializedPayload = serializeInlinePayload({
        type: "hold-request",
        ...payload,
    });
    const html = `<!doctype html>
<html lang="en">
  <body>
    <script>
      (function () {
        var payload = ${serializedPayload};
        if (window.parent && window.parent !== window) {
          window.parent.postMessage(payload, "*");
        }
      })();
    </script>
  </body>
</html>`;

    return res.status(statusCode).type("html").send(html);
}

function isPrivilegedProfile(profile) {
    return profile?.system_role === "super_admin" || profile?.system_role === "manager";
}

function isOwnCompanyStatusUser(profile, remnant) {
    return profile?.system_role === "status_user"
        && profile?.company_id !== null
        && Number(profile.company_id) === Number(remnant?.company_id);
}

function pickRelevantHold(rows) {
    // A remnant can have many historical hold records. The UI usually wants a
    // single "current" hold, and for operational purposes only active/expired
    // holds should keep influencing the card state.
    const candidates = Array.isArray(rows) ? rows : [];
    const visibleCandidates = candidates.filter((row) => ["active", "expired"].includes(String(row?.status || "").toLowerCase()));
    if (visibleCandidates.length === 0) return null;
    const priority = {
        active: 0,
        expired: 1,
    };

    return [...visibleCandidates].sort((a, b) => {
        const aPriority = priority[a.status] ?? 99;
        const bPriority = priority[b.status] ?? 99;
        if (aPriority !== bPriority) return aPriority - bPriority;
        return new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0);
    })[0] || null;
}

function formatHold(row) {
    if (!row) return null;

    return {
        ...row,
        owner_name: row.hold_owner?.full_name || row.hold_owner?.email || "",
        owner_email: row.hold_owner?.email || "",
    };
}

function formatSale(row) {
    if (!row) return null;

    return {
        ...row,
        sold_by_name: row.sold_by_profile?.full_name || row.sold_by_profile?.email || "",
    };
}

async function fetchRelevantHoldMap(client, remnantIds) {
    const ids = [...new Set((remnantIds || []).map((value) => Number(value)).filter(Boolean))];
    if (ids.length === 0) return new Map();

    const { data, error } = await client
        .from("holds")
        .select(HOLD_SELECT)
        .in("remnant_id", ids)
        .in("status", ["active", "expired", "sold", "released"])
        .order("updated_at", { ascending: false })
        .order("created_at", { ascending: false });

    if (error) throw error;

    const grouped = new Map();
    (data || []).forEach((row) => {
        const list = grouped.get(row.remnant_id) || [];
        list.push(formatHold(row));
        grouped.set(row.remnant_id, list);
    });

    const result = new Map();
    grouped.forEach((rows, remnantId) => {
        result.set(remnantId, pickRelevantHold(rows));
    });
    return result;
}

async function fetchRelevantHoldForRemnant(client, remnantId) {
    const holdMap = await fetchRelevantHoldMap(client, [remnantId]);
    return holdMap.get(Number(remnantId)) || null;
}

async function fetchLatestSaleMap(client, remnantIds) {
    // Sales are stored as separate history rows rather than being denormalized
    // fully onto remnants. The UI still wants "current sold metadata", so this
    // helper fetches the newest sale row per remnant and lets us flatten it back
    // onto the API response.
    const ids = [...new Set((remnantIds || []).map((value) => Number(value)).filter(Boolean))];
    if (ids.length === 0) return new Map();

    const { data, error } = await client
        .from("remnant_sales")
        .select(SALE_SELECT)
        .in("remnant_id", ids)
        .order("sold_at", { ascending: false })
        .order("created_at", { ascending: false });

    if (error) throw error;

    const result = new Map();
    (data || []).forEach((row) => {
        const remnantId = Number(row.remnant_id);
        if (!remnantId || result.has(remnantId)) return;
        result.set(remnantId, formatSale(row));
    });
    return result;
}

async function fetchLatestSaleForRemnant(client, remnantId) {
    const saleMap = await fetchLatestSaleMap(client, [remnantId]);
    return saleMap.get(Number(remnantId)) || null;
}

async function fetchStatusActorMap(client, remnantIds) {
    // Some permission-aware card states need to know who last changed a remnant
    // into its current status. We derive that from audit_logs instead of adding
    // another denormalized field to remnants.
    const ids = [...new Set((remnantIds || []).map((value) => Number(value)).filter(Boolean))];
    if (ids.length === 0) return new Map();

    const { data, error } = await client
        .from("audit_logs")
        .select("remnant_id,actor_user_id,actor_email,new_data,created_at")
        .eq("event_type", "remnant_status_changed")
        .in("remnant_id", ids)
        .order("created_at", { ascending: false });

    if (error) throw error;

    const result = new Map();
    (data || []).forEach((row) => {
        const remnantId = Number(row.remnant_id);
        if (!remnantId || result.has(remnantId)) return;

        const nextStatus = String(row.new_data?.status || "").trim().toLowerCase();
        result.set(remnantId, {
            status: nextStatus,
            actor_user_id: row.actor_user_id || null,
            actor_name: row.actor_email ? String(row.actor_email).split("@")[0] : "",
            actor_email: row.actor_email || "",
        });
    });

    return result;
}

function attachHoldToRows(rows, holdMap) {
    // Public rows use internal_remnant_id while private rows use id directly.
    // Every attach helper resolves against internal_remnant_id first so the
    // same card logic can work in both modes.
    return (rows || []).map((row) => ({
        ...row,
        current_hold: holdMap.get(Number(row.internal_remnant_id ?? row.id)) || null,
    }));
}

function attachSaleToRows(rows, saleMap) {
    // We keep both:
    // - current_sale: the richer raw/latest sale object
    // - flat sold_* fields: convenience values the frontend already expects
    return (rows || []).map((row) => {
        const currentSale = saleMap.get(Number(row.internal_remnant_id ?? row.id)) || null;
        return {
            ...row,
            current_sale: currentSale,
            sold_by_name: currentSale?.sold_by_name || "",
            sold_by_user_id: currentSale?.sold_by_user_id || null,
            sold_at: currentSale?.sold_at || null,
            sold_job_number: currentSale?.job_number || "",
        };
    });
}

function attachStatusMetaToRows(rows, statusActorMap) {
    return (rows || []).map((row) => ({
        ...row,
        current_status_actor: statusActorMap.get(Number(row.internal_remnant_id ?? row.id)) || null,
    }));
}

async function fetchRemnantStatusRow(client, remnantId) {
    const { data, error } = await client
        .from("remnants")
        .select("id,moraware_remnant_id,company_id,status,deleted_at,name,image,image_path")
        .eq("id", remnantId)
        .maybeSingle();

    if (error) throw error;
    return data;
}

async function resolveRemnantForPublicRequest(client, requestedId) {
    const numericId = asNumber(requestedId);
    if (!numericId) return null;

    const { data, error } = await client
        .from("remnants")
        .select("id,moraware_remnant_id,company_id,status,deleted_at,name,image,image_path")
        .or(`id.eq.${numericId},moraware_remnant_id.eq.${numericId}`)
        .is("deleted_at", null)
        .limit(5);

    if (error) throw error;

    const rows = data || [];
    return rows.find((row) => Number(row.moraware_remnant_id) === numericId)
        || rows.find((row) => Number(row.id) === numericId)
        || null;
}

function ensureHoldPermission(profile, remnant, hold) {
    // Holds are more restrictive than simple status changes:
    // - privileged roles can override
    // - status_user must belong to the same company
    // - if a hold exists, the original hold owner keeps control unless a
    //   manager/super_admin overrides it
    if (isPrivilegedProfile(profile)) return;
    if (!isOwnCompanyStatusUser(profile, remnant)) {
        throw new Error("Only the hold owner, manager, or super admin can change this held remnant");
    }
    if (hold && String(hold.hold_owner_user_id) !== String(profile.id)) {
        throw new Error("Only the original sales rep can change this held remnant");
    }
}

function validateHoldPayload(payload) {
    if (!payload.expires_at) return "Expiration date is required";
    if (!String(payload.job_number || "").trim()) return "Job number is required";
    const expiresAt = new Date(payload.expires_at);
    if (Number.isNaN(expiresAt.getTime())) return "Expiration date is invalid";
    if (expiresAt.getTime() <= Date.now()) return "Expiration date must be in the future";
    return null;
}

function defaultHoldExpirationDate() {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    return expiresAt.toISOString().slice(0, 10);
}

async function writeAuditLog(client, authed, entry) {
    // Audit logging is intentionally best-effort. We want the main business
    // action to succeed even if logging fails, but we still print server errors
    // so missing audit trails are visible during debugging.
    if (!client) return;

    const payload = {
        actor_user_id: authed?.user?.id || authed?.profile?.id || null,
        actor_email: authed?.profile?.email || authed?.user?.email || null,
        actor_role: authed?.profile?.system_role || null,
        actor_company_id: authed?.profile?.company_id || null,
        event_type: entry.event_type,
        entity_type: entry.entity_type,
        entity_id: entry.entity_id ?? null,
        remnant_id: entry.remnant_id ?? null,
        company_id: entry.company_id ?? null,
        message: entry.message ?? null,
        old_data: entry.old_data ?? null,
        new_data: entry.new_data ?? null,
        meta: entry.meta ?? null,
    };

    const { error } = await client.from("audit_logs").insert(payload);
    if (error) {
        console.error("Audit log write failed:", error);
    }
}

async function queueNotification(client, entry) {
    // Notification sending is queued instead of delivered inline so the request
    // path stays fast and a later worker/cron can send the actual emails.
    if (!client) return;

    const payload = {
        notification_type: entry.notification_type,
        target_user_id: entry.target_user_id ?? null,
        target_email: entry.target_email ?? null,
        remnant_id: entry.remnant_id ?? null,
        hold_id: entry.hold_id ?? null,
        hold_request_id: entry.hold_request_id ?? null,
        payload: entry.payload ?? {},
        scheduled_for: entry.scheduled_for ?? new Date().toISOString(),
        status: entry.status ?? "pending",
    };

    const { error } = await client.from("notification_queue").insert(payload);
    if (error) {
        console.error("Notification queue write failed:", error);
    }
}

async function cancelPendingHoldNotifications(client, holdId) {
    if (!client || !holdId) return;

    const { error } = await client
        .from("notification_queue")
        .update({ status: "cancelled" })
        .eq("hold_id", holdId)
        .eq("status", "pending");

    if (error) {
        console.error("Failed to cancel pending hold notifications:", error);
    }
}

async function scheduleHoldNotifications(client, hold) {
    if (!client || !hold?.id) return;

    const expiresAt = new Date(hold.expires_at);
    if (Number.isNaN(expiresAt.getTime())) return;

    const reminders = [
        { daysBefore: 2, notification_type: "hold_expiring_soon_2d" },
        { daysBefore: 1, notification_type: "hold_expiring_soon_1d" },
    ];

    for (const reminder of reminders) {
        const scheduledFor = new Date(expiresAt.getTime() - reminder.daysBefore * 24 * 60 * 60 * 1000);
        if (scheduledFor.getTime() > Date.now()) {
            await queueNotification(client, {
                notification_type: reminder.notification_type,
                target_user_id: hold.hold_owner_user_id,
                target_email: hold.owner_email || hold.hold_owner?.email || null,
                remnant_id: hold.remnant_id,
                hold_id: hold.id,
                scheduled_for: scheduledFor.toISOString(),
                payload: {
                    remnant_id: hold.remnant_id,
                    expires_at: hold.expires_at,
                    project_reference: hold.project_reference || null,
                    job_number: hold.job_number || null,
                },
            });
        }
    }

    await queueNotification(client, {
        notification_type: "hold_expired",
        target_user_id: hold.hold_owner_user_id,
        target_email: hold.owner_email || hold.hold_owner?.email || null,
        remnant_id: hold.remnant_id,
        hold_id: hold.id,
        scheduled_for: hold.expires_at,
        payload: {
            remnant_id: hold.remnant_id,
            expires_at: hold.expires_at,
            project_reference: hold.project_reference || null,
            job_number: hold.job_number || null,
        },
    });
}

// Convert request values into numbers when possible, but keep empty values as
// null so we can safely send them to Postgres.
function asNumber(value) {
    if (value === undefined || value === null || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

// The database stores compact lowercase statuses. This helper accepts a few
// UI-friendly variants and normalizes them before queries or writes.
function normalizeStatus(value, fallback = "available") {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "on hold") return "hold";
    if (VALID_STATUSES.has(normalized)) return normalized;
    return fallback;
}

// The frontend should not need to understand joined lookup objects every time
// it renders a card, so we flatten the common display fields here.
function formatRemnant(row) {
    // The frontend uses flat display fields constantly, so we flatten the most
    // common joined values once here instead of re-deriving them all over the UI.
    if (!row) return row;

    return {
        ...row,
        display_id: row.moraware_remnant_id || row.id,
        company_name: row.company?.name || "",
        material_name: row.material?.name || "",
        thickness_name: row.thickness?.name || "",
    };
}

function formatCompanyRemnant(row) {
    return {
        id: row.id,
        internal_remnant_id: row.internal_remnant_id ?? null,
        material: row.material || "",
        thickness: row.thickness || "",
        name: row.name,
        width: row.width,
        height: row.height,
        l_shape: row.l_shape,
        l_width: row.l_width,
        l_height: row.l_height,
        status: row.status,
        image: row.image || "",
    };
}

async function fetchPublicRemnantRowByExternalId(client, externalRemnantId) {
    const { data, error } = await client
        .from("active_remnants")
        .select(ACTIVE_REMNANT_SELECT)
        .eq("id", externalRemnantId)
        .maybeSingle();

    if (error) throw error;
    return data;
}

function escapeLikeValue(value) {
    return String(value || "").replace(/[,%]/g, "");
}

function extractRemnantIdSearch(value) {
    const trimmed = String(value || "").trim();
    const match = /^#?\s*(\d+)$/.exec(trimmed);
    return match ? Number(match[1]) : null;
}

function slugifyCompanyName(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

async function fetchLookupRows(tableName, client = getReadClient()) {
    const readClient = client;
    const { data, error } = await readClient
        .from(tableName)
        .select("id,name,active")
        .eq("active", true)
        .order("name", { ascending: true });

    if (error) throw error;
    return data || [];
}

async function fetchPublicLookupRows() {
    const readClient = getPublicReadClient();
    const { data, error } = await readClient
        .from("active_remnants")
        .select("company,material,thickness");

    if (error) throw error;

    const uniqueRows = (values) => Array.from(new Set(
        (values || [])
            .map((value) => String(value || "").trim())
            .filter(Boolean)
    ))
        .map((name) => ({ id: name, name, active: true }));

    const sortMaterials = (rows) => {
        const rank = new Map(PUBLIC_MATERIAL_ORDER.map((name, index) => [name, index]));
        return [...rows].sort((a, b) => {
            const aRank = rank.has(a.name) ? rank.get(a.name) : Number.MAX_SAFE_INTEGER;
            const bRank = rank.has(b.name) ? rank.get(b.name) : Number.MAX_SAFE_INTEGER;
            if (aRank !== bRank) return aRank - bRank;
            return a.name.localeCompare(b.name);
        });
    };

    const sortByName = (rows) => [...rows].sort((a, b) => a.name.localeCompare(b.name));

    return {
        companies: sortByName(uniqueRows((data || []).map((row) => row.company))),
        materials: sortMaterials(uniqueRows((data || []).map((row) => row.material))),
        thicknesses: sortByName(uniqueRows((data || []).map((row) => row.thickness))),
    };
}

async function fetchCompanyBySlug(companySlug, client = getReadClient()) {
    const readClient = client;
    const { data, error } = await readClient
        .from("companies")
        .select("id,name")
        .eq("active", true)
        .order("name", { ascending: true });

    if (error) throw error;

    return (data || []).find((company) => slugifyCompanyName(company.name) === companySlug) || null;
}

function excludedCompanyMaterials(companySlug) {
    if (companySlug === "quick-countertop") {
        return ["Quick Quartz"];
    }

    return [];
}

function resolveCompanySlug(companyKey) {
    const key = String(companyKey || "").trim().toLowerCase();

    if (key === "quick") return "quick-countertop";
    if (key === "prime") return "prime-countertop";

    return key;
}

function isAllowedImageProxyTarget(value) {
    try {
        const parsed = new URL(value);
        if (!["http:", "https:"].includes(parsed.protocol)) return false;
        return [SUPABASE_HOSTNAME, MORAWARE_HOSTNAME].filter(Boolean).includes(parsed.hostname);
    } catch (_error) {
        return false;
    }
}

function publicCompanyFromSlug(companySlug) {
    const normalized = resolveCompanySlug(companySlug);

    if (normalized === "quick-countertop") {
        return { slug: normalized, name: "Quick Countertop" };
    }

    if (normalized === "prime-countertop") {
        return { slug: normalized, name: "Prime Countertop" };
    }

    if (normalized === "frv") {
        return { slug: normalized, name: "FRV" };
    }

    return null;
}

function publicFeedLabel(feedKey) {
    const normalized = String(feedKey || "").trim().toLowerCase();
    if (normalized === "quick") return "Quick Countertop";
    if (normalized === "prime") return "Prime Countertop";
    if (normalized === "frv") return "FRV";
    return "Remnants";
}

async function fetchMaterialIdsByNames(names) {
    if (!Array.isArray(names) || names.length === 0) return [];

    const readClient = getReadClient();
    const { data, error } = await readClient
        .from("materials")
        .select("id,name")
        .in("name", names);

    if (error) throw error;
    return (data || []).map((row) => row.id).filter((id) => id !== null && id !== undefined);
}

function getAuthedSupabase(req) {
    const token = req.cookies?.access_token;
    if (!token) return null;

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

async function requireAuthedSupabase(req, res) {
    const token = req.cookies?.access_token;
    if (!token) {
        res.status(401).json({ error: "Not authenticated" });
        return null;
    }

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
        res.clearCookie("access_token");
        res.status(401).json({ error: "Invalid session" });
        return null;
    }

    return {
        client: getAuthedSupabase(req),
        user: data.user,
    };
}

async function getOptionalAuthedSupabase(req) {
    const token = req.cookies?.access_token;
    if (!token) return null;

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;

    return {
        client: getAuthedSupabase(req),
        user: data.user,
    };
}

async function fetchProfile(client, userId) {
    const { data, error } = await client
        .from("profiles")
        .select("id,email,full_name,system_role,company_id,active")
        .eq("id", userId)
        .maybeSingle();

    if (error) throw error;
    return data;
}

async function fetchSalesRepRows(client = getReadClient()) {
    const { data, error } = await client
        .from("profiles")
        .select("id,email,full_name,system_role,company_id")
        .eq("active", true)
        .order("full_name", { ascending: true });

    if (error) throw error;
    return (data || []).map((row) => ({
        ...row,
        display_name: row.full_name || row.email || "User",
    }));
}

// Every privileged route first checks the authenticated user, then confirms
// their profile row is active and allowed for the requested action.
async function requireActiveProfile(req, res, allowedRoles = []) {
    const authed = await requireAuthedSupabase(req, res);
    if (!authed) return null;

    const profile = await fetchProfile(authed.client, authed.user.id);
    if (!profile) {
        res.status(403).json({ error: "Profile not found" });
        return null;
    }

    if (profile.active !== true) {
        res.status(403).json({ error: "Your account is inactive" });
        return null;
    }

    if (allowedRoles.length > 0 && !allowedRoles.includes(profile.system_role)) {
        res.status(403).json({
            error: `Only ${allowedRoles.join(" or ")} can perform this action`,
        });
        return null;
    }

    return {
        ...authed,
        profile,
    };
}

async function fetchNextStoneId(client = getReadClient()) {
    const readClient = client;
    const { data, error } = await readClient
        .from("remnants")
        .select("moraware_remnant_id")
        .not("moraware_remnant_id", "is", null)
        .order("moraware_remnant_id", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) throw error;
    return (data?.moraware_remnant_id || 0) + 1;
}

// The status chips in the UI should reflect the whole active inventory, not
// just the currently filtered card set. This helper returns a compact summary
// that can be reused by both the public and management pages.
async function fetchInventorySummary(client = getPublicReadClient(), source = "active_remnants") {
    const readClient = client;
    const { data, error } = await readClient
        .from(source)
        .select("status")

    if (error) throw error;

    return (data || []).reduce((acc, row) => {
        const status = normalizeStatus(row?.status, "available");
        acc.total += 1;
        acc[status] += 1;
        return acc;
    }, {
        total: 0,
        available: 0,
        hold: 0,
        sold: 0,
    });
}

function normalizePayload(body) {
    const parsed = {
        name: body.name ? String(body.name).trim() : "",
        moraware_remnant_id: asNumber(body.moraware_remnant_id ?? body.external_id),
        company_id: asNumber(body.company_id),
        material_id: asNumber(body.material_id),
        thickness_id: asNumber(body.thickness_id),
        width: asNumber(body.width),
        height: asNumber(body.height),
        l_shape: Boolean(body.l_shape),
        l_width: asNumber(body.l_width),
        l_height: asNumber(body.l_height),
        status: normalizeStatus(body.status),
    };

    if (!parsed.l_shape) {
        parsed.l_width = null;
        parsed.l_height = null;
    }

    return parsed;
}

function validateRemnantPayload(payload) {
    if (!payload.name || !payload.company_id || !payload.material_id || !payload.thickness_id) {
        return "Company, material, thickness, and stone name are required";
    }

    if (!payload.width || !payload.height) {
        return "Width and height are required";
    }

    return null;
}

function parseDataUrl(dataUrl) {
    const match = /^data:(.+);base64,(.+)$/.exec(dataUrl || "");
    if (!match) return null;

    return {
        contentType: match[1],
        buffer: Buffer.from(match[2], "base64"),
    };
}

function extensionForType(contentType, fallbackName = "") {
    const fileExt = fallbackName.includes(".") ? fallbackName.split(".").pop() : "";
    if (fileExt) return fileExt.toLowerCase();

    const map = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/gif": "gif",
    };

    return map[contentType] || "jpg";
}

function cleanPathSegment(value, fallback = "file") {
    const cleaned = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "");

    return cleaned || fallback;
}

function buildImagePath(imageKey, ext) {
    return `remnant_${cleanPathSegment(imageKey)}.${ext}`;
}

async function uploadImageIfPresent(client, imageKey, imageFile) {
    if (!imageFile?.dataUrl) return null;

    const parsed = parseDataUrl(imageFile.dataUrl);
    if (!parsed) {
        throw new Error("Invalid image upload format");
    }

    const ext = extensionForType(parsed.contentType, imageFile.name);
    const imagePath = buildImagePath(imageKey, ext);

    const { error: uploadError } = await client.storage.from(SUPABASE_BUCKET).upload(
        imagePath,
        parsed.buffer,
        {
            contentType: parsed.contentType,
            upsert: true,
        }
    );

    if (uploadError) throw uploadError;

    const { data } = client.storage.from(SUPABASE_BUCKET).getPublicUrl(imagePath);
    return {
        image: data.publicUrl,
        image_path: imagePath,
    };
}

async function handleRemnantFilter(req, res) {
    // /api/remnants is shared by:
    // - the public inventory page
    // - the private management workspace
    //
    // The route intentionally branches:
    // - authenticated callers read from the real remnants table
    // - public callers read from the active_remnants public view
    //
    // After the base query, we attach extra derived state like current_hold,
    // latest sale metadata, and latest status actor so the frontend can stay
    // simpler and mostly render whatever this route returns.
    const materialFiltersRaw = req.query.material;
    const materialFilters = Array.isArray(materialFiltersRaw) ? materialFiltersRaw : materialFiltersRaw ? [materialFiltersRaw] : [];
    const materialIds = materialFilters
        .map(asNumber)
        .filter((value) => value !== null);
    const materialNames = materialFilters
        .map((value) => String(value || "").trim())
        .filter((value) => value && asNumber(value) === null);
    const stone = (req.query.stone || "").trim();
    const stoneLike = escapeLikeValue(stone);
    const searchedRemnantId = extractRemnantIdSearch(stone);
    const status = normalizeStatus(req.query.status, "");
    const minWidth = asNumber(req.query["min-width"] ?? req.query.minWidth);
    const minHeight = asNumber(req.query["min-height"] ?? req.query.minHeight);

    try {
        const optionalAuthed = await getOptionalAuthedSupabase(req);

        if (optionalAuthed) {
            let query = optionalAuthed.client
                .from("remnants")
                .select(REMNANT_SELECT)
                .is("deleted_at", null)
                .order("moraware_remnant_id", { ascending: true, nullsFirst: false })
                .order("id", { ascending: true });

            if (materialIds.length > 0) query = query.in("material_id", materialIds);
            if (stone && searchedRemnantId !== null) {
                query = query.or(`name.ilike.%${stoneLike}%,moraware_remnant_id.eq.${searchedRemnantId}`);
            } else if (stone) {
                query = query.ilike("name", `%${stoneLike}%`);
            }
            if (status) query = query.eq("status", status);
            if (minWidth !== null) query = query.gte("width", minWidth);
            if (minHeight !== null) query = query.gte("height", minHeight);

            const { data, error } = await query;
            if (error) throw error;
            const remnantIds = (data || []).map((row) => row.id);
            const writeClient = getWriteClient(optionalAuthed.client);
            const holdMap = await fetchRelevantHoldMap(writeClient, remnantIds);
            const saleMap = await fetchLatestSaleMap(writeClient, remnantIds);
            const statusActorMap = await fetchStatusActorMap(writeClient, remnantIds);
            return res.status(200).json(
                attachStatusMetaToRows(
                    attachSaleToRows(
                        attachHoldToRows((data || []).map(formatRemnant), holdMap),
                        saleMap
                    ),
                    statusActorMap
                )
            );
        }

        const readClient = getPublicReadClient();
        let query = readClient
            .from("active_remnants")
            .select(ACTIVE_REMNANT_SELECT)
            .not("material", "eq", "Quick Quartz")
            .order("id", { ascending: true });

        if (materialNames.length > 0) {
            query = query.in("material", materialNames);
        } else if (materialIds.length > 0) {
            const materials = await fetchLookupRows("materials");
            const selectedNames = materials
                .filter((row) => materialIds.includes(row.id))
                .map((row) => row.name);
            if (selectedNames.length > 0) query = query.in("material", selectedNames);
        }
        if (stone && searchedRemnantId !== null) {
            query = query.or(`name.ilike.%${stoneLike}%,id.eq.${searchedRemnantId}`);
        } else if (stone) {
            query = query.ilike("name", `%${stoneLike}%`);
        }
        if (status) query = query.eq("status", status);
        if (minWidth !== null) query = query.gte("width", minWidth);
        if (minHeight !== null) query = query.gte("height", minHeight);

        const { data, error } = await query;
        if (error) throw error;
        const remnantIds = (data || []).map((row) => row.internal_remnant_id ?? row.id);
        const holdMap = await fetchRelevantHoldMap(getReadClient(), remnantIds);
        const saleMap = await fetchLatestSaleMap(getReadClient(), remnantIds);
        res.status(200).json(attachSaleToRows(attachHoldToRows((data || []).map((row) => ({
            ...row,
            display_id: row.id,
            internal_remnant_id: row.internal_remnant_id ?? null,
            company_name: row.company || "",
            material_name: row.material || "",
            thickness_name: row.thickness || "",
        })), holdMap), saleMap));
    } catch (err) {
        console.error("Error filtering remnants:", err);
        res.status(500).json({
            error: "Failed to filter remnants",
            details: err?.message || String(err),
        });
    }
}

router.get("/remnants", handleRemnantFilter);

async function handleAllPublicRemnants(req, res) {
    const materialFiltersRaw = req.query.material;
    const materialFilters = Array.isArray(materialFiltersRaw) ? materialFiltersRaw : materialFiltersRaw ? [materialFiltersRaw] : [];
    const materialNames = materialFilters
        .map((value) => String(value || "").trim())
        .filter(Boolean);
    const stone = (req.query.stone || "").trim();
    const stoneLike = escapeLikeValue(stone);
    const searchedRemnantId = extractRemnantIdSearch(stone);
    const status = normalizeStatus(req.query.status, "");
    const minWidth = asNumber(req.query["min-width"] ?? req.query.minWidth);
    const minHeight = asNumber(req.query["min-height"] ?? req.query.minHeight);

    try {
        let query = getPublicReadClient()
            .from("active_remnants")
            .select(ACTIVE_REMNANT_SELECT)
            .order("id", { ascending: true });

        if (materialNames.length > 0) query = query.in("material", materialNames);
        if (stone && searchedRemnantId !== null) {
            query = query.or(`name.ilike.%${stoneLike}%,id.eq.${searchedRemnantId}`);
        } else if (stone) {
            query = query.ilike("name", `%${stoneLike}%`);
        }
        if (status) query = query.eq("status", status);
        if (minWidth !== null) query = query.gte("width", minWidth);
        if (minHeight !== null) query = query.gte("height", minHeight);

        const { data, error } = await query;
        if (error) throw error;
        const remnantIds = (data || []).map((row) => row.internal_remnant_id ?? row.id);
        const holdMap = await fetchRelevantHoldMap(getReadClient(), remnantIds);
        const saleMap = await fetchLatestSaleMap(getReadClient(), remnantIds);
        res.status(200).json(attachSaleToRows(attachHoldToRows((data || []).map((row) => ({
            ...row,
            display_id: row.id,
            internal_remnant_id: row.internal_remnant_id ?? null,
            company_name: row.company || "",
            material_name: row.material || "",
            thickness_name: row.thickness || "",
        })), holdMap), saleMap));
    } catch (err) {
        console.error("Error loading all public remnants:", err);
        res.status(500).json({
            error: "Failed to load all public remnants",
            details: err?.message || String(err),
        });
    }
}

router.get("/remnants/all", handleAllPublicRemnants);

async function handleCompanyRemnants(req, res) {
    const companySlug = resolveCompanySlug(req.params.companySlug || req.params.companyKey);
    const materialFiltersRaw = req.query.material;
    const materialFilters = Array.isArray(materialFiltersRaw) ? materialFiltersRaw : materialFiltersRaw ? [materialFiltersRaw] : [];
    const materialIds = materialFilters
        .map(asNumber)
        .filter((value) => value !== null);
    const materialNames = materialFilters
        .map((value) => String(value || "").trim())
        .filter((value) => value && asNumber(value) === null);
    const stone = (req.query.stone || "").trim();
    const stoneLike = escapeLikeValue(stone);
    const searchedRemnantId = extractRemnantIdSearch(stone);
    const status = normalizeStatus(req.query.status, "");
    const minWidth = asNumber(req.query["min-width"] ?? req.query.minWidth);
    const minHeight = asNumber(req.query["min-height"] ?? req.query.minHeight);

    try {
        const company = publicCompanyFromSlug(companySlug) || await fetchCompanyBySlug(companySlug);
        if (!company) {
            return res.status(404).json({ error: "Company not found" });
        }

        const excludedMaterials = excludedCompanyMaterials(companySlug);

        const readClient = getPublicReadClient();
        let query = readClient
            .from("active_remnants")
            .select(ACTIVE_REMNANT_SELECT)
            .eq("company", company.name)
            .order("id", { ascending: true });

        if (materialNames.length > 0) {
            query = query.in("material", materialNames);
        } else if (materialIds.length > 0) {
            const materials = await fetchLookupRows("materials");
            const selectedNames = materials
                .filter((row) => materialIds.includes(row.id))
                .map((row) => row.name);
            if (selectedNames.length > 0) query = query.in("material", selectedNames);
        }
        if (excludedMaterials.length > 0) query = query.not("material", "in", `(${excludedMaterials.map((name) => `"${name}"`).join(",")})`);
        if (stone && searchedRemnantId !== null) {
            query = query.or(`name.ilike.%${stoneLike}%,id.eq.${searchedRemnantId}`);
        } else if (stone) {
            query = query.ilike("name", `%${stoneLike}%`);
        }
        if (status) query = query.eq("status", status);
        if (minWidth !== null) query = query.gte("width", minWidth);
        if (minHeight !== null) query = query.gte("height", minHeight);

        const { data, error } = await query;
        if (error) throw error;
        const remnantIds = (data || []).map((row) => row.internal_remnant_id ?? row.id);
        const holdMap = await fetchRelevantHoldMap(getReadClient(), remnantIds);
        const saleMap = await fetchLatestSaleMap(getReadClient(), remnantIds);
        res.status(200).json({
            company: company.name,
            remnants: attachSaleToRows(attachHoldToRows((data || []).map(formatCompanyRemnant), holdMap), saleMap),
        });
    } catch (err) {
        console.error("Error filtering company remnants:", err);
        res.status(500).json({
            error: "Failed to filter company remnants",
            details: err?.message || String(err),
        });
    }
}

async function handleNamedPublicFeed(req, res) {
    const feedKey = String(req.params.feedKey || "").trim().toLowerCase();
    const materialFiltersRaw = req.query.material;
    const materialFilters = Array.isArray(materialFiltersRaw) ? materialFiltersRaw : materialFiltersRaw ? [materialFiltersRaw] : [];
    const materialNames = materialFilters
        .map((value) => String(value || "").trim())
        .filter(Boolean);
    const stone = (req.query.stone || "").trim();
    const stoneLike = escapeLikeValue(stone);
    const searchedRemnantId = extractRemnantIdSearch(stone);
    const status = normalizeStatus(req.query.status, "");
    const minWidth = asNumber(req.query["min-width"] ?? req.query.minWidth);
    const minHeight = asNumber(req.query["min-height"] ?? req.query.minHeight);

    try {
        let query = getPublicReadClient()
            .from("active_remnants")
            .select(ACTIVE_REMNANT_SELECT)
            .order("id", { ascending: true });

        if (feedKey === "quick") {
            query = query.eq("company", "Quick Countertop");
            query = query.not("material", "eq", "Quick Quartz");
        } else if (feedKey === "prime") {
            query = query.eq("company", "Prime Countertop");
        } else if (feedKey === "frv") {
            query = query.eq("company", "FRV");
        } else {
            return res.status(404).json({ error: "Feed not found" });
        }

        if (materialNames.length > 0) query = query.in("material", materialNames);
        if (stone && searchedRemnantId !== null) {
            query = query.or(`name.ilike.%${stoneLike}%,id.eq.${searchedRemnantId}`);
        } else if (stone) {
            query = query.ilike("name", `%${stoneLike}%`);
        }
        if (status) query = query.eq("status", status);
        if (minWidth !== null) query = query.gte("width", minWidth);
        if (minHeight !== null) query = query.gte("height", minHeight);

        const { data, error } = await query;
        if (error) throw error;
        const holdMap = await fetchRelevantHoldMap(getReadClient(), (data || []).map((row) => row.internal_remnant_id ?? row.id));
        res.status(200).json({
            company: publicFeedLabel(feedKey),
            remnants: attachHoldToRows((data || []).map(formatCompanyRemnant), holdMap),
        });
    } catch (err) {
        console.error("Error loading named public remnant feed:", err);
        res.status(500).json({
            error: "Failed to load remnant feed",
            details: err?.message || String(err),
        });
    }
}

router.get("/companies/:companySlug/remnants", handleCompanyRemnants);
router.get("/remnants/company/:companySlug", handleCompanyRemnants);
router.get("/remnants/quick", (req, res) => {
    req.params.feedKey = "quick";
    return handleNamedPublicFeed(req, res);
});
router.get("/remnants/prime", (req, res) => {
    req.params.feedKey = "prime";
    return handleNamedPublicFeed(req, res);
});
router.get("/remnants/frv", (req, res) => {
    req.params.feedKey = "frv";
    return handleNamedPublicFeed(req, res);
});
router.get("/quick/remnants", (req, res) => {
    req.params.feedKey = "quick";
    return handleNamedPublicFeed(req, res);
});
router.get("/prime/remnants", (req, res) => {
    req.params.feedKey = "prime";
    return handleNamedPublicFeed(req, res);
});

router.get("/remnants/summary", async (_req, res) => {
    try {
        const summary = await fetchInventorySummary();
        res.json(summary);
    } catch (err) {
        console.error("Error loading remnant summary:", err);
        res.status(500).json({ error: err.message || "Failed to load remnant summary" });
    }
});

router.get("/image-proxy", async (req, res) => {
    const target = String(req.query.url || "").trim();

    if (!target || !isAllowedImageProxyTarget(target)) {
        return res.status(400).json({ error: "Invalid image URL" });
    }

    try {
        const response = await fetch(target);
        if (!response.ok) {
            return res.status(response.status).json({ error: "Failed to fetch image" });
        }

        const contentType = response.headers.get("content-type") || "image/jpeg";
        const arrayBuffer = await response.arrayBuffer();

        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", "public, max-age=300");
        res.send(Buffer.from(arrayBuffer));
    } catch (err) {
        console.error("Error proxying image:", err);
        res.status(500).json({ error: "Failed to proxy image" });
    }
});

router.get("/lookups", async (_req, res) => {
    try {
        const optionalAuthed = await getOptionalAuthedSupabase(_req);
        const lookupPayload = optionalAuthed
            ? await Promise.all([
                fetchLookupRows("companies", optionalAuthed.client),
                fetchLookupRows("materials", optionalAuthed.client),
                fetchLookupRows("thicknesses", optionalAuthed.client),
            ]).then(([companies, materials, thicknesses]) => ({
                companies,
                materials,
                thicknesses,
            }))
            : await fetchPublicLookupRows();

        res.json(lookupPayload);
    } catch (err) {
        console.error("Error loading lookups:", err);
        res.status(500).json({ error: err.message || "Failed to load lookups" });
    }
});

router.get("/me", async (req, res) => {
    const authed = await requireAuthedSupabase(req, res);
    if (!authed) return;

    try {
        const profile = await fetchProfile(authed.client, authed.user.id);
        res.json({ profile });
    } catch (err) {
        console.error("Error loading profile:", err);
        res.status(500).json({ error: err.message || "Failed to load profile" });
    }
});

router.get("/sales-reps", async (req, res) => {
    const authed = await requireActiveProfile(req, res, ["super_admin", "manager", "status_user"]);
    if (!authed) return;

    try {
        const rows = await fetchSalesRepRows(getWriteClient(authed.client));
        res.json(rows);
    } catch (err) {
        console.error("Error loading sales reps:", err);
        res.status(500).json({ error: err.message || "Failed to load sales reps" });
    }
});

router.get("/public/sales-reps", async (_req, res) => {
    try {
        const rows = await fetchSalesRepRows(getReadClient());
        res.json(rows.map((row) => ({
            id: row.id,
            full_name: row.full_name,
            display_name: row.display_name,
            company_id: row.company_id,
        })));
    } catch (err) {
        console.error("Error loading public sales reps:", err);
        res.status(500).json({ error: err.message || "Failed to load public sales reps" });
    }
});

router.get("/debug/auth-check", async (req, res) => {
    const authed = await requireAuthedSupabase(req, res);
    if (!authed) return;

    try {
        const profile = await fetchProfile(authed.client, authed.user.id);
        res.json({
            auth_user_id: authed.user.id,
            auth_email: authed.user.email || null,
            profile: profile || null,
        });
    } catch (err) {
        console.error("Error loading auth debug info:", err);
        res.status(500).json({ error: err.message || "Failed to load auth debug info" });
    }
});

router.get("/hold-requests", async (req, res) => {
    const authed = await requireActiveProfile(req, res, ["super_admin", "manager", "status_user"]);
    if (!authed) return;

    try {
        const limit = Math.min(asNumber(req.query.limit) || 100, 300);
        let query = getWriteClient(authed.client)
            .from("hold_requests")
            .select(`
                *,
                remnant:remnants!remnant_id(id,moraware_remnant_id,name,status),
                sales_rep:profiles!sales_rep_user_id(id,email,full_name),
                reviewed_by:profiles!reviewed_by_user_id(id,email,full_name)
            `)
            .order("created_at", { ascending: false })
            .limit(limit);

        const status = String(req.query.status || "").trim();
        if (status) query = query.eq("status", status);
        if (authed.profile.system_role === "status_user") {
            query = query.eq("sales_rep_user_id", authed.profile.id);
        }

        const { data, error } = await query;
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        console.error("Error loading hold requests:", err);
        res.status(500).json({ error: err.message || "Failed to load hold requests" });
    }
});

router.post("/hold-requests", async (req, res) => {
    try {
        logHoldRequestDebug("incoming", {
            body: {
                remnant_id: req.body?.remnant_id ?? null,
                external_remnant_id: req.body?.external_remnant_id ?? null,
                requester_name: req.body?.requester_name ?? null,
                requester_email: req.body?.requester_email ?? null,
                sales_rep_user_id: req.body?.sales_rep_user_id ?? null,
                project_reference: req.body?.project_reference ?? null,
                notes_present: Boolean(String(req.body?.notes || "").trim()),
            },
            has_service_role: Boolean(serviceSupabase),
        });

        if (!serviceSupabase) {
            return sendHoldRequestResponse(req, res, 500, {
                error: "Public hold requests require SUPABASE_SERVICE_ROLE_KEY on the server",
            });
        }

        const writeClient = serviceSupabase;
        const internalRemnantId = asNumber(req.body.remnant_id ?? req.body.internal_remnant_id);
        const externalRemnantId = asNumber(req.body.external_remnant_id ?? req.body.remnant_id);
        const requesterName = String(req.body.requester_name || req.body.name || "").trim();
        const requesterEmail = String(req.body.requester_email || req.body.email || "").trim();
        const salesRepUserId = req.body.sales_rep_user_id
            ? String(req.body.sales_rep_user_id).trim()
            : req.body.sales_rep_id
                ? String(req.body.sales_rep_id).trim()
                : null;
        const salesRepName = String(req.body.sales_rep_name || "").trim();

        const missingFields = [];
        if (!externalRemnantId) missingFields.push("external_remnant_id (or remnant_id)");
        if (!requesterName) missingFields.push("requester_name");
        if (!requesterEmail) missingFields.push("requester_email");

        if (missingFields.length > 0) {
            logHoldRequestDebug("validation-failed", {
                internalRemnantId,
                externalRemnantId,
                requesterNamePresent: Boolean(requesterName),
                requesterEmailPresent: Boolean(requesterEmail),
                missingFields,
            });
            return sendHoldRequestResponse(req, res, 400, {
                error: "Missing required fields",
                missing_fields: missingFields,
            });
        }

        let resolvedRemnant = null;
        if (internalRemnantId) {
            resolvedRemnant = await fetchRemnantStatusRow(writeClient, internalRemnantId);
        }
        if (!resolvedRemnant && externalRemnantId) {
            resolvedRemnant = await resolveRemnantForPublicRequest(writeClient, externalRemnantId);
        }

        logHoldRequestDebug("resolved-remnant", {
            internal_requested_id: internalRemnantId,
            external_requested_id: externalRemnantId,
            remnant: resolvedRemnant ? {
                id: resolvedRemnant.id,
                moraware_remnant_id: resolvedRemnant.moraware_remnant_id ?? null,
                company_id: resolvedRemnant.company_id ?? null,
                status: resolvedRemnant.status ?? null,
                deleted_at: resolvedRemnant.deleted_at ?? null,
            } : null,
        });
        if (!resolvedRemnant || resolvedRemnant.deleted_at) {
            return sendHoldRequestResponse(req, res, 404, { error: "Remnant not found" });
        }
        if (resolvedRemnant.status === "sold") {
            return sendHoldRequestResponse(req, res, 400, {
                error: "Sold remnants cannot receive hold requests",
            });
        }

        const insertPayload = {
            remnant_id: resolvedRemnant.id,
            company_id: resolvedRemnant.company_id || null,
            requester_name: requesterName,
            requester_email: requesterEmail,
            sales_rep_user_id: salesRepUserId || null,
            sales_rep_name: salesRepName || null,
            project_reference: String(req.body.project_reference || "").trim() || null,
            notes: String(req.body.notes || "").trim() || null,
            job_number: String(req.body.job_number || "").trim() || null,
            status: "pending",
        };
        logHoldRequestDebug("insert-payload", insertPayload);

        const { error } = await writeClient
            .from("hold_requests")
            .insert(insertPayload);

        if (error) {
            logHoldRequestDebug("insert-error", error);
            throw error;
        }

        logHoldRequestDebug("insert-success", {
            remnant_id: insertPayload.remnant_id,
            company_id: insertPayload.company_id,
            sales_rep_user_id: insertPayload.sales_rep_user_id,
        });

        try {
            await queueNotification(writeClient, {
                notification_type: "hold_request_created",
                target_user_id: salesRepUserId || null,
                remnant_id: resolvedRemnant.id,
                hold_request_id: null,
                payload: {
                    requester_name: requesterName,
                    requester_email: requesterEmail,
                    project_reference: insertPayload.project_reference,
                    job_number: insertPayload.job_number,
                },
            });
            logHoldRequestDebug("notification-sidecar-success");
        } catch (sidecarError) {
            console.error("Hold request notification sidecar failed:", sidecarError);
        }

        try {
            await writeAuditLog(writeClient, null, {
                event_type: "hold_request_created",
                entity_type: "hold_request",
                entity_id: null,
                remnant_id: resolvedRemnant.id,
                company_id: resolvedRemnant.company_id || null,
                message: `Created public hold request for remnant #${externalRemnantId}`,
                new_data: insertPayload,
                meta: {
                    source: "public",
                    external_remnant_id: externalRemnantId,
                    requester_name: requesterName,
                    requester_email: requesterEmail,
                },
            });
            logHoldRequestDebug("audit-sidecar-success");
        } catch (sidecarError) {
            console.error("Hold request audit sidecar failed:", sidecarError);
        }

        logHoldRequestDebug("response-success");
        return sendHoldRequestResponse(req, res, 201, { success: true });
    } catch (err) {
        console.error("Error creating hold request:", err);
        return sendHoldRequestResponse(req, res, 500, {
            error: err.message || "Failed to create hold request",
        });
    }
});

router.patch("/hold-requests/:id", async (req, res) => {
    const authed = await requireActiveProfile(req, res, ["super_admin", "manager", "status_user"]);
    if (!authed) return;

    try {
        const requestId = asNumber(req.params.id);
        if (!requestId) return res.status(400).json({ error: "Invalid hold request id" });

        const status = String(req.body.status || "").trim().toLowerCase();
        if (!["pending", "approved", "rejected", "cancelled"].includes(status)) {
            return res.status(400).json({ error: "Invalid hold request status" });
        }

        const writeClient = getWriteClient(authed.client);
        const { data: existingRequest, error: requestError } = await writeClient
            .from("hold_requests")
            .select("*")
            .eq("id", requestId)
            .maybeSingle();

        if (requestError) throw requestError;
        if (!existingRequest) return res.status(404).json({ error: "Hold request not found" });
        if (authed.profile.system_role === "status_user" && String(existingRequest.sales_rep_user_id || "") !== String(authed.profile.id)) {
            return res.status(403).json({ error: "You can only review your own hold requests" });
        }

        if (status === "approved") {
            // A hold request is only an intake record. Approval is the moment it
            // turns into a real hold row and actually reserves the remnant.
            const remnant = await fetchRemnantStatusRow(writeClient, existingRequest.remnant_id);
            if (!remnant || remnant.deleted_at) {
                return res.status(404).json({ error: "Remnant not found" });
            }
            if (String(remnant.status || "").toLowerCase() === "sold") {
                return res.status(400).json({ error: "Sold remnants cannot be placed on hold" });
            }
            const currentHold = await fetchRelevantHoldForRemnant(writeClient, existingRequest.remnant_id);
            if (currentHold && ["active", "expired"].includes(String(currentHold.status || "").toLowerCase())) {
                return res.status(400).json({ error: "This remnant already has a hold" });
            }

            const jobNumber = String(req.body.job_number || existingRequest.job_number || "").trim();
            if (!jobNumber) {
                return res.status(400).json({ error: "Job number is required to approve a hold request" });
            }

            const holdPayload = {
                expires_at: defaultHoldExpirationDate(),
                project_reference: String(req.body.project_reference || existingRequest.project_reference || "").trim() || null,
                job_number: jobNumber,
                notes: String(req.body.notes || existingRequest.notes || "").trim() || null,
            };
            const validationError = validateHoldPayload(holdPayload);
            if (validationError) return res.status(400).json({ error: validationError });

            const holdOwnerUserId = existingRequest.sales_rep_user_id || authed.profile.id;
            const { data: holdData, error: holdError } = await writeClient
                .from("holds")
                .insert({
                    remnant_id: existingRequest.remnant_id,
                    company_id: existingRequest.company_id,
                    hold_owner_user_id: holdOwnerUserId,
                    hold_started_at: new Date().toISOString(),
                    expires_at: holdPayload.expires_at,
                    status: "active",
                    notes: holdPayload.notes,
                    project_reference: holdPayload.project_reference,
                    job_number: holdPayload.job_number,
                })
                .select(HOLD_SELECT)
                .single();

            if (holdError) throw holdError;

            await writeClient
                .from("remnants")
                .update({ status: "hold" })
                .eq("id", existingRequest.remnant_id);

            const holdRow = formatHold(holdData);
            await cancelPendingHoldNotifications(writeClient, holdRow.id);
            await scheduleHoldNotifications(writeClient, holdRow);
            await writeAuditLog(writeClient, authed, {
                event_type: "hold_created",
                entity_type: "hold",
                entity_id: holdRow.id,
                remnant_id: existingRequest.remnant_id,
                company_id: existingRequest.company_id,
                message: `Approved hold request #${existingRequest.id} and created hold`,
                new_data: holdRow,
                meta: {
                    source: "hold_request_approval",
                    hold_request_id: existingRequest.id,
                },
            });
        }

        const { data, error } = await writeClient
            .from("hold_requests")
            .update({
                status,
                reviewed_at: new Date().toISOString(),
                reviewed_by_user_id: authed.profile.id,
                job_number: String(req.body.job_number || existingRequest.job_number || "").trim() || null,
            })
            .eq("id", requestId)
            .select("*")
            .maybeSingle();

        if (error) throw error;
        if (!data) return res.status(404).json({ error: "Hold request not found" });

        await writeAuditLog(writeClient, authed, {
            event_type: "hold_request_reviewed",
            entity_type: "hold_request",
            entity_id: data.id,
            remnant_id: data.remnant_id,
            company_id: data.company_id,
            message: `Marked hold request #${data.id} as ${status}`,
            new_data: data,
            meta: {
                source: "api",
                action: "hold_request_review",
                override: true,
            },
        });

        res.json(data);
    } catch (err) {
        console.error("Error updating hold request:", err);
        res.status(500).json({ error: err.message || "Failed to update hold request" });
    }
});

router.get("/audit-logs", async (req, res) => {
    const authed = await requireActiveProfile(req, res, ["super_admin"]);
    if (!authed) return;

    try {
        const limit = Math.min(asNumber(req.query.limit) || 50, 200);
        const writeClient = getWriteClient(authed.client);
        let query = writeClient
            .from("audit_logs")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(limit);

        const remnantId = asNumber(req.query.remnant_id);
        if (remnantId) query = query.eq("remnant_id", remnantId);

        const eventType = String(req.query.event_type || "").trim();
        if (eventType) query = query.eq("event_type", eventType);

        const { data, error } = await query;
        if (error) throw error;

        res.json(data || []);
    } catch (err) {
        console.error("Error loading audit logs:", err);
        res.status(500).json({ error: err.message || "Failed to load audit logs" });
    }
});

router.get("/remnants/:id/hold", async (req, res) => {
    const authed = await requireActiveProfile(req, res, ["super_admin", "manager", "status_user"]);
    if (!authed) return;

    try {
        const remnantId = asNumber(req.params.id);
        if (!remnantId) return res.status(400).json({ error: "Invalid remnant id" });

        const remnant = await fetchRemnantStatusRow(getWriteClient(authed.client), remnantId);
        if (!remnant) return res.status(404).json({ error: "Remnant not found" });

        const hold = await fetchRelevantHoldForRemnant(getWriteClient(authed.client), remnantId);
        res.json({ hold });
    } catch (err) {
        console.error("Error loading remnant hold:", err);
        res.status(500).json({ error: err.message || "Failed to load remnant hold" });
    }
});

router.post("/remnants/:id/hold", async (req, res) => {
    const authed = await requireActiveProfile(req, res, ["super_admin", "manager", "status_user"]);
    if (!authed) return;

    try {
        const writeClient = getWriteClient(authed.client);
        const remnantId = asNumber(req.params.id);
        if (!remnantId) return res.status(400).json({ error: "Invalid remnant id" });

        const remnant = await fetchRemnantStatusRow(writeClient, remnantId);
        if (!remnant || remnant.deleted_at) {
            return res.status(404).json({ error: "Remnant not found" });
        }

        const currentHold = await fetchRelevantHoldForRemnant(writeClient, remnantId);
        if (!isPrivilegedProfile(authed.profile) && !isOwnCompanyStatusUser(authed.profile, remnant)) {
            return res.status(403).json({ error: "Not allowed to place a hold on this remnant" });
        }

        const requestedOwnerUserId = req.body.hold_owner_user_id
            ? String(req.body.hold_owner_user_id).trim()
            : authed.profile.id;
        const holdPayload = {
            expires_at: String(req.body.expires_at || "").trim() || defaultHoldExpirationDate(),
            notes: String(req.body.notes || "").trim() || null,
            project_reference: String(req.body.project_reference || "").trim() || null,
            job_number: String(req.body.job_number || "").trim() || null,
        };
        const validationError = validateHoldPayload(holdPayload);
        if (validationError) return res.status(400).json({ error: validationError });

        if (!isPrivilegedProfile(authed.profile) && requestedOwnerUserId !== authed.profile.id) {
            return res.status(403).json({ error: "You can only create holds for yourself" });
        }

        const ownerProfile = await fetchProfile(writeClient, requestedOwnerUserId);
        if (!ownerProfile || ownerProfile.active !== true) {
            return res.status(400).json({ error: "Hold owner is not active" });
        }

        let holdRow = null;
        let eventType = "hold_created";
        let oldHold = currentHold;

        if (currentHold && ["active", "expired"].includes(currentHold.status)) {
            ensureHoldPermission(authed.profile, remnant, currentHold);
            if (!isPrivilegedProfile(authed.profile) && requestedOwnerUserId !== currentHold.hold_owner_user_id) {
                return res.status(403).json({ error: "Only a manager or super admin can reassign a hold" });
            }

            const updatePayload = {
                hold_owner_user_id: requestedOwnerUserId,
                expires_at: holdPayload.expires_at,
                notes: holdPayload.notes,
                project_reference: holdPayload.project_reference,
                job_number: holdPayload.job_number,
                status: "active",
                reassigned_from_user_id: requestedOwnerUserId !== currentHold.hold_owner_user_id
                    ? currentHold.hold_owner_user_id
                    : currentHold.reassigned_from_user_id,
            };

            const { data, error } = await writeClient
                .from("holds")
                .update(updatePayload)
                .eq("id", currentHold.id)
                .select(HOLD_SELECT)
                .single();

            if (error) throw error;
            holdRow = formatHold(data);
            eventType = requestedOwnerUserId !== currentHold.hold_owner_user_id
                ? "hold_reassigned"
                : "hold_renewed";
        } else {
            const { data, error } = await writeClient
                .from("holds")
                .insert({
                    remnant_id: remnantId,
                    company_id: remnant.company_id,
                    hold_owner_user_id: requestedOwnerUserId,
                    hold_started_at: new Date().toISOString(),
                    expires_at: holdPayload.expires_at,
                    status: "active",
                    notes: holdPayload.notes,
                    project_reference: holdPayload.project_reference,
                    job_number: holdPayload.job_number,
                })
                .select(HOLD_SELECT)
                .single();

            if (error) throw error;
            holdRow = formatHold(data);
        }

        await writeClient
            .from("remnants")
            .update({ status: "hold" })
            .eq("id", remnantId);

        await cancelPendingHoldNotifications(writeClient, holdRow.id);
        await scheduleHoldNotifications(writeClient, holdRow);

        await writeAuditLog(writeClient, authed, {
            event_type: eventType,
            entity_type: "hold",
            entity_id: holdRow.id,
            remnant_id: remnantId,
            company_id: remnant.company_id,
            message: `${eventType.replaceAll("_", " ")} for remnant #${remnant.moraware_remnant_id || remnant.id}`,
            old_data: oldHold,
            new_data: holdRow,
            meta: {
                source: "api",
                override: isPrivilegedProfile(authed.profile) && String(requestedOwnerUserId) !== String(authed.profile.id),
            },
        });

        res.json({ hold: holdRow });
    } catch (err) {
        console.error("Error saving hold:", err);
        res.status(500).json({ error: err.message || "Failed to save hold" });
    }
});

router.post("/holds/:id/release", async (req, res) => {
    const authed = await requireActiveProfile(req, res, ["super_admin", "manager", "status_user"]);
    if (!authed) return;

    try {
        const writeClient = getWriteClient(authed.client);
        const holdId = asNumber(req.params.id);
        if (!holdId) return res.status(400).json({ error: "Invalid hold id" });

        const { data: holdRow, error: holdError } = await writeClient
            .from("holds")
            .select(HOLD_SELECT)
            .eq("id", holdId)
            .maybeSingle();

        if (holdError) throw holdError;
        if (!holdRow) return res.status(404).json({ error: "Hold not found" });

        const remnant = await fetchRemnantStatusRow(writeClient, holdRow.remnant_id);
        ensureHoldPermission(authed.profile, remnant, holdRow);

        const { data, error } = await writeClient
            .from("holds")
            .update({
                status: "released",
                released_at: new Date().toISOString(),
                released_by_user_id: authed.profile.id,
            })
            .eq("id", holdId)
            .select(HOLD_SELECT)
            .single();

        if (error) throw error;

        await writeClient.from("remnants").update({ status: "available" }).eq("id", holdRow.remnant_id);
        await cancelPendingHoldNotifications(writeClient, holdId);

        await writeAuditLog(writeClient, authed, {
            event_type: "hold_released",
            entity_type: "hold",
            entity_id: holdId,
            remnant_id: holdRow.remnant_id,
            company_id: holdRow.company_id,
            message: `Released hold for remnant #${remnant.moraware_remnant_id || remnant.id}`,
            old_data: formatHold(holdRow),
            new_data: formatHold(data),
            meta: {
                source: "api",
                override: isPrivilegedProfile(authed.profile)
                    && String(holdRow.hold_owner_user_id) !== String(authed.profile.id),
            },
        });

        res.json({ hold: formatHold(data) });
    } catch (err) {
        console.error("Error releasing hold:", err);
        res.status(500).json({ error: err.message || "Failed to release hold" });
    }
});

router.post("/holds/process-expirations", async (req, res) => {
    const authed = await requireActiveProfile(req, res, ["super_admin", "manager"]);
    if (!authed) return;

    try {
        const writeClient = getWriteClient(authed.client);
        const { data, error } = await writeClient
            .from("holds")
            .select(HOLD_SELECT)
            .eq("status", "active")
            .lt("expires_at", new Date().toISOString());

        if (error) throw error;

        const expired = [];
        for (const holdRow of data || []) {
            const { data: updatedHold, error: updateError } = await writeClient
                .from("holds")
                .update({ status: "expired" })
                .eq("id", holdRow.id)
                .select(HOLD_SELECT)
                .single();

            if (updateError) throw updateError;

            await cancelPendingHoldNotifications(writeClient, holdRow.id);
            await queueNotification(writeClient, {
                notification_type: "hold_expired",
                target_user_id: holdRow.hold_owner_user_id,
                target_email: holdRow.hold_owner?.email || null,
                remnant_id: holdRow.remnant_id,
                hold_id: holdRow.id,
                payload: {
                    remnant_id: holdRow.remnant_id,
                    expires_at: holdRow.expires_at,
                    project_reference: holdRow.project_reference || null,
                    job_number: holdRow.job_number || null,
                },
            });

            await writeAuditLog(writeClient, authed, {
                event_type: "hold_expired",
                entity_type: "hold",
                entity_id: holdRow.id,
                remnant_id: holdRow.remnant_id,
                company_id: holdRow.company_id,
                message: `Expired hold #${holdRow.id} for remnant ${holdRow.remnant_id}`,
                old_data: formatHold(holdRow),
                new_data: formatHold(updatedHold),
                meta: {
                    source: "api",
                    action: "expire_hold",
                    override: true,
                },
            });

            expired.push(formatHold(updatedHold));
        }

        res.json({ expired });
    } catch (err) {
        console.error("Error processing hold expirations:", err);
        res.status(500).json({ error: err.message || "Failed to process hold expirations" });
    }
});

router.get("/next-stone-id", async (req, res) => {
    const authed = await requireActiveProfile(req, res, ["super_admin", "manager"]);
    if (!authed) return;

    try {
        const nextStoneId = await fetchNextStoneId(authed.client);
        res.json({ nextStoneId });
    } catch (err) {
        console.error("Error loading next stone id:", err);
        res.status(500).json({ error: err.message || "Failed to load next stone id" });
    }
});

router.post("/remnants", async (req, res) => {
    const authed = await requireActiveProfile(req, res, ["super_admin", "manager"]);
    if (!authed) return;

    try {
        // Reads and permissions still come from the logged-in user profile, but
        // once that check passes we use the server-side writer so inserts are
        // not blocked by Supabase RLS/session edge cases.
        const writeClient = getWriteClient(authed.client);
        const payload = normalizePayload(req.body);
        const validationError = validateRemnantPayload(payload);
        if (validationError) return res.status(400).json({ error: validationError });

        const imageData = await uploadImageIfPresent(
            writeClient,
            payload.name || `new-${Date.now()}`,
            req.body.image_file
        );
        const insertPayload = {
            moraware_remnant_id: payload.moraware_remnant_id,
            company_id: payload.company_id,
            material_id: payload.material_id,
            thickness_id: payload.thickness_id,
            name: payload.name,
            width: payload.width,
            height: payload.height,
            l_shape: payload.l_shape,
            l_width: payload.l_width,
            l_height: payload.l_height,
            status: payload.status,
            hash: req.body.hash ? String(req.body.hash).trim() : `manual:${Date.now()}`,
            deleted_at: null,
            ...imageData,
        };

        const { data, error } = await writeClient
            .from("remnants")
            .insert(insertPayload)
            .select(REMNANT_SELECT)
            .single();

        if (error) throw error;
        await writeAuditLog(writeClient, authed, {
            event_type: "remnant_created",
            entity_type: "remnant",
            entity_id: data.id,
            remnant_id: data.id,
            company_id: data.company_id,
            message: `Created remnant #${data.moraware_remnant_id || data.id}`,
            new_data: data,
            meta: {
                source: "api",
                action: "create",
            },
        });
        res.status(201).json(formatRemnant(data));
    } catch (err) {
        console.error("Error creating remnant:", err);
        const isRlsError =
            err?.statusCode === "403" ||
            err?.code === "42501" ||
            /row-level security/i.test(err?.message || "");

        if (isRlsError) {
            return res.status(403).json({
                error: "Insert blocked by Supabase RLS",
                auth_user_id: authed.user.id,
                auth_email: authed.user.email || null,
                profile: authed.profile || null,
                details: err?.message || String(err),
            });
        }

        res.status(500).json({ error: err.message || "Failed to create remnant" });
    }
});

router.patch("/remnants/:id", async (req, res) => {
    const authed = await requireActiveProfile(req, res, ["super_admin", "manager"]);
    if (!authed) return;

    try {
        // Same write approach as create: verify the user in app code first, then
        // perform the update with the trusted server writer.
        const writeClient = getWriteClient(authed.client);
        const remnantId = asNumber(req.params.id);
        const payload = normalizePayload(req.body);
        if (!remnantId) {
            return res.status(400).json({ error: "Invalid remnant id" });
        }
        const validationError = validateRemnantPayload(payload);
        if (validationError) return res.status(400).json({ error: validationError });

        const { data: existingRemnant, error: existingError } = await writeClient
            .from("remnants")
            .select(REMNANT_SELECT)
            .eq("id", remnantId)
            .maybeSingle();

        if (existingError) throw existingError;
        if (!existingRemnant) {
            return res.status(404).json({ error: "Remnant not found" });
        }

        const imageData = await uploadImageIfPresent(writeClient, remnantId, req.body.image_file);
        const incomingStoneId = Object.prototype.hasOwnProperty.call(req.body, "moraware_remnant_id")
            || Object.prototype.hasOwnProperty.call(req.body, "external_id");
        const updatePayload = {
            company_id: payload.company_id,
            material_id: payload.material_id,
            thickness_id: payload.thickness_id,
            name: payload.name,
            width: payload.width,
            height: payload.height,
            l_shape: payload.l_shape,
            l_width: payload.l_width,
            l_height: payload.l_height,
            ...imageData,
        };

        if (incomingStoneId) {
            updatePayload.moraware_remnant_id = payload.moraware_remnant_id;
        } else {
            updatePayload.moraware_remnant_id = existingRemnant.moraware_remnant_id;
        }

        const { data, error } = await writeClient
            .from("remnants")
            .update(updatePayload)
            .eq("id", remnantId)
            .select(REMNANT_SELECT)
            .maybeSingle();

        if (error) throw error;
        if (!data) {
            return res.status(403).json({
                error: "No remnant was updated. This usually means RLS blocked the write or the row was not found.",
            });
        }

        await writeAuditLog(writeClient, authed, {
            event_type: "remnant_updated",
            entity_type: "remnant",
            entity_id: data.id,
            remnant_id: data.id,
            company_id: data.company_id,
            message: `Updated remnant #${data.moraware_remnant_id || data.id}`,
            old_data: existingRemnant,
            new_data: data,
            meta: {
                source: "api",
                action: "update",
            },
        });
        res.json(formatRemnant(data));
    } catch (err) {
        console.error("Error updating remnant:", err);
        res.status(500).json({ error: err.message || "Failed to update remnant" });
    }
});

// Cropping or replacing an image from the preview panel should not silently
// save unrelated form edits, so this route updates image fields only.
router.patch("/remnants/:id/image", async (req, res) => {
    const authed = await requireActiveProfile(req, res, ["super_admin", "manager"]);
    if (!authed) return;

    try {
        const writeClient = getWriteClient(authed.client);
        const remnantId = asNumber(req.params.id);
        if (!remnantId) {
            return res.status(400).json({ error: "Invalid remnant id" });
        }
        if (!req.body?.image_file?.dataUrl) {
            return res.status(400).json({ error: "Image file is required" });
        }

        const { data: existingRemnant, error: existingError } = await writeClient
            .from("remnants")
            .select("id,moraware_remnant_id,company_id,image,image_path")
            .eq("id", remnantId)
            .maybeSingle();

        if (existingError) throw existingError;
        const imageData = await uploadImageIfPresent(writeClient, remnantId, req.body.image_file);
        const { data, error } = await writeClient
            .from("remnants")
            .update(imageData)
            .eq("id", remnantId)
            .select(REMNANT_SELECT)
            .maybeSingle();

        if (error) throw error;
        if (!data) {
            return res.status(404).json({ error: "Remnant not found" });
        }

        await writeAuditLog(writeClient, authed, {
            event_type: "remnant_image_updated",
            entity_type: "remnant",
            entity_id: data.id,
            remnant_id: data.id,
            company_id: data.company_id,
            message: `Updated image for remnant #${data.moraware_remnant_id || data.id}`,
            old_data: existingRemnant,
            new_data: {
                id: data.id,
                moraware_remnant_id: data.moraware_remnant_id,
                company_id: data.company_id,
                image: data.image,
                image_path: data.image_path,
            },
            meta: {
                source: "api",
                action: "image_update",
            },
        });
        res.json(formatRemnant(data));
    } catch (err) {
        console.error("Error updating remnant image:", err);
        res.status(500).json({ error: err.message || "Failed to update remnant image" });
    }
});

router.post("/remnants/:id/status", async (req, res) => {
    // Direct status changes intentionally exclude "hold". Holds need their own
    // workflow because they carry ownership, expiration, notifications, notes,
    // and job-number requirements that a plain status flip cannot express.
    const authed = await requireActiveProfile(req, res, ["super_admin", "manager", "status_user"]);
    if (!authed) return;

    try {
        const writeClient = getWriteClient(authed.client);
        const remnantId = asNumber(req.params.id);
        if (!remnantId) {
            return res.status(400).json({ error: "Invalid remnant id" });
        }
        const status = normalizeStatus(req.body.status);
        const soldJobNumber = String(req.body.sold_job_number || "").trim();
        if (status === "hold") {
            return res.status(400).json({ error: "Use the hold workflow to place or renew holds" });
        }
        if (status === "sold" && !soldJobNumber) {
            return res.status(400).json({ error: "Sold job number is required" });
        }

        const existingRemnant = await fetchRemnantStatusRow(writeClient, remnantId);
        if (!existingRemnant) {
            return res.status(404).json({ error: "Remnant not found" });
        }
        if (existingRemnant.deleted_at) {
            return res.status(400).json({ error: "Deleted remnants cannot change status" });
        }
        if (!isPrivilegedProfile(authed.profile) && !isOwnCompanyStatusUser(authed.profile, existingRemnant)) {
            return res.status(403).json({ error: "Not allowed to update this remnant" });
        }

        const currentHold = await fetchRelevantHoldForRemnant(writeClient, remnantId);
        if (currentHold && ["active", "expired"].includes(currentHold.status)) {
            ensureHoldPermission(authed.profile, existingRemnant, currentHold);
        }

        let updatedHold = null;
        if (status === "available" && currentHold?.status === "active") {
            // Moving back to available should release the underlying hold too,
            // otherwise the old hold would keep blocking future ownership checks.
            const { data: releasedHold, error: holdError } = await writeClient
                .from("holds")
                .update({
                    status: "released",
                    released_at: new Date().toISOString(),
                    released_by_user_id: authed.profile.id,
                })
                .eq("id", currentHold.id)
                .select(HOLD_SELECT)
                .single();

            if (holdError) throw holdError;
            updatedHold = formatHold(releasedHold);
            await cancelPendingHoldNotifications(writeClient, currentHold.id);
            await writeAuditLog(writeClient, authed, {
                event_type: "hold_released",
                entity_type: "hold",
                entity_id: currentHold.id,
                remnant_id: remnantId,
                company_id: existingRemnant.company_id,
                message: `Released hold for remnant #${existingRemnant.moraware_remnant_id || existingRemnant.id}`,
                old_data: currentHold,
                new_data: updatedHold,
                meta: {
                    source: "api",
                    action: "status_release",
                    override: isPrivilegedProfile(authed.profile)
                        && String(currentHold.hold_owner_user_id) !== String(authed.profile.id),
                },
            });
        }

        if (status === "sold" && currentHold?.status && currentHold.status !== "sold") {
            // If the remnant was held when it got sold, we also mark the hold as
            // sold so the hold history reflects what really happened.
            const { data: soldHold, error: holdError } = await writeClient
                .from("holds")
                .update({
                    status: "sold",
                    released_at: new Date().toISOString(),
                    released_by_user_id: authed.profile.id,
                })
                .eq("id", currentHold.id)
                .select(HOLD_SELECT)
                .single();

            if (holdError) throw holdError;
            updatedHold = formatHold(soldHold);
            await cancelPendingHoldNotifications(writeClient, currentHold.id);
            await writeAuditLog(writeClient, authed, {
                event_type: "hold_sold",
                entity_type: "hold",
                entity_id: currentHold.id,
                remnant_id: remnantId,
                company_id: existingRemnant.company_id,
                message: `Marked held remnant #${existingRemnant.moraware_remnant_id || existingRemnant.id} as sold`,
                old_data: currentHold,
                new_data: updatedHold,
                meta: {
                    source: "api",
                    action: "status_sold",
                    override: isPrivilegedProfile(authed.profile)
                        && String(currentHold.hold_owner_user_id) !== String(authed.profile.id),
                },
            });
        }

        const remnantUpdate = { status };
        let currentSale = null;
        if (status === "sold") {
            // Sale details live in remnant_sales so the history survives even if
            // the remnant later moves back to available or is sold again.
            const saleTimestamp = new Date().toISOString();
            const { data: saleData, error: saleError } = await writeClient
                .from("remnant_sales")
                .insert({
                    remnant_id: remnantId,
                    company_id: existingRemnant.company_id,
                    sold_by_user_id: authed.profile.id,
                    sold_at: saleTimestamp,
                    job_number: soldJobNumber,
                })
                .select(SALE_SELECT)
                .single();

            if (saleError) throw saleError;
            currentSale = formatSale(saleData);
        }

        const { data, error } = await writeClient
            .from("remnants")
            .update(remnantUpdate)
            .eq("id", remnantId)
            .select(REMNANT_SELECT)
            .single();

        if (error) throw error;
        await writeAuditLog(writeClient, authed, {
            // This audit event tracks the lifecycle transition itself. The
            // separate sale row already preserves the sale-specific details.
            event_type: "remnant_status_changed",
            entity_type: "remnant",
            entity_id: data.id,
            remnant_id: data.id,
            company_id: data.company_id,
            message: `Changed status for remnant #${data.moraware_remnant_id || data.id} to ${data.status}`,
            old_data: existingRemnant,
            new_data: {
                id: data.id,
                moraware_remnant_id: data.moraware_remnant_id,
                company_id: data.company_id,
                status: data.status,
                current_sale: currentSale,
            },
            meta: {
                source: "api",
                action: "status_change",
                hold_id: updatedHold?.id || currentHold?.id || null,
            },
        });
        if (!currentSale && data.status === "sold") {
            currentSale = await fetchLatestSaleForRemnant(writeClient, remnantId);
        }
        res.json({
            ...attachSaleToRows([formatRemnant(data)], new Map([[data.id, currentSale]]))[0],
            current_hold: updatedHold || currentHold || null,
        });
    } catch (err) {
        console.error("Error updating remnant status:", err);
        res.status(500).json({ error: err.message || "Failed to update remnant status" });
    }
});

router.delete("/remnants/:id", async (req, res) => {
    const authed = await requireActiveProfile(req, res, ["super_admin", "manager"]);
    if (!authed) return;

    try {
        const writeClient = getWriteClient(authed.client);
        const remnantId = asNumber(req.params.id);
        if (!remnantId) {
            return res.status(400).json({ error: "Invalid remnant id" });
        }
        const { data: existingRemnant, error: existingError } = await writeClient
            .from("remnants")
            .select("id,moraware_remnant_id,company_id,deleted_at,status")
            .eq("id", remnantId)
            .maybeSingle();

        if (existingError) throw existingError;
        const { data, error } = await authed.client.rpc("soft_delete_remnant", {
            p_remnant_id: remnantId,
        });

        if (error) throw error;
        await writeAuditLog(writeClient, authed, {
            event_type: "remnant_archived",
            entity_type: "remnant",
            entity_id: data.id,
            remnant_id: data.id,
            company_id: data.company_id,
            message: `Archived remnant #${data.moraware_remnant_id || data.id}`,
            old_data: existingRemnant,
            new_data: {
                id: data.id,
                moraware_remnant_id: data.moraware_remnant_id,
                company_id: data.company_id,
                deleted_at: data.deleted_at,
                status: data.status,
            },
            meta: {
                source: "api",
                action: "archive",
            },
        });
        res.json(formatRemnant(data));
    } catch (err) {
        console.error("Error deleting remnant:", err);
        res.status(500).json({ error: err.message || "Failed to delete remnant" });
    }
});

module.exports = router;
