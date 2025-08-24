// src/ai/planner.js
// Build a simple draft plan from progress.gaps,
// with strong guards so we never crash on missing/partial data.

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();

function campusOf(code) {
  const c = norm(code);
  if (/-SHU\b/.test(c)) return 'shanghai';
  if (/-AD\b/.test(c)) return 'abudhabi';
  if (/-UA\b/.test(c) || /-UT\b/.test(c) || /-UE\b/.test(c) || /-UY\b/.test(c)) return 'nyc';
  return null;
}

function toNumber(n, fall = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fall;
}

function courseCredits(course) {
  // try structured shapes first, then number, then fallback to 4
  if (!course) return 4;
  if (typeof course.credits === 'number') return course.credits || 4;
  if (course.credits && typeof course.credits === 'object') {
    const min = toNumber(course.credits.min, null);
    const max = toNumber(course.credits.max, null);
    if (min != null && max != null) return min === max ? min : max; // choose max if range
    if (min != null) return min;
    if (max != null) return max;
  }
  return 4;
}

function allowedByCampusAndPrefixes(code, { campus, allow_prefixes, block_prefixes }) {
  // campus
  if (Array.isArray(campus) && campus.length) {
    const c = (campusOf(code) || '').toLowerCase();
    if (!campus.map(x => String(x).toLowerCase()).includes(c)) return false;
  }
  // block list
  if (Array.isArray(block_prefixes) && block_prefixes.length) {
    const ncode = norm(code);
    if (block_prefixes.map(norm).some(pref => ncode.startsWith(pref))) return false;
  }
  // allow list (if present, must match one)
  if (Array.isArray(allow_prefixes) && allow_prefixes.length) {
    const ncode = norm(code);
    if (!allow_prefixes.map(norm).some(pref => ncode.startsWith(pref))) return false;
  }
  return true;
}

// pick from a label's eligible list with guards
function pickFromList(eligibleMap, label, needCredits, {
  takenSet,
  alreadyPickedSet,
  constraints,
  creditCapRemaining
}) {
  const result = [];
  if (!eligibleMap || typeof eligibleMap.get !== 'function') return result;

  const pool = eligibleMap.get(label) || [];
  if (!Array.isArray(pool) || pool.length === 0) return result;

  let remaining = toNumber(needCredits, 0);
  let capRemain = toNumber(creditCapRemaining, Infinity);

  for (const option of pool) {
    if (remaining <= 0 || capRemain <= 0) break;

    const code = norm(option.code);
    if (!code) continue;
    if (takenSet.has(code)) continue;
    if (alreadyPickedSet.has(code)) continue;
    if (!allowedByCampusAndPrefixes(code, constraints || {})) continue;

    const cr = courseCredits(option);
    if (cr <= 0) continue;

    // don’t exceed term cap; allow slight overshoot only if no max provided
    if (capRemain - cr < 0) continue;

    result.push({
      code,
      title: option.title || null,
      credits: cr,
      fulfills: label
    });

    remaining -= cr;
    capRemain -= cr;
    alreadyPickedSet.add(code);
  }

  return result;
}

export function buildPlan({
  gaps = [],
  alreadyTaken = [],
  constraints = {}
} = {}) {
  const notes = [];
  const picks = [];

  // credit bounds
  const creditMin = toNumber(constraints?.credit_load?.min, 12);
  const creditMax = toNumber(constraints?.credit_load?.max, 18);
  const creditTarget = toNumber(constraints?.credit_load?.target, creditMin);
  let creditCapRemaining = creditMax;

  // normalize taken
  const takenSet = new Set((alreadyTaken || []).map(c => norm(c.code)));

  // Build eligibleMap: label -> eligible array
  // We accept both REQUIRE and GROUP_SELECT gaps with an `eligible` array.
  const eligibleMap = new Map();
  for (const gap of gaps || []) {
    const label = String(gap.label || gap.kind || gap.type || 'Unlabeled');
    const elig = Array.isArray(gap.eligible) ? gap.eligible : [];
    if (!eligibleMap.has(label)) eligibleMap.set(label, []);
    // push unique by code
    const existing = eligibleMap.get(label);
    const seen = new Set(existing.map(e => norm(e.code)));
    for (const e of elig) {
      const c = norm(e.code);
      if (!c || seen.has(c)) continue;
      existing.push({
        code: c,
        title: e.title || null,
        credits: courseCredits(e)
      });
      seen.add(c);
    }
  }

  // Greedy fill for each gap in order, respecting credit cap.
  const alreadyPickedSet = new Set();
  for (const gap of gaps || []) {
    if (creditCapRemaining <= 0) {
      notes.push(`Credit cap reached (${creditMax}cr). Remaining gaps not filled in this draft.`);
      break;
    }

    const label = String(gap.label || gap.kind || gap.type || 'Unlabeled');
    const need = toNumber(gap.needCredits, 0);
    if (need <= 0) continue;

    const chosen = pickFromList(eligibleMap, label, need, {
      takenSet,
      alreadyPickedSet,
      constraints,
      creditCapRemaining
    });

    // add chosen courses
    for (const ch of chosen) {
      picks.push(ch);
      creditCapRemaining -= ch.credits || 0;
    }

    const earned = chosen.reduce((s, x) => s + (x.credits || 0), 0);
    if (earned < need) {
      const poolSize = (eligibleMap.get(label) || []).length;
      notes.push(`Gap "${label}" still needs ~${need - earned} credits after filtering (pool=${poolSize}).`);
    }
  }

  // If we didn’t hit target and there is room, try a very light "top-up" using allow_prefixes if provided.
  let totalCredits = picks.reduce((s, p) => s + (p.credits || 0), 0);
  if (totalCredits < creditTarget && creditCapRemaining > 0) {
    // find any leftover eligible across labels (just to meet load)
    const flat = [];
    for (const [label, arr] of eligibleMap.entries()) {
      for (const e of arr) {
        flat.push({ ...e, fulfills: label });
      }
    }
    // sort by credits desc-ish to reach target quickly
    flat.sort((a, b) => (b.credits || 0) - (a.credits || 0));

    for (const e of flat) {
      if (totalCredits >= creditTarget) break;
      const code = norm(e.code);
      if (takenSet.has(code) || alreadyPickedSet.has(code)) continue;
      if (!allowedByCampusAndPrefixes(code, constraints || {})) continue;

      const cr = e.credits || 0;
      if (cr <= 0) continue;
      if (creditCapRemaining - cr < 0) continue;

      picks.push({ code, title: e.title || null, credits: cr, fulfills: e.fulfills });
      alreadyPickedSet.add(code);
      creditCapRemaining -= cr;
      totalCredits += cr;
    }

    if (totalCredits < creditTarget) {
      notes.push(`Couldn’t reach target load (${creditTarget}cr). Planned ${totalCredits}cr within max ${creditMax}cr.`);
    }
  }

  // Final tallies
  totalCredits = picks.reduce((s, p) => s + (p.credits || 0), 0);

  return {
    picks,
    totalCredits,
    creditTarget,
    creditMin,
    creditMax,
    notes
  };
}