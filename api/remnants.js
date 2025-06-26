const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');

router.get('/remnants', async (req, res) => {
  const { material, stone, 'min-width': minWidth, 'min-height': minHeight } = req.query;

  try {
    let query = supabase.from('remnants').select('*');

    if (material) {
      const materials = Array.isArray(material) ? material : [material];
      query = query.in('material_type', materials);
    }

    if (stone) {
      query = query.ilike('stone_name', `%${stone}%`);
    }

    if (minWidth) {
      query = query.gte('width', parseFloat(minWidth));
    }

    if (minHeight) {
      query = query.gte('height', parseFloat(minHeight));
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json(data);
  } catch (err) {
    console.error('Error fetching remnants:', err.message);
    res.status(500).json({ error: 'Failed to fetch filtered remnants' });
  }
});

module.exports = router;
