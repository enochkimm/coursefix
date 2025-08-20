// src/server/server.js
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import programsRouterFactory from './programsRouter.js';
import uploadRouterFactory from './uploadHandler.js';
import planHandlerFactory from './plan.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Load catalog ONCE ---
const REQUIREMENTS_PATH = path.join(__dirname, '../data/requirements/requirements_all_schools.json');
let CATALOG = {};
try {
  CATALOG = JSON.parse(fs.readFileSync(REQUIREMENTS_PATH, 'utf-8'));
  console.log('📘 Loaded requirements JSON (schools):', Object.keys(CATALOG).length);
} catch (e) {
  console.error('❌ Could not load requirements JSON:', e.message);
  CATALOG = {};
}

const app = express();

// Body parsers
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Static UI
const publicPath = path.join(__dirname, '../frontend');
app.use(express.static(publicPath));
app.get('/', (_req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// API routes (inject CATALOG so we don't re-read JSON)
app.use('/api', programsRouterFactory(CATALOG));      // GET /api/programs
app.use('/api', uploadRouterFactory(CATALOG));        // POST /api/upload
app.post('/api/plan', planHandlerFactory(CATALOG));   // POST /api/plan

// Health + 404
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  console.log(`🖥️  Serving UI from: ${publicPath}`);
});