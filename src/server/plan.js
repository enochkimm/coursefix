// src/server/plan.js
// JSON + PDF planning endpoints using the same catalog/requirements as uploadHandler.

import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { extractTextFromPDF } from '../utils/pdfToText.js';
import { parseTranscriptText } from '../transcriptReader/index.js';

import { computeProgress } from '../ai/progress.js';
import { buildPlan } from '../ai/planner.js';
import { validatePlan } from '../ai/validate.js';

const router = express.Router();
const upload = multer();

// --- ESM __dirname ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----------------------------
// Load degree requirements (same file as uploadHandler)
// ----------------------------
const REQUIREMENTS_PATH = path.join(
  __dirname,
  '../data/requirements/requirements_all_schools.json'
);

let CATALOG = {};
try {
  CATALOG = JSON.parse(fs.readFileSync(REQUIREMENTS_PATH, 'utf-8'));
  console.log('📘 Loaded requirements JSON (schools):', Object.keys(CATALOG).length);
} catch (e) {
  console.warn('⚠️ Could not load requirements JSON:', e.message);
  CATALOG = {};
}

// ----------------------------
// Load course catalog (same path as uploadHandler)
// ----------------------------
const COURSE_CATALOG_PATH = path.join(
  __dirname,
  '../data/courseScraper/allCourses.json' // ← make sure this matches your actual file
);

let COURSE_CATALOG = null;
try {
  COURSE_CATALOG = JSON.parse(fs.readFileSync(COURSE_CATALOG_PATH, 'utf-8'));
  console.log(
    '📗 Loaded course catalog for prereq/coreq checks:',
    Object.keys(COURSE_CATALOG).length,
    'entries'
  );
} catch (e) {
  console.warn('⚠️ Course catalog not found — prereq/coreq checks will be limited.');
  COURSE_CATALOG = null;
}

// Build CODE -> course map (what validate.js expects)
function buildCourseIndex(catalogObj) {
  const m = new Map();
  if (!catalogObj || typeof catalogObj !== 'object') return m;
  for (const [code, course] of Object.entries(catalogObj)) {
    if (code) m.set(code.toUpperCase(), course);
  }
  return m;
}
const COURSE_INDEX = buildCourseIndex(COURSE_CATALOG);

// helpers
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();

function findProgram(programName) {
  if (!programName) return null;
  const q = String(programName).toLowerCase();

  // exact
  for (const school of Object.keys(CATALOG)) {
    const progs = CATALOG[school] || {};
    for (const name of Object.keys(progs)) {
      if (name.toLowerCase() === q) return { school, name, obj: progs[name] };
    }
  }
  // fuzzy (token overlap)
  const qt = new Set(q.split(/[^a-z0-9]+/).filter(Boolean));
  let best = null, bestScore = 0;
  for (const school of Object.keys(CATALOG)) {
    const progs = CATALOG[school] || {};
    for (const name of Object.keys(progs)) {
      const ct = new Set(name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
      const inter = [...qt].filter(t => ct.has(t)).length;
      const score = inter / Math.max(1, qt.size);
      if (score > bestScore) {
        bestScore = score;
        best = { school, name, obj: progs[name] };
      }
    }
  }
  return best;
}

function summarizeConsole(match, progress, plan, tag) {
  console.log(`🧠 ${tag} summary:`, {
    program: match.name,
    required: progress.summary?.requiredCredits,
    completed: progress.summary?.completedCredits,
    picks: plan.picks?.length || 0,
    totalCredits: plan.totalCredits
  });
}

// ----------------------------
// POST /api/plan  (JSON body: { program, transcript[], constraints? })
// ----------------------------
router.post('/plan', async (req, res) => {
  try {
    const { program, transcript = [], constraints = {} } = req.body || {};
    if (!program) {
      return res.status(400).json({ ok: false, error: "Missing 'program' in request body." });
    }

    const student = (Array.isArray(transcript) ? transcript : [])
      .map(c => ({ ...c, code: norm(c.code) }))
      .filter(c => c.code);

    const match = findProgram(program);
    if (!match || !Array.isArray(match.obj?.rules)) {
      return res.status(404).json({ ok: false, error: `Program not found: ${program}` });
    }

    const progress = computeProgress(match.obj.rules, student);
    const plan = buildPlan({
      gaps: progress.gaps,
      alreadyTaken: student,
      constraints
    });

    const validation = validatePlan({
      picks: plan.picks,
      constraints,
      alreadyTaken: student,
      progress,
      courseIndex: COURSE_INDEX
    });

    summarizeConsole(match, progress, plan, '/api/plan');

    return res.json({
      ok: true,
      match: { school: match.school, program: match.name, url: match.obj.url || null },
      progress,
      plan,
      validation
    });
  } catch (err) {
    console.error('❌ /api/plan error:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Internal error' });
  }
});

// ----------------------------
// POST /api/plan-upload (multipart; file=transcript PDF)
// ----------------------------
router.post('/plan-upload', upload.single('transcript'), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ ok: false, error: "Missing file field 'transcript'." });
    }
    const program = req.body?.program || 'Interactive Media Arts (BFA)';
    let constraints = {};
    if (req.body?.constraints) {
      try { constraints = JSON.parse(req.body.constraints); } catch { constraints = {}; }
    }

    const text = await extractTextFromPDF(req.file.buffer);
    const parsed = parseTranscriptText(text) || [];
    const student = parsed.map(c => ({ ...c, code: norm(c.code) })).filter(c => c.code);

    console.log('📚 Parsed transcript courses:', student);

    const match = findProgram(program);
    if (!match || !Array.isArray(match.obj?.rules)) {
      return res.status(404).json({ ok: false, error: `Program not found: ${program}` });
    }

    const progress = computeProgress(match.obj.rules, student);

    console.log('✅ Satisfied rules:');
    for (const s of progress.satisfied) {
      if (s.type === 'REQUIRE') {
        console.log(`  - ${s.label || 'REQUIRE'} ← ${s.course.code} (${s.earned}cr)`);
      } else if (s.type === 'GROUP_SELECT') {
        console.log(`  - ${s.label || 'GROUP_SELECT'} ← ${s.earned}cr via ${(s.picks || []).map(p => p.code).join(', ')}`);
      }
    }
    console.log('⏳ Pending rules:');
    for (const p of progress.pending) {
      console.log(`  - ${p.label || p.type} needs ${p.needCredits ?? 0}cr`);
    }

    const plan = buildPlan({
      gaps: progress.gaps,
      alreadyTaken: student,
      constraints
    });

    const validation = validatePlan({
      picks: plan.picks,
      constraints,
      alreadyTaken: student,
      progress,
      courseIndex: COURSE_INDEX
    });

    summarizeConsole(match, progress, plan, '/api/plan-upload');

    return res.json({
      ok: true,
      parsed: student,
      match: { school: match.school, program: match.name, url: match.obj.url || null },
      progress,
      plan,
      validation
    });
  } catch (err) {
    console.error('❌ /api/plan-upload error:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Internal error' });
  }
});

export default router;