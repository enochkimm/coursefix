// src/server/plan.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { computeProgress } from '../ai/progress.js';
import { buildPlan } from '../ai/planner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// adjust if your file lives elsewhere
const REQUIREMENTS_PATH = path.join(__dirname, '../data/requirements/requirements_all_schools.json');

let CATALOG = {};
try {
  CATALOG = JSON.parse(fs.readFileSync(REQUIREMENTS_PATH, 'utf-8'));
  console.log('📘 Loaded requirements JSON (schools):', Object.keys(CATALOG).length);
} catch (e) {
  console.error('❌ Could not load requirements JSON:', e.message);
  CATALOG = {};
}

// simple finder: search across schools by program name (case-insensitive)
function findProgram(programName) {
  if (!programName) return null;
  const q = String(programName).toLowerCase();

  for (const school of Object.keys(CATALOG)) {
    const programs = CATALOG[school] || {};
    for (const name of Object.keys(programs)) {
      if (name.toLowerCase() === q) {
        return { school, name, obj: programs[name] };
      }
    }
  }
  // fuzzy: token overlap
  let best = null;
  let bestScore = 0;
  const qt = new Set(q.split(/[^a-z0-9]+/).filter(Boolean));
  for (const school of Object.keys(CATALOG)) {
    for (const name of Object.keys(CATALOG[school])) {
      const ct = new Set(name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
      const inter = [...qt].filter(t => ct.has(t)).length;
      const score = inter / Math.max(1, qt.size);
      if (score > bestScore) {
        bestScore = score;
        best = { school, name, obj: CATALOG[school][name] };
      }
    }
  }
  return best;
}

export default function planHandler(req, res) {
  try {
    const { transcript = [], program, constraints = {} } = req.body || {};
    if (!program) return res.status(400).json({ ok: false, error: "Missing 'program' string." });

    // normalize transcript codes
    const student = (Array.isArray(transcript) ? transcript : []).map(c => ({
      ...c,
      code: String(c.code || '').replace(/\s+/g, ' ').trim().toUpperCase()
    }));

    const match = findProgram(program);
    if (!match || !Array.isArray(match.obj?.rules)) {
      return res.status(404).json({ ok: false, error: `Program not found: ${program}` });
    }

    // 1) progress from rules
    const progress = computeProgress(match.obj.rules, student);

    // 2) plan from gaps
    const plan = buildPlan({
      gaps: progress.gaps,
      alreadyTaken: student,
      constraints // expects { campus?: [...], credit_load?: {target,min,max} }
    });

    return res.json({
      ok: true,
      match: { school: match.school, program: match.name, url: match.obj.url || null },
      progress,
      plan
    });
  } catch (err) {
    console.error('❌ /api/plan error:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Internal error' });
  }
}