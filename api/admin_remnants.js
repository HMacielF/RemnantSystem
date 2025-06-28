// admin_remnants.js - API route to return all remnant data via Supabase RPC

const express = require("express");
const router = express.Router();
const supabase = require('../supabaseClient');

// GET /api/admin_remnants
router.get("/admin_remnants", async (req, res) => {
    const { data, error } = await supabase.rpc("get_all_remnants");

    if (error) {
        console.error("❌ Failed to load admin remnants:", error);
        return res.status(500).json({ error: "Failed to fetch remnants" });
    }

    res.json(data);
});
module.exports = router;
