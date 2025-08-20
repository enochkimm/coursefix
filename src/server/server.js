// src/server/server.js
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import uploadHandler from './uploadHandler.js';
import plan from './plan.js';
import programsRouter from './programsRouter.js'; // ⬅️ NEW

// --- ESM __dirname fix ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Resolve UI folder (frontend) ---
const publicPath = path.join(__dirname, '../frontend');
if (!fs.existsSync(path.join(publicPath, 'index.html'))) {
  console.warn('⚠️  Expected UI at src/frontend/index.html but not found. API will still run.');
}

const app = express();

// --- Body parsers (increase limits for transcripts/PDFs) ---
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// --- Static UI ---
app.use(express.static(publicPath));
app.get('/', (_req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// --- API routes ---
app.use('/api', uploadHandler);   // e.g. POST /api/upload
app.post('/api/plan', plan);      // POST body: { program, transcript, constraints? }
app.use('/api', programsRouter);  // ⬅️ NEW: GET /api/programs

// --- Health & 404 ---
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  console.log(`🖥️  Serving UI from: ${publicPath}`);
});