const express = require("express");
const router = express.Router();
const supabase = require("../supabaseClient");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "remnant-images";

function asNumber(value) {
    if (value === undefined || value === null || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

async function handleRemnantFilter(req, res) {
    const materialsRaw = req.query.material;
    const materials = Array.isArray(materialsRaw)
        ? materialsRaw
        : materialsRaw
            ? [materialsRaw]
            : [];
    const stone = (req.query.stone || "").trim();
    const status = (req.query.status || "").trim();
    const minWidth = asNumber(req.query["min-width"] ?? req.query.minWidth);
    const minHeight = asNumber(req.query["min-height"] ?? req.query.minHeight);

    try {
        let query = supabase
            .from("remnants")
            .select(
                "id,name,material,width,height,thickness,l_shape,l_width,l_height,status,image,source_image_url"
            )
            .order("id", { ascending: false });

        if (materials.length > 0) query = query.in("material", materials);
        if (stone) query = query.ilike("name", `%${stone}%`);
        if (status) query = query.ilike("status", `%${status}%`);
        if (minWidth !== null) query = query.gte("width", minWidth);
        if (minHeight !== null) query = query.gte("height", minHeight);

        const { data, error } = await query;
        if (error) throw error;

        res.status(200).json(data || []);
    } catch (err) {
        console.error("Error filtering remnants:", err);
        res.status(500).json({
            error: "Failed to filter remnants",
            details: err?.message || String(err),
        });
    }
}

function getAuthedSupabase(req) {
    const token = req.cookies?.access_token;
    if (!token) return null;

    return createClient(SUPABASE_URL, SUPABASE_KEY, {
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

    return getAuthedSupabase(req);
}

function normalizePayload(body) {
    const parsed = {
        id: body.id ? String(body.id).trim() : "",
        name: body.name ? String(body.name).trim() : "",
        material: body.material ? String(body.material).trim() : "",
        width: asNumber(body.width),
        height: asNumber(body.height),
        thickness: body.thickness ? String(body.thickness).trim() : "",
        l_shape: Boolean(body.l_shape),
        l_width: asNumber(body.l_width),
        l_height: asNumber(body.l_height),
        status: body.status ? String(body.status).trim() : "Available",
    };

    if (!parsed.l_shape) {
        parsed.l_width = null;
        parsed.l_height = null;
    }

    return parsed;
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

async function uploadImageIfPresent(client, remnantId, imageFile) {
    if (!imageFile?.dataUrl) return null;

    const parsed = parseDataUrl(imageFile.dataUrl);
    if (!parsed) {
        throw new Error("Invalid image upload format");
    }

    const ext = extensionForType(parsed.contentType, imageFile.name);
    const imagePath = `${remnantId}_${Date.now()}.${ext}`;

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

// Main endpoint used by the single page.
router.get("/remnants", handleRemnantFilter);

// Backward-compatible alias: ignore owner and return same filtered list.
router.post("/remnants", async (req, res) => {
    const client = await requireAuthedSupabase(req, res);
    if (!client) return;

    try {
        const payload = normalizePayload(req.body);
        if (!payload.id || !payload.name || !payload.material) {
            return res.status(400).json({ error: "ID, name, and material are required" });
        }

        const imageData = await uploadImageIfPresent(client, payload.id, req.body.image_file);
        const insertPayload = {
            ...payload,
            ...imageData,
            is_active: true,
            deleted_at: null,
        };

        const { data, error } = await client
            .from("remnants")
            .insert(insertPayload)
            .select(
                "id,name,material,width,height,thickness,l_shape,l_width,l_height,status,image,source_image_url"
            )
            .single();

        if (error) throw error;
        res.status(201).json(data);
    } catch (err) {
        console.error("Error creating remnant:", err);
        res.status(500).json({ error: err.message || "Failed to create remnant" });
    }
});

router.patch("/remnants/:id", async (req, res) => {
    const client = await requireAuthedSupabase(req, res);
    if (!client) return;

    try {
        const remnantId = req.params.id;
        const payload = normalizePayload({ ...req.body, id: remnantId });
        const imageData = await uploadImageIfPresent(client, remnantId, req.body.image_file);
        const updatePayload = {
            name: payload.name,
            material: payload.material,
            width: payload.width,
            height: payload.height,
            thickness: payload.thickness,
            l_shape: payload.l_shape,
            l_width: payload.l_width,
            l_height: payload.l_height,
            ...imageData,
        };

        const { data, error } = await client
            .from("remnants")
            .update(updatePayload)
            .eq("id", remnantId)
            .select(
                "id,name,material,width,height,thickness,l_shape,l_width,l_height,status,image,source_image_url"
            )
            .maybeSingle();

        if (error) throw error;
        if (!data) {
            return res.status(403).json({
                error: "No remnant was updated. This usually means RLS blocked the write or the row was not found.",
            });
        }
        res.json(data);
    } catch (err) {
        console.error("Error updating remnant:", err);
        res.status(500).json({ error: err.message || "Failed to update remnant" });
    }
});

router.post("/remnants/:id/status", async (req, res) => {
    const client = await requireAuthedSupabase(req, res);
    if (!client) return;

    try {
        const parsedRemnantId = parseInt(req.params.id);
        const status = req.body.status
            ? String(req.body.status).trim()
            : "available";

        console.log("\nID#: " + parsedRemnantId + " Status: " + status);

        const { data, error } = await client
            .from("remnants")
            .update({ status })
                .eq("id", parsedRemnantId)
            .select(
                "id,name,material,width,height,thickness,l_shape,l_width,l_height,status,image,source_image_url"
            )
            .maybeSingle();

        console.log(error)

        if (error) throw error;

        if (!data) {
            return res.status(403).json({
                error: "No remnant status was updated. This usually means RLS blocked the write or the row was not found.",
            });
        }

        res.json(data);
    } catch (err) {
        console.error("Error updating remnant status:", err);
        res.status(500).json({ error: err.message || "Failed to update status - General" });
    }
});

router.delete("/remnants/:id", async (req, res) => {
    const client = await requireAuthedSupabase(req, res);
    if (!client) return;

    try {
        const remnantId = req.params.id;
        const { data, error } = await client
            .from("remnants")
            .update({
                is_active: false,
                deleted_at: new Date().toISOString(),
            })
            .eq("id", remnantId)
            .select("id")
            .maybeSingle();

        if (error) throw error;
        if (!data) {
            return res.status(403).json({
                error: "No remnant was deleted. This usually means RLS blocked the write or the row was not found.",
            });
        }
        res.status(204).send();
    } catch (err) {
        console.error("Error deleting remnant:", err);
        res.status(500).json({ error: err.message || "Failed to delete remnant" });
    }
});

module.exports = router;
