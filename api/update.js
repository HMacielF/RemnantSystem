const express = require('express');
const router = express.Router();

const supabase = require('../supabaseClient');

// POST route to update a remnant's information
router.post('/update', async (req, res) => {
    const { id, material_type, stone_name, status_id, location } = req.body;

    const { error } = await supabase
        .from('remnants')
        .update({ material_type, stone_name, status_id, location })
        .eq('id', id); 

    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true });
});

module.exports = router;
