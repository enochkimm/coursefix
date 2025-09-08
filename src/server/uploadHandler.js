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

// ── __dirname (ESM) ───────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Paths ─────────────────────────────────────────
const REQUIREMENTS_PATH = path.join(__dirname, '../data/requirements/requirements_all_schools.json');
const COURSES_PATH = path.join(__dirname, '../data/courseScraper/allCourses.json');

// ── Load requirements ─────────────────────────────
let CATALOG = {};
try {
  CATALOG = JSON.parse(fs.readFileSync(REQUIREMENTS_PATH, 'utf-8'));
  console.log('📘 Loaded requirements JSON (schools):', Object.keys(CATALOG).length);
} catch (e) {
  console.warn('⚠️ Could not load requirements JSON:', e.message);
  CATALOG = {};
}

// ── Build tolerant course index ───────────────────
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();

function codeVariants(raw) {
  const c = norm(raw);
  const set = new Set();
  set.add(c);
  set.add(c.replace(/\s+/g, ' '));
  set.add(c.replace(/\s+/g, ''));
  set.add(c.replace(/-\s+/g, '-'));
  set.add(c.replace(/([A-Z]{2,}-[A-Z]{2,})\s+(\d)/, '$1 $2'));
  set.add(c.replace(/(\d)[A-Z]$/, '$1'));
  return Array.from(set);
}

function indexCourses(coursesObj) {
  const index = new Map();
  const entries = Array.isArray(coursesObj)
    ? coursesObj.map((c) => [norm(c.code || ''), c])
    : Object.entries(coursesObj).map(([k, v]) => [norm(k), v]);

  for (const [key, course] of entries) {
    if (!key) continue;
    for (const v of codeVariants(key)) {
      if (!index.has(v)) index.set(v, course);
      const tight = v.replace(/\s+/g, '');
      if (!index.has(tight)) index.set(tight, course);
    }
  }
  return index;
}

let COURSE_INDEX = new Map();
try {
  const catalog = JSON.parse(fs.readFileSync(COURSES_PATH, 'utf-8'));
  COURSE_INDEX = indexCourses(catalog);
  console.log(`📗 Loaded course catalog: ${COURSE_INDEX.size} keys`);
} catch (e) {
  console.warn('⚠️ Course catalog not found:', e.message);
  COURSE_INDEX = new Map();
}

// ── Find program in new v7/v8 structure ───────────
function findProgram(programName) {
  if (!programName) return null;
  const q = String(programName).toLowerCase();

  // exact match inside each school.programs
  for (const school of Object.keys(CATALOG)) {
    const progs = CATALOG[school]?.programs || {};
    for (const name of Object.keys(progs)) {
      if (name.toLowerCase() === q) return { school, name, obj: progs[name] };
    }
  }

  // fuzzy match
  const qt = new Set(q.split(/[^a-z0-9]+/).filter(Boolean));
  let best = null, bestScore = 0;
  for (const school of Object.keys(CATALOG)) {
    const progs = CATALOG[school]?.programs || {};
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

// ── Route: POST /api/upload ───────────────────────
router.post('/upload', upload.single('transcript'), async (req, res) => {
  try {
    let parsed = [];

    if (req.file?.buffer) {
      const text = await extractTextFromPDF(req.file.buffer);
      parsed = parseTranscriptText(text) || [];
    }

    if (!req.file?.buffer && Array.isArray(req.body?.courses)) {
      parsed = req.body.courses.map(c => ({ semester: c.semester || null, code: norm(c.code) }));
    }

    if (!parsed.length) {
      return res.status(400).json({ ok: false, error: 'No courses parsed. Upload a PDF or send {courses:[...]}.' });
    }

    console.log('📚 Parsed transcript courses:', parsed);

    const studentCourses = parsed.map(x => ({ code: norm(x.code), semester: x.semester || null }));

    const program = req.body?.program || 'Interactive Media Arts (BFA)';
    let constraints = {};
    try {
      constraints = req.body?.constraints ? JSON.parse(req.body.constraints) : {};
    } catch { constraints = {}; }

    const match = findProgram(program);
    if (!match || !Array.isArray(match.obj?.rules)) {
      return res.status(404).json({ ok: false, error: `Program not found: ${program}` });
    }

    const progress = computeProgress(match.obj.rules, studentCourses);

    const plan = buildPlan({
      gaps: progress.gaps,
      alreadyTaken: studentCourses,
      constraints
    });

    const validation = validatePlan({
      picks: plan.picks,
      constraints,
      alreadyTaken: studentCourses,
      progress,
      courseIndex: COURSE_INDEX,
      overlap: { messages: [] },
      bucketCaps: []
    });

    console.log('🧠 Plan summary:', {
      program: match.name,
      required: progress.summary?.requiredCredits,
      completed: progress.summary?.completedCredits,
      picks: plan.picks?.length || 0,
      totalCredits: plan.totalCredits
    });

    return res.json({
      ok: true,
      parsed: studentCourses,
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