const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const cookieParser = require('cookie-parser');

const app = express();
const port = 3000;

app.use(cookieParser());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Mount all API routes
app.use('/api', require('./api/remnants'));
app.use('/api', require('./api/update'));
app.use('/api', require('./api/delete'));
app.use('/api', require('./api/hold_requests'));
app.use('/api', require("./api/routes/me"));
app.use('/api', require("./api/login"));
app.use("/api", require("./api/routes/hold_actions"));
app.use("/api", require("./api/admin_remnants"));


// Frontend route handling
app.get('/:owner', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(port, () => {
    console.log(`✅ Server running at http://localhost:${port}`);
});
