// src/server/programsRouter.js
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 👉 Adjust if your file is elsewhere
const REQUIREMENTS_PATH = path.join(
  __dirname,
  '../data/requirements/requirements_all_schools.json'
);

let CATALOG = {};
try {
  const raw = fs.readFileSync(REQUIREMENTS_PATH, 'utf-8');
  CATALOG = JSON.parse(raw);
  console.log('📘 [/api/programs] catalog schools:', Object.keys(CATALOG || {}).length);
} catch (e) {
  console.warn('⚠️ Could not load requirements JSON for /api/programs:', e.message);
  CATALOG = {};
}

function schoolCampus(s = '') {
  const t = s.toLowerCase();
  if (t.includes('abu dhabi') || t.includes('nyu abu dhabi')) return 'abudhabi';
  if (t.includes('shanghai') || t.includes('nyu shanghai')) return 'shanghai';
  return 'nyc';
}
function includeByCampus(school, filters) {
  if (!filters || !filters.length) return true;
  return filters.includes(schoolCampus(school));
}

/**
 * GET /api/programs
 * ?q=substring
 * ?campus=nyc[,abudhabi][,shanghai]
 */
router.get('/programs', (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const filters = String(req.query.campus || '')
      .toLowerCase()
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const out = [];
    for (const school of Object.keys(CATALOG || {})) {
      if (!includeByCampus(school, filters)) continue;
      const progs = CATALOG[school] || {};
      for (const name of Object.keys(progs)) {
        if (!q || name.toLowerCase().includes(q)) {
          out.push({
            id: `${school}::${name}`,
            school,
            program: name,
            url: progs[name]?.url || null
          });
        }
      }
    }

    // A→Z by program name
    out.sort((a, b) => a.program.localeCompare(b.program, 'en'));

    console.log(`🔎 /api/programs → ${out.length} programs (filters=${filters.join('|') || 'none'})`);
    return res.json({ ok: true, programs: out });
  } catch (err) {
    console.error('❌ /api/programs error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to load programs' });
  }
});

export default router;