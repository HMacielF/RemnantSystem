const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();
const port = 3000;

app.use(bodyParser.json());
app.use(express.static(__dirname + '/public'));

// Mount all API routes
app.use('/api', require('./api/remnants'));
app.use('/api', require('./api/update'));
app.use('/api', require('./api/delete'));

// Start server
app.listen(port, () => {
  console.log(`✅ Server running at http://localhost:${port}`);
});
