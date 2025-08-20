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
  const schools = Object.keys(CATALOG);
  console.log('📘 [/api/programs] catalog schools:', schools.length);

  // quick visibility: how many IMA-like entries?
  let imaCount = 0;
  for (const s of schools) {
    for (const name of Object.keys(CATALOG[s] || {})) {
      if (/interactive\s+media\s+arts/i.test(name)) imaCount++;
    }
  }
  console.log(`🔎 [/api/programs] found ${imaCount} "Interactive Media Arts" entries`);
} catch (e) {
  console.warn('⚠️ Could not load requirements JSON for /api/programs:', e.message);
  CATALOG = {};
}

/**
 * GET /api/programs
 * Optional: ?q=substring (case-insensitive)
 * Returns: { ok:true, programs:[{ id, school, program, url }] }
 */
router.get('/programs', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const out = [];

  for (const school of Object.keys(CATALOG)) {
    const progs = CATALOG[school] || {};
    for (const name of Object.keys(progs)) {
      if (!q || name.toLowerCase().includes(q)) {
        out.push({
          id: `${school}::${name}`,   // unique ID so frontend can render duplicates distinctly
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