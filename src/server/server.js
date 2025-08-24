// src/server/server.js
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import uploadHandler from './uploadHandler.js';
import plan from './plan.js';
import programsRouter from './programsRouter.js';
import courseRouter from './courseRouter.js'; // ← NEW

// ESM __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve the frontend from src/frontend
const publicPath = path.join(__dirname, '../frontend');
if (!fs.existsSync(path.join(publicPath, 'index.html'))) {
  console.warn('⚠️  Expected UI at src/frontend/index.html but not found. API will still run.');
}

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Static UI
app.use(express.static(publicPath));
app.get('/', (_req, res) => res.sendFile(path.join(publicPath, 'index.html')));

// APIs
app.use('/api', programsRouter);
app.use('/api', courseRouter);   // ← NEW
app.use('/api', uploadHandler);
app.post('/api/plan', plan);

// Health & 404
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  console.log(`🖥️  Serving UI from: ${publicPath}`);
});