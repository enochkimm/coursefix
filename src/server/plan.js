// src/server/plan.js
// Factory that returns a single handler for POST /api/plan

import { computeProgress } from '../ai/progress.js';
import { buildPlan } from '../ai/planner.js';
import { validatePlan } from '../ai/validate.js';

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();

function findProgram(CATALOG, programName) {
  if (!programName) return null;
  const q = String(programName).toLowerCase();
  // exact first
  for (const school of Object.keys(CATALOG)) {
    for (const name of Object.keys(CATALOG[school] || {})) {
      if (name.toLowerCase() === q) return { school, name, obj: CATALOG[school][name] };
    }
  }
  // fuzzy
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

export default function planHandlerFactory(CATALOG) {
  return function planHandler(req, res) {
    try {
      const { program, transcript = [], constraints = {} } = req.body || {};
      if (!program) return res.status(400).json({ ok: false, error: "Missing 'program'." });

      const student = (Array.isArray(transcript) ? transcript : [])
        .map(c => ({ ...c, code: norm(c.code) }))
        .filter(c => c.code);

      const match = findProgram(CATALOG, program);
      if (!match || !Array.isArray(match.obj?.rules)) {
        return res.status(404).json({ ok: false, error: `Program not found: ${program}` });
      }

      const progress = computeProgress(match.obj.rules, student);
      const plan = buildPlan({ gaps: progress.gaps, alreadyTaken: student, constraints });
      const validation = validatePlan({
        picks: plan.picks,
        constraints,
        alreadyTaken: student,
        progress
      });

      console.log('🧠 /api/plan summary:', {
        program: match.name,
        required: progress.summary?.requiredCredits,
        completed: progress.summary?.completedCredits,
        picks: plan.picks?.length || 0,
        totalCredits: plan.totalCredits,
        valid: validation.ok
      });

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
  };
}