// POST /api/hold_requests/:id/approve
router.post("/:id/approve", async (req, res) => {
    const { id } = req.params;

    // 1. Update hold_requests
    const { data, error } = await supabase
        .from("hold_requests")
        .update({ status: "approved", approved_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();

    if (error || !data) {
        return res.status(400).send("Failed to approve hold request");
    }

    // 2. Update related remnant
    const { error: remnantUpdateError } = await supabase
        .from("remnants")
        .update({ status: "hold" })
        .eq("id", data.remnant_id);

    if (remnantUpdateError) {
        return res.status(500).send("Approved hold, but failed to update remnant");
    }

    res.json({ message: "Hold approved and remnant updated" });
});
