const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const supabase = require("../supabaseClient");

const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "remnant-images";
const VALID_STATUSES = new Set(["available", "hold", "sold"]);
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
const ACTIVE_REMNANT_SELECT = `
    id,
    company,
    material,
    thickness,
    name,
    width,
    height,
    l_shape,
    l_width,
    l_height,
    status,
    image
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

function getReadClient() {
    return serviceSupabase || supabase;
}

function getPublicReadClient() {
    return supabase;
}

function getWriteClient(authedClient) {
    return serviceSupabase || authedClient;
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
    const materialFiltersRaw = req.query.material;
    const materialIds = (Array.isArray(materialFiltersRaw) ? materialFiltersRaw : materialFiltersRaw ? [materialFiltersRaw] : [])
        .map(asNumber)
        .filter((value) => value !== null);
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

            return res.status(200).json((data || []).map(formatRemnant));
        }

        const readClient = getPublicReadClient();
        let query = readClient
            .from("active_remnants")
            .select(ACTIVE_REMNANT_SELECT)
            .order("id", { ascending: true });

        if (materialIds.length > 0) {
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

        res.status(200).json((data || []).map((row) => ({
            ...row,
            display_id: row.id,
            company_name: row.company || "",
            material_name: row.material || "",
            thickness_name: row.thickness || "",
        })));
    } catch (err) {
        console.error("Error filtering remnants:", err);
        res.status(500).json({
            error: "Failed to filter remnants",
            details: err?.message || String(err),
        });
    }
}

router.get("/remnants", handleRemnantFilter);

async function handleCompanyRemnants(req, res) {
    const companySlug = resolveCompanySlug(req.params.companySlug || req.params.companyKey);
    const materialFiltersRaw = req.query.material;
    const materialIds = (Array.isArray(materialFiltersRaw) ? materialFiltersRaw : materialFiltersRaw ? [materialFiltersRaw] : [])
        .map(asNumber)
        .filter((value) => value !== null);
    const stone = (req.query.stone || "").trim();
    const stoneLike = escapeLikeValue(stone);
    const searchedRemnantId = extractRemnantIdSearch(stone);
    const status = normalizeStatus(req.query.status, "");
    const minWidth = asNumber(req.query["min-width"] ?? req.query.minWidth);
    const minHeight = asNumber(req.query["min-height"] ?? req.query.minHeight);

    try {
        const company = await fetchCompanyBySlug(companySlug);
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

        if (materialIds.length > 0) {
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

        res.status(200).json({
            company: company.name,
            remnants: (data || []).map(formatCompanyRemnant),
        });
    } catch (err) {
        console.error("Error filtering company remnants:", err);
        res.status(500).json({
            error: "Failed to filter company remnants",
            details: err?.message || String(err),
        });
    }
}

router.get("/companies/:companySlug/remnants", handleCompanyRemnants);
router.get("/quick/remnants", (req, res) => {
    req.params.companyKey = "quick";
    return handleCompanyRemnants(req, res);
});
router.get("/prime/remnants", (req, res) => {
    req.params.companyKey = "prime";
    return handleCompanyRemnants(req, res);
});

router.get("/remnants/summary", async (_req, res) => {
    try {
        const optionalAuthed = await getOptionalAuthedSupabase(_req);
        const summary = optionalAuthed
            ? await fetchInventorySummary(optionalAuthed.client, "remnants")
            : await fetchInventorySummary();
        res.json(summary);
    } catch (err) {
        console.error("Error loading remnant summary:", err);
        res.status(500).json({ error: err.message || "Failed to load remnant summary" });
    }
});

router.get("/lookups", async (_req, res) => {
    try {
        const optionalAuthed = await getOptionalAuthedSupabase(_req);
        const lookupClient = optionalAuthed?.client || getReadClient();
        const [companies, materials, thicknesses] = await Promise.all([
            fetchLookupRows("companies", lookupClient),
            fetchLookupRows("materials", lookupClient),
            fetchLookupRows("thicknesses", lookupClient),
        ]);

        res.json({ companies, materials, thicknesses });
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
            .select("moraware_remnant_id")
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

        res.json(formatRemnant(data));
    } catch (err) {
        console.error("Error updating remnant image:", err);
        res.status(500).json({ error: err.message || "Failed to update remnant image" });
    }
});

router.post("/remnants/:id/status", async (req, res) => {
    const authed = await requireActiveProfile(req, res, ["super_admin", "manager", "status_user"]);
    if (!authed) return;

    try {
        const remnantId = asNumber(req.params.id);
        if (!remnantId) {
            return res.status(400).json({ error: "Invalid remnant id" });
        }
        const status = normalizeStatus(req.body.status);

        const { data, error } = await authed.client.rpc("update_remnant_status", {
            p_remnant_id: remnantId,
            p_status: status,
        });

        if (error) throw error;
        res.json(formatRemnant(data));
    } catch (err) {
        console.error("Error updating remnant status:", err);
        res.status(500).json({ error: err.message || "Failed to update remnant status" });
    }
});

router.delete("/remnants/:id", async (req, res) => {
    const authed = await requireActiveProfile(req, res, ["super_admin", "manager"]);
    if (!authed) return;

    try {
        const remnantId = asNumber(req.params.id);
        if (!remnantId) {
            return res.status(400).json({ error: "Invalid remnant id" });
        }
        const { data, error } = await authed.client.rpc("soft_delete_remnant", {
            p_remnant_id: remnantId,
        });

        if (error) throw error;
        res.json(formatRemnant(data));
    } catch (err) {
        console.error("Error deleting remnant:", err);
        res.status(500).json({ error: err.message || "Failed to delete remnant" });
    }
});

module.exports = router;
