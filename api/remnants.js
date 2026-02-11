const express = require("express");
const router = express.Router();
const supabase = require("../supabaseClient");

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
                "id,name,material,width,height,thickness,l_shape,l_width,l_height,status,image,image_path,source_image_url,is_active,deleted_at,last_seen_at,updated_at"
            )
            .eq("is_active", true)
            .is("deleted_at", null)
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
        res.status(500).json({ error: "Failed to filter remnants" });
    }
}

// Main endpoint used by the single page.
router.get("/remnants", handleRemnantFilter);

// Backward-compatible alias: ignore owner and return same filtered list.
router.get("/remnants/:owner", handleRemnantFilter);

module.exports = router;
