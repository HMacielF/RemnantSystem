// me.js (Express route for /api/me)
const express = require("express");
const router = express.Router();
const supabase = require('../supabaseClient');

router.get("/me", async (req, res) => {
    const token = req.cookies["sb-access-token"];
    if (!token) return res.status(401).json({ error: "Not logged in" });

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
        return res.status(401).json({ error: "Invalid or expired session" });
    }

    // Get role/owner info from your user_owners table
    const { data: ownerData, error: roleError } = await supabase
        .from("user_owners")
        .select("role, owner_name")
        .eq("user_id", user.id)
        .single();

    if (roleError || !ownerData) {
        return res.status(403).json({ error: "No role found for user" });
    }

    res.json({
        email: user.email,
        role: ownerData.role,
        owner_name: ownerData.owner_name
    });
});

module.exports = router;
