const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');

router.post('/delete', async (req, res) => {
  const { id } = req.body;

  const { error } = await supabase
    .from('remnants')
    .delete()
    .eq('id', id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
