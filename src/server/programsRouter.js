// src/server/programsRouter.js
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REQUIREMENTS_PATH = path.join(__dirname, '../data/requirements/requirements_all_schools.json');

let CATALOG = {};
try {
  CATALOG = JSON.parse(fs.readFileSync(REQUIREMENTS_PATH, 'utf-8'));
  console.log('📘 [/api/programs] catalog schools:', Object.keys(CATALOG).length);
} catch (e) {
  console.warn('⚠️ Could not load requirements JSON for /api/programs:', e.message);
  CATALOG = {};
}

// Basic school→campus classification by school key text
function schoolCampus(schoolName = '') {
  const s = String(schoolName).toLowerCase();
  if (/(abu\s*dhabi|nyu\s*abudhabi)/i.test(s)) return 'abudhabi';
  if (/(shanghai|nyu\s*shanghai)/i.test(s)) return 'shanghai';
  // everything else is treated as New York
  return 'nyc';
}

function includeByCampus(school, campusFilters) {
  if (!campusFilters || campusFilters.length === 0) return true; // no filter → include all
  const sc = schoolCampus(school);
  return campusFilters.includes(sc);
}

/**
 * GET /api/programs
 * Query:
 *   ?q=substring      // optional text filter on program name
 *   ?campus=nyc[,abudhabi][,shanghai] // filter by campus
 * Returns: { ok:true, programs:[{ id, school, program, url }] }
 */
router.get('/programs', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const campusQ = String(req.query.campus || '').trim().toLowerCase();
  const campusFilters = campusQ
    ? campusQ.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  const out = [];
  for (const school of Object.keys(CATALOG)) {
    if (!includeByCampus(school, campusFilters)) continue;

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

  out.sort((a, b) => (a.school.localeCompare(b.school) || a.program.localeCompare(b.program)));
  res.json({ ok: true, programs: out });
});

export default router;