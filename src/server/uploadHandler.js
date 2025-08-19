// src/server/uploadHandler.js
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

const router = express.Router();
const upload = multer();

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

  for (const school of Object.keys(CATALOG)) {
    const progs = CATALOG[school] || {};
    for (const name of Object.keys(progs)) {
      if (name.toLowerCase() === q) return { school, name, obj: progs[name] };
    }
  }
  // fuzzy fallback
  const qt = new Set(q.split(/[^a-z0-9]+/).filter(Boolean));
  let best = null, bestScore = 0;
  for (const school of Object.keys(CATALOG)) {
    const progs = CATALOG[school] || {};
    for (const name of Object.keys(progs)) {
      const ct = new Set(name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
      const inter = [...qt].filter(t => ct.has(t)).length;
      const score = inter / Math.max(1, qt.size);
      if (score > bestScore) { bestScore = score; best = { school, name, obj: progs[name] }; }
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
 *  { ok, parsed, matchedCount, total, unmatched, plan }
 */
router.post('/upload', upload.single('transcript'), async (req, res) => {
  try {
    let parsed = [];

    // A) PDF path
    if (req.file?.buffer) {
      // NOTE: ignore the pdf.js font warning for now; extraction still works
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

    // Match to catalog (your existing function)
    const matched = (matchTranscriptToCatalog(parsed) || []).map(m => ({
      ...m,
      code: norm(m.code || m.matchedCode || m.courseCode || '')
    }));

    // Prepare for planning
    const studentCourses = matched
      .map(x => ({ code: x.code, semester: x.semester || null }))
      .filter(x => x.code);

    // —— PLAN: default to IMA BFA unless client provides program —— //
    const program = req.body?.program || 'Interactive Media Arts (BFA)';
    const constraints = req.body?.constraints || { campus: ['nyc'], credit_load: { target: 16, max: 18 } };

    let planBlock = null;
    const match = findProgram(program);
    if (!match || !Array.isArray(match.obj?.rules)) {
      planBlock = { error: `Program not found: ${program}` };
    } else {
      const progress = computeProgress(match.obj.rules, studentCourses);
      const plan = buildPlan({
        gaps: progress.gaps,
        alreadyTaken: studentCourses,
        constraints
      });
      planBlock = {
        match: { school: match.school, program: match.name, url: match.obj.url || null },
        progress,
        plan
      };
      console.log('🧠 Plan summary:', {
        program: match.name,
        required: progress.summary?.requiredCredits,
        completed: progress.summary?.completedCredits,
        picks: plan.picks?.length || 0,
        totalCredits: plan.totalCredits
      });
    }

    return res.json({
      ok: true,
      parsed: matched,
      matchedCount: matched.filter(c => c.matched).length || 0,
      total: matched.length,
      unmatched: matched.filter(c => !c.matched),
      plan: planBlock
    });

  } catch (err) {
    console.error('❌ Upload handler error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to process transcript.' });
  }
});

export default router;