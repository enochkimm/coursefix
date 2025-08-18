// src/server/server.js

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import uploadHandler from './uploadHandler.js';

// 🟢 ESM __dirname fix
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ⚠️ CHANGE THIS if your index.html is not in src/public
// Example: if it's in src/frontend, use '../frontend'
const publicPath = path.join(__dirname, '../frontend');

const app = express();

// ✅ Allow larger payloads if needed (transcripts, PDFs, etc.)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ✅ Serve static files (JS, CSS, images, index.html, etc.)
app.use(express.static(publicPath));

// ✅ Explicitly serve index.html at root
app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// ✅ API routes (all /api/* handled by uploadHandler router)
app.use('/api', uploadHandler);

// ✅ Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});