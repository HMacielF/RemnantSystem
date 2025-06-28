// hold_actions.js (Express route for approving/rejecting holds)

const express = require("express");
const router = express.Router();
const supabase = require('../../supabaseClient');

// POST /api/hold_requests/:id/approve
router.post("/hold_requests/:id/approve", async (req, res) => {
    const { id } = req.params;

    const { error: holdError } = await supabase
        .from("hold_requests")
        .update({ status: "approved", approved_at: new Date().toISOString() })
        .eq("id", id);

    if (holdError) {
        console.error("❌ Failed to approve hold request:", holdError);
        return res.status(500).json({ error: "Failed to approve" });
    }

    const { data: hold } = await supabase
        .from("hold_requests")
        .select("remnant_id")
        .eq("id", id)
        .single();

    if (!hold) return res.status(404).json({ error: "Hold request not found" });

    await supabase
        .from("remnants")
        .update({ status: "On Hold" })
        .eq("id", hold.remnant_id);

    res.json({ message: "Hold approved" });
});

// POST /api/hold_requests/:id/reject
router.post("/hold_requests/:id/reject", async (req, res) => {
    const { id } = req.params;

    const { error: rejectError } = await supabase
        .from("hold_requests")
        .update({ status: "rejected" })
        .eq("id", id);

    if (rejectError) {
        console.error("❌ Failed to reject hold request:", rejectError);
        return res.status(500).json({ error: "Failed to reject" });
    }

    const { data: hold } = await supabase
        .from("hold_requests")
        .select("remnant_id")
        .eq("id", id)
        .single();

    if (!hold) return res.status(404).json({ error: "Hold request not found" });

    await supabase
        .from("remnants")
        .update({ status: "Available" })
        .eq("id", hold.remnant_id);

    res.json({ message: "Hold rejected" });
});

module.exports = router;
