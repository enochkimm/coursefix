// src/server/uploadHandler.js
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

// ── __dirname (ESM) ───────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Paths ─────────────────────────────────────────────────────────────────────
// Program requirements (by school)
const REQUIREMENTS_PATH = path.join(
  __dirname,
  '../data/requirements/requirements_all_schools.json'
);

// Course catalog (with prerequisites/corequisites/restrictions)
const COURSES_PATH = path.join(
  __dirname,
  '../data/courseScraper/allCourses.json' // ← set this to your real filename
);

// ── Load requirements once ────────────────────────────────────────────────────
let CATALOG = {};
try {
  CATALOG = JSON.parse(fs.readFileSync(REQUIREMENTS_PATH, 'utf-8'));
  console.log('📘 Loaded requirements JSON (schools):', Object.keys(CATALOG).length);
} catch (e) {
  console.warn('⚠️ Could not load requirements JSON:', e.message);
  CATALOG = {};
}

// ── Build tolerant course index ───────────────────────────────────────────────
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();

function codeVariants(raw) {
  const c = norm(raw);
  const set = new Set();
  set.add(c);
  set.add(c.replace(/\s+/g, ' '));          // single spaces
  set.add(c.replace(/\s+/g, ''));           // no spaces
  set.add(c.replace(/-\s+/g, '-'));         // collapse "-   " → "-"
  set.add(c.replace(/([A-Z]{2,}-[A-Z]{2,})\s+(\d)/, '$1 $2')); // "IMNY-UT   400" -> "IMNY-UT 400"
  set.add(c.replace(/(\d)[A-Z]$/, '$1'));   // strip trailing section letter (400A -> 400)
  return Array.from(set);
}

function indexCourses(coursesObj) {
  const index = new Map();
  let count = 0;

  // If your allCourses file is an array: [{code, title, requirements, ...}, ...]
  // If it's keyed by code: { "IMNY-UT 101": {...}, ... }
  const entries = Array.isArray(coursesObj)
    ? coursesObj.map((c) => [norm(c.code || ''), c])
    : Object.entries(coursesObj).map(([k, v]) => [norm(k), v]);

  for (const [key, course] of entries) {
    if (!key) continue;
    const variants = codeVariants(key);
    for (const v of variants) {
      if (!index.has(v)) {
        index.set(v, course);
        count++;
      }
      // also index tight/no-space variant
      const tight = v.replace(/\s+/g, '');
      if (!index.has(tight)) {
        index.set(tight, course);
        count++;
      }
    }
  }
  return { index, count };
}

let COURSE_INDEX = new Map();
try {
  const catalog = JSON.parse(fs.readFileSync(COURSES_PATH, 'utf-8'));
  const { index, count } = indexCourses(catalog);
  COURSE_INDEX = index;
  console.log(`📗 Loaded course catalog for prereq/coreq checks: ${COURSE_INDEX.size} keys (${count} inserts)`);
} catch (e) {
  console.warn('⚠️ Course catalog not found — prereq/coreq checks will be limited.', e.message);
  COURSE_INDEX = new Map();
}

// ── helpers ───────────────────────────────────────────────────────────────────
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

// ── Route: POST /api/upload (PDF or JSON courses) ────────────────────────────
router.post('/upload', upload.single('transcript'), async (req, res) => {
  try {
    let parsed = [];

    // A) PDF path
    if (req.file?.buffer) {
      const text = await extractTextFromPDF(req.file.buffer);
      parsed = parseTranscriptText(text) || [];
    }

    // B) JSON dev path
    if (!req.file?.buffer && Array.isArray(req.body?.courses)) {
      parsed = req.body.courses.map(c => ({
        semester: c.semester || null,
        code: norm(c.code)
      }));
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return res.status(400).json({ ok: false, error: 'No courses parsed. Upload a PDF or send {courses:[...]}.' });
    }

    console.log('📚 Parsed transcript courses:', parsed);

    // Prepare student courses for planning
    const studentCourses = parsed
      .map(x => ({ code: norm(x.code), semester: x.semester || null }))
      .filter(x => x.code);

    // Program + constraints
    const program = req.body?.program || 'Interactive Media Arts (BFA)';
    let constraints = {};
    try {
      constraints = req.body?.constraints ? JSON.parse(req.body.constraints) : {};
    } catch {
      constraints = {};
    }

    const match = findProgram(program);
    if (!match || !Array.isArray(match.obj?.rules)) {
      return res.status(404).json({ ok: false, error: `Program not found: ${program}` });
    }

    // 1) Compute progress
    const progress = computeProgress(match.obj.rules, studentCourses);

    // 2) Build plan
    const plan = buildPlan({
      gaps: progress.gaps,
      alreadyTaken: studentCourses,
      constraints
    });

    // 3) Validate plan (NOW with courseIndex)
    const validation = validatePlan({
      picks: plan.picks,
      constraints,
      alreadyTaken: studentCourses,
      progress,
      courseIndex: COURSE_INDEX, // ← important
      overlap: { messages: [] }, // you can wire real overlap messages later
      bucketCaps: []             // wire caps if you have them per program
    });

    console.log('🧠 Plan summary:', {
      program: match.name,
      required: progress.summary?.requiredCredits,
      completed: progress.summary?.completedCredits,
      picks: plan.picks?.length || 0,
      totalCredits: plan.totalCredits
    });
    console.log(`🧪 Validation ok=${validation.ok} credits=${validation.totals?.credits || 0} courses=${validation.totals?.courses || 0}`);
    if (validation.errors?.length) {
      console.log('  ❌ Errors:'); validation.errors.forEach(e => console.log('    -', e));
    }
    if (validation.warnings?.length) {
      console.log('  ⚠️ Warnings:', validation.warnings.length);
      validation.warnings.slice(0, 6).forEach(w => console.log('    -', w));
      if (validation.warnings.length > 6) console.log(`    … +${validation.warnings.length - 6} more`);
    }

    return res.json({
      ok: true,
      parsed: studentCourses.map(c => ({ ...c, matched: true })),
      matchedCount: studentCourses.length,
      total: studentCourses.length,
      unmatched: [],
      plan: {
        match: { school: match.school, program: match.name, url: match.obj.url || null },
        progress,
        plan,
        validation
      }
    });

  } catch (err) {
    console.error('❌ Upload handler error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to process transcript.' });
  }
});

export default router;