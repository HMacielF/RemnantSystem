const express = require('express');
const supabaseClient = require('@supabase/supabase-js');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');

// Load env variables (Supabase URL + Key)
dotenv.config();

const app = express();
const port = 3000;

app.use(bodyParser.json());

// Serve frontend files from /public
app.use(express.static(__dirname + '/public'));

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = supabaseClient.createClient(supabaseUrl, supabaseKey);

// API: GET remnants with optional filters
app.get('/api/remnants', async (req, res) => {
    const { material, stone, 'min-width': minWidth, 'min-height': minHeight } = req.query;

    try {
        let query = supabase.from('remnants').select('*');

        // Filter by material (one or more)
        if (material) {
            const materials = Array.isArray(material) ? material : [material];
            query = query.in('material_type', materials);
        }

        // Filter by stone name (partial match, case-insensitive)
        if (stone) {
            query = query.ilike('stone_name', `%${stone}%`);
        }

        // Minimum size filters
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
        console.error('Error filtering remnants:', err.message);
        res.status(500).json({ error: 'Failed to fetch filtered remnants' });
    }
});

// API: GET materials
app.get('/api/materials', async (req, res) => {
    const { data, error } = await supabase
        .from('remnants')
        .select('material_type')
        .neq('material_type', null);

    if (error) return res.status(500).json({ error: error.message });

    const unique = [...new Set(data.map(d => d.material_type))];
    res.json(unique);
});


// Start server
app.listen(port, () => {
    console.log(`✅ Server running at http://localhost:${port}`);
});