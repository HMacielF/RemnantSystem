const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');

// GET /remnants — default owner is "Quick"
router.get('/remnants', async (req, res) => {
    await handleRemnantFilter(req, res, "Quick");
});

// GET /remnants/:owner — custom owner
router.get('/remnants/:owner', async (req, res) => {
    const owner = req.params.owner.toUpperCase();
    const { material, stone, minWidth, minHeight, color } = req.query;

    try {
        if (owner === 'ALL') {
            const { data, error } = await supabase.rpc('get_all_remants', {
                materials: material ? (Array.isArray(material) ? material : [material]) : null,
                stone: stone || null,
                min_w: minWidth ? parseFloat(minWidth) : null,
                min_h: minHeight ? parseFloat(minHeight) : null,
                color: color || null
            });

            if (error) {
                return res.status(500).json({ error: error.message });
            }

            return res.status(200).json(data);
        }

        // Fallback if owner is not 'ALL'
        await handleRemnantFilter(req, res, owner);

    } catch (err) {
        console.error('Error handling remnants:', err);
        res.status(500).json({ error: 'Server error' });
    }
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
