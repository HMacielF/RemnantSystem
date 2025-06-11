const express = require('express');
const supabaseClient = require('@supabase/supabase-js');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = 3000;

// Serve static files from the 'public' folder
app.use(bodyParser.json())
app.use(express.static(__dirname + '/public'))

// Supabase config
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = supabaseClient.createClient(supabaseUrl, supabaseKey);

// API endpoint to get all remnants
app.get('/api/remnants', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('remnants')
            .select('*');

        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('Error fetching remnants:', err.message);
        res.status(500).json({ error: 'Failed to fetch remnants' });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`✅ Server running at http://localhost:${port}`);
});
