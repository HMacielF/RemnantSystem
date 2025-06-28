const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');

// GET /remnants — default owner is "Quick"
router.get('/remnants', async (req, res) => {
    await handleRemnantFilter(req, res, "Quick");
});

// GET /remnants/:owner — custom owner
router.get('/remnants/:owner', async (req, res) => {
    await handleRemnantFilter(req, res, req.params.owner);
});

// Shared handler
async function handleRemnantFilter(req, res, owner) {
    const { material, stone, 'min-width': minWidth, 'min-height': minHeight, color } = req.query;

    try {
        const { data, error } = await supabase.rpc('filter_remnants', {
            materials: material ? (Array.isArray(material) ? material : [material]) : null,
            stone: stone || null,
            min_w: minWidth ? parseFloat(minWidth) : null,
            min_h: minHeight ? parseFloat(minHeight) : null,
            color: color || null,
            owner_filter: owner || null
        });

        if (error) throw error;

        res.json(data);
    } catch (err) {
        console.error('Error filtering remnants:', err.message);
        res.status(500).json({ error: 'Failed to filter remnants' });
    }
}

module.exports = router;
