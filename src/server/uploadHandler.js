// src/server/uploadHandler.js
// All-in-one: PDF → parse → match → find program → progress → plan → validate
// Returns top-level: { ok, parsed, match, progress, plan, validation }

import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { extractTextFromPDF } from '../utils/pdfToText.js';
import { parseTranscriptText } from '../transcriptReader/index.js';
import { matchTranscriptToCatalog } from '../transcriptReader/matcher.js';

import { computeProgress } from '../ai/progress.js';
import { buildPlan } from '../ai/planner.js';
import { validatePlan } from '../ai/validate.js';
import { buildOverlapUsage, checkOverlapPolicy } from '../ai/overlap.js';

const router = express.Router();
const upload = multer({ limits: { fileSize: 15 * 1024 * 1024 } });

// __dirname (ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load catalog once
const REQUIREMENTS_PATH = path.join(__dirname, '../data/requirements/requirements_all_schools.json');
let CATALOG = {};
try {
  CATALOG = JSON.parse(fs.readFileSync(REQUIREMENTS_PATH, 'utf-8'));
  console.log('📘 Loaded requirements JSON (schools):', Object.keys(CATALOG).length);
} catch (e) {
  console.warn('⚠️ Could not load requirements JSON:', e.message);
  CATALOG = {};
}

// helpers
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();

// find a program by name across schools (exact → fuzzy)
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
  // fuzzy
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

/**
 * POST /api/upload
 * Accepts:
 *  - multipart: file field "transcript" (PDF)
 *  - OR JSON: { courses:[{code,semester}], program?, constraints? }
 * Returns:
 *  { ok, parsed, match, progress, plan, validation }
 */
router.post('/upload', upload.single('transcript'), async (req, res) => {
  try {
    console.log('➡️  /api/upload hit');

    // 1) Parse transcript
    let parsed = [];
    if (req.file?.buffer) {
      const text = await extractTextFromPDF(req.file.buffer);
      parsed = parseTranscriptText(text) || [];
    } else if (Array.isArray(req.body?.courses)) {
      parsed = req.body.courses.map(c => ({
        semester: c.semester || null,
        code: norm(c.code),
      }));
    }
    if (!parsed.length) {
      return res.status(400).json({ ok: false, error: 'No courses parsed. Upload a PDF or send {courses:[...]}.' });
    }
    console.log('📚 Parsed transcript courses:', parsed);

    // 2) “Match” (your existing matcher; keep behavior)
    const matched = (matchTranscriptToCatalog(parsed) || []).map(m => ({
      ...m,
      code: norm(m.code || m.matchedCode || m.courseCode || '')
    }));

    // 3) Normalize to student course list for planning
    const student = matched
      .map(x => ({ code: x.code, semester: x.semester || null }))
      .filter(x => x.code);

    // 4) Choose program + constraints (allow override from client)
    const program = req.body?.program || 'Interactive Media Arts (BFA)';
    let constraints = req.body?.constraints || {
      campus: ['nyc'],
      credit_load: { target: 16, max: 18 }
    };
    // handle stringified constraints (multipart form)
    if (typeof constraints === 'string') {
      try { constraints = JSON.parse(constraints); } catch { constraints = { campus: ['nyc'], credit_load: { target:16, max:18 } }; }
    }

    // 5) Find program rules
    const match = findProgram(program);
    if (!match || !Array.isArray(match.obj?.rules)) {
      return res.status(404).json({ ok: false, error: `Program not found: ${program}` });
    }

    // 6) Progress
    const progress = computeProgress(match.obj.rules, student);

    // Pretty console for progress
    console.log('✅ Satisfied rules:');
    for (const s of progress.satisfied) {
      if (s.type === 'REQUIRE') {
        console.log(`  - ${s.label || 'REQUIRE'} ← ${s.course.code} (${s.earned}cr)`);
      } else if (s.type === 'GROUP_SELECT') {
        const picks = (s.picks || []).map(p => p.code).join(', ');
        console.log(`  - ${s.label || 'GROUP_SELECT'} ← ${s.earned}cr via ${picks}`);
      }
    }
    console.log('⏳ Pending rules:');
    for (const p of progress.pending) {
      console.log(`  - ${p.label || p.type} needs ${p.needCredits ?? 0}cr`);
    }

    // 7) Plan
    const plan = buildPlan({
      gaps: progress.gaps,
      alreadyTaken: student,
      constraints
    });

    // 8) Overlap usage + policy (single program for now; extend later)
    const usage = buildOverlapUsage([{ programName: match.name, satisfied: progress.satisfied }]);
    const overlap = checkOverlapPolicy({
      usage,
      policy: {
        maxSharedCourses: 2,
        perProgram: { [match.name]: 2 },
        disallowList: []
      },
      programs: [match.name]
    });

    // 9) Validate (now includes overlap messages)
    const validation = validatePlan({
      picks: plan.picks,
      constraints,
      alreadyTaken: student,
      progress,
      overlap,
      bucketCaps: [] // you can set caps per bucket label later if desired
    });

    // Terminal summary
    console.log('🧠 Plan summary:', {
      program: match.name,
      required: progress.summary?.requiredCredits,
      completed: progress.summary?.completedCredits,
      picks: plan.picks?.length || 0,
      totalCredits: plan.totalCredits
    });
    const { ok, errors = [], warnings = [], totals } = validation;
    console.log(`🧪 Validation ok=${ok} credits=${totals?.credits ?? 0} courses=${totals?.courses ?? 0}`);
    if (errors.length) {
      console.log('  ❌ Errors:'); errors.forEach(e => console.log(`    - ${e}`));
    } else {
      console.log('  ❌ Errors: none');
    }
    if (warnings.length) {
      console.log('  ⚠️ Warnings:'); warnings.forEach(w => console.log(`    - ${w}`));
    } else {
      console.log('  ⚠️ Warnings: none');
    }

    // 10) Respond (top-level blocks; no nested {plan:{...}} shape)
    return res.json({
      ok: true,
      parsed: matched, // keep your matched fields for now
      match: { school: match.school, program: match.name, url: match.obj.url || null },
      progress,
      plan,
      validation
    });

  } catch (err) {
    console.error('❌ Upload handler error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to process transcript.' });
  }
});

export default router;