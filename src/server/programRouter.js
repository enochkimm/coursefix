// src/server/programsRouter.js
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();

// locate the big catalog JSON
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

/**
 * GET /api/programs
 * Returns a flat list [{ school, program, url }]
 */
router.get('/programs', (_req, res) => {
  const out = [];
  for (const school of Object.keys(CATALOG)) {
    const progs = CATALOG[school] || {};
    for (const name of Object.keys(progs)) {
      out.push({
        school,
        program: name,
        url: progs[name]?.url || null
      });
    }
  }
  // sort by school then program
  out.sort((a, b) => (a.school.localeCompare(b.school) || a.program.localeCompare(b.program)));
  res.json({ ok: true, programs: out });
});

export default router;