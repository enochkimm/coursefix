// src/server/plan.js
// Merged planner router: supports JSON + PDF upload flows.

import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { computeProgress } from '../ai/progress.js';
import { buildPlan } from '../ai/planner.js';
import { validatePlan } from '../ai/validate.js';

// Only needed for the /plan-upload (PDF) route:
import { extractTextFromPDF } from '../utils/pdfToText.js';
import { parseTranscriptText } from '../transcriptReader/index.js';

const router = express.Router();
const upload = multer();

// --- locate requirements JSON ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REQUIREMENTS_PATH = path.join(__dirname, '../data/requirements/requirements_all_schools.json');

let CATALOG = {};
try {
  CATALOG = JSON.parse(fs.readFileSync(REQUIREMENTS_PATH, 'utf-8'));
  console.log('📘 Loaded requirements JSON (schools):', Object.keys(CATALOG).length);
} catch (e) {
  console.error('❌ Could not load requirements JSON:', e.message);
  CATALOG = {};
}

// helpers
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();

/** find a program by name across schools (exact → fuzzy) */
function findProgram(programName) {
  if (!programName) return null;
  const q = String(programName).toLowerCase();

  // exact first
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

function summarizeConsole(match, progress, plan, validation, tag = '/api/plan') {
    console.log(`🧠 ${tag} summary:`, {
      program: match.name,
      required: progress.summary?.requiredCredits,
      completed: progress.summary?.completedCredits,
      picks: plan.picks?.length || 0,
      totalCredits: plan.totalCredits
    });
  
    // ✅ print validation arrays (not "messages")
    if (validation) {
      const { ok, errors = [], warnings = [], totals } = validation;
      console.log(`🧪 Validation ok=${ok} credits=${totals?.credits ?? 0} courses=${totals?.courses ?? 0}`);
  
      if (errors.length) {
        console.log('  ❌ Errors:');
        for (const e of errors) console.log(`    - ${e}`);
      } else {
        console.log('  ❌ Errors: none');
      }
  
      if (warnings.length) {
        console.log('  ⚠️ Warnings:');
        for (const w of warnings) console.log(`    - ${w}`);
      } else {
        console.log('  ⚠️ Warnings: none');
      }
    }
  }

// ---------------------------------------------------------------------------
// 1) JSON flow: POST /api/plan
// ---------------------------------------------------------------------------
router.post('/plan', async (req, res) => {
  try {
    const { program, transcript = [], constraints = {} } = req.body || {};
    if (!program) {
      return res.status(400).json({ ok: false, error: "Missing 'program' in request body." });
    }

    // normalize transcript
    const student = (Array.isArray(transcript) ? transcript : [])
      .map(c => ({ ...c, code: norm(c.code) }))
      .filter(c => c.code);

    const match = findProgram(program);
    if (!match || !Array.isArray(match.obj?.rules)) {
      return res.status(404).json({ ok: false, error: `Program not found: ${program}` });
    }

    const progress = computeProgress(match.obj.rules, student);
    const plan = buildPlan({ gaps: progress.gaps, alreadyTaken: student, constraints });
    const validation = validatePlan({ picks: plan.picks, constraints, alreadyTaken: student, progress });

    summarizeConsole(match, progress, plan, validation, '/api/plan');

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

// ---------------------------------------------------------------------------
// 2) PDF upload flow: POST /api/plan-upload
// ---------------------------------------------------------------------------
router.post('/plan-upload', upload.single('transcript'), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ ok: false, error: "Missing file field 'transcript'." });
    }

    const program = req.body?.program || 'Interactive Media Arts (BFA)';
    let constraints = {};
    if (req.body?.constraints) {
      try { constraints = JSON.parse(req.body.constraints); }
      catch { constraints = {}; }
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
    const plan = buildPlan({ gaps: progress.gaps, alreadyTaken: student, constraints });
    const validation = validatePlan({ picks: plan.picks, constraints, alreadyTaken: student, progress });

    summarizeConsole(match, progress, plan, validation, '/api/plan-upload');

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