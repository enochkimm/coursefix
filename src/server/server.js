// src/server/server.js

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import uploadHandler from './uploadHandler.js';

// ESM __dirname fix
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 🟢 point to src/public, not root-level public
const publicPath = path.join(__dirname, '../public');

const app = express();
app.use(express.json());

// ✅ serve static files from src/public
app.use(express.static(publicPath));

// ✅ explicitly serve index.html at /
app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// ✅ upload route
app.use('/api', uploadHandler);

// start server
app.listen(3000, () => {
  console.log('✅ Server running at http://localhost:3000');
});