// hold_requests.js
const express = require("express");
const router = express.Router();
const supabase = require('../supabaseClient');

// POST /api/hold_requests
router.post("/hold_requests", async (req, res) => {
    const { remnant_id, client_name, client_contact } = req.body;

    if (!remnant_id || !client_name || !client_contact) {
        return res.status(400).send("Missing required fields");
    }

    const { data: holdRequest, error } = await supabase
        .from("hold_requests")
        .insert([{ remnant_id, client_name, client_contact }])
        .select()
        .single();

    if (error) {
        console.error("❌ Error creating hold request:", error);
        return res.status(500).send("Failed to create hold request");
    }

    const { error: remnantUpdateError } = await supabase
        .from("remnants")
        .update({ status: "Pending" })
        .eq("id", remnant_id);

    if (remnantUpdateError) {
        console.error("❌ Failed to update remnant status:", remnantUpdateError);
        return res.status(500).send("Hold created, but failed to update remnant status");
    }

    res.status(201).json({ message: "Hold request created", holdRequest });
});

// GET /api/hold_requests
router.get("/hold_requests", async (req, res) => {
    const { data, error } = await supabase
        .from("hold_requests_with_remnants")
        .select("*")
        .order("created_at", { ascending: false });

    if (error) {
        console.error("❌ Failed to fetch hold requests from view:", error);
        return res.status(500).send("Error fetching hold requests");
    }

    res.json(data);
});


module.exports = router;
