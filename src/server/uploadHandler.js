// src/server/uploadHandler.js
import express from 'express';
import multer from 'multer';

import { extractTextFromPDF } from '../utils/pdfToText.js';
import { parseTranscriptText } from '../transcriptReader/index.js';
import { matchTranscriptToCatalog } from '../transcriptReader/matcher.js';

import { computeProgress } from '../ai/progress.js';
import { buildPlan } from '../ai/planner.js';
import { validatePlan } from '../ai/validate.js';

const upload = multer();
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();

// simple program finder across schools
function findProgram(CATALOG, programName) {
  if (!programName) return null;
  const q = String(programName).toLowerCase();
  // exact
  for (const school of Object.keys(CATALOG)) {
    for (const name of Object.keys(CATALOG[school] || {})) {
      if (name.toLowerCase() === q) return { school, name, obj: CATALOG[school][name] };
    }
  }
  // fuzzy token overlap
  const qt = new Set(q.split(/[^a-z0-9]+/).filter(Boolean));
  let best = null, bestScore = 0;
  for (const school of Object.keys(CATALOG)) {
    for (const name of Object.keys(CATALOG[school] || {})) {
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

export default function uploadRouterFactory(CATALOG) {
  const router = express.Router();

  router.post('/upload', upload.single('transcript'), async (req, res) => {
    try {
      console.log('➡️  /api/upload hit');

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

      // Match transcript to catalog (your existing function)
      const matched = (matchTranscriptToCatalog(parsed) || []).map(m => ({
        ...m,
        code: norm(m.code || m.matchedCode || m.courseCode || '')
      }));

      // Prepare for planning
      const studentCourses = matched
        .map(x => ({ code: x.code, semester: x.semester || null }))
        .filter(x => x.code);

      const program = req.body?.program || '';
      const constraints = (() => {
        try { return req.body?.constraints ? JSON.parse(req.body.constraints) : {}; }
        catch { return {}; }
      })();

      let planBlock = { error: 'Program not selected.' };
      if (program) {
        const match = findProgram(CATALOG, program);
        if (!match || !Array.isArray(match.obj?.rules)) {
          planBlock = { error: `Program not found: ${program}` };
        } else {
          const progress = computeProgress(match.obj.rules, studentCourses);

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
            alreadyTaken: studentCourses,
            constraints
          });

          const validation = validatePlan({
            picks: plan.picks,
            constraints,
            alreadyTaken: studentCourses,
            progress
          });

          console.log('🧠 Plan summary:', {
            program: match.name,
            required: progress.summary?.requiredCredits,
            completed: progress.summary?.completedCredits,
            picks: plan.picks?.length || 0,
            totalCredits: plan.totalCredits
          });
          console.log(`🧪 Validation ok=${!!validation.ok} credits=${plan.totalCredits} courses=${plan.picks?.length || 0}`);
          if ((validation.errors || []).length) {
            console.log('  ❌ Errors:'); validation.errors.forEach(e => console.log('    -', e));
          }
          if ((validation.warnings || []).length) {
            console.log('  ⚠️ Warnings:', validation.warnings.join('; '));
          }

          planBlock = {
            match: { school: match.school, program: match.name, url: match.obj.url || null },
            progress,
            plan,
            validation
          };
        }
      }

      return res.json({
        ok: true,
        parsed: matched,
        matchedCount: matched.filter(c => c.matched).length || 0,
        total: matched.length,
        unmatched: matched.filter(c => !c.matched),
        ...(program ? { ...planBlock } : { plan: planBlock })
      });

    } catch (err) {
      console.error('❌ Upload handler error:', err);
      return res.status(500).json({ ok: false, error: 'Failed to process transcript.' });
    }
  });

  return router;
}