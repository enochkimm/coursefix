// src/ai/planner.js
// Planner that ONLY uses progress.gaps (v8 structure). No dependency on program.rules.
//
// Inputs:
//   buildPlan({ progress?, gaps?, alreadyTaken?, constraints? })
//
// Output:
//   { picks: [{code,title,credits,fulfills}], totalCredits, creditMin, creditMax, creditTarget, notes }
//
// Notes:
// - Robust against empty/zero credit_load (UI defaults to 0 if fields blank).
// - Honors campus + allow/block prefixes (if provided).
// - Greedy fill: REQUIRE first, then GROUP_SELECT, respecting credit cap.
// - If target isn't met, tries a light top-up from all remaining eligibles.

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();

function campusOf(code) {
  const c = norm(code);
  if (/-SHU\b/.test(c)) return 'shanghai';
  if (/-AD\b/.test(c))  return 'abudhabi';
  if (/-UA\b/.test(c) || /-UT\b/.test(c) || /-UE\b/.test(c) || /-UY\b/.test(c)) return 'nyc';
  return null;
}

function toNum(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : NaN;
}

function positiveOr(def, ...vals) {
  for (const v of vals) {
    const n = toNum(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return def;
}

function courseCredits(courseLike) {
  if (!courseLike) return 4;
  // numeric
  if (typeof courseLike.credits === 'number') return courseLike.credits || 4;
  // object {min,max}
  if (courseLike.credits && typeof courseLike.credits === 'object') {
    const min = toNum(courseLike.credits.min);
    const max = toNum(courseLike.credits.max);
    if (Number.isFinite(min) && Number.isFinite(max)) return min === max ? min : Math.max(min, max);
    if (Number.isFinite(max)) return max;
    if (Number.isFinite(min)) return min;
  }
  return 4;
}

function allowedByPolicies(code, { campus, allow_prefixes, block_prefixes } = {}) {
  const ncode = norm(code);

  // campus filter (if provided)
  if (Array.isArray(campus) && campus.length) {
    const c = (campusOf(code) || '').toLowerCase();
    const allowed = campus.map((x) => String(x).toLowerCase());
    if (!allowed.includes(c)) return false;
  }

  // block list
  if (Array.isArray(block_prefixes) && block_prefixes.length) {
    if (block_prefixes.map(norm).some((pref) => ncode.startsWith(pref))) return false;
  }

  // allow list (if present, must match at least one)
  if (Array.isArray(allow_prefixes) && allow_prefixes.length) {
    if (!allow_prefixes.map(norm).some((pref) => ncode.startsWith(pref))) return false;
  }

  return true;
}

function buildEligibleMap(gaps) {
  // label -> array of {code,title,credits}
  const map = new Map();

  for (const g of gaps || []) {
    const label = String(g.label || g.kind || g.type || 'Unlabeled');
    const src   = Array.isArray(g.eligible) ? g.eligible : [];

    if (!map.has(label)) map.set(label, []);

    const bucket = map.get(label);
    const seen   = new Set(bucket.map((e) => norm(e.code)));

    for (const e of src) {
      const code = norm(e.code);
      if (!code || seen.has(code)) continue;
      bucket.push({
        code,
        title: e.title || null,
        credits: courseCredits(e)
      });
      seen.add(code);
    }
  }

  return map;
}

function pickForGap(label, needCredits, eligibleMap, ctx) {
  const picked = [];
  const pool = eligibleMap.get(label) || [];
  if (!pool.length) return picked;

  let remaining = Math.max(0, toNum(needCredits) || 0);
  while (remaining > 0 && ctx.creditCapRemaining > 0) {
    // choose the first viable course in pool not taken/used and allowed
    let choice = null;
    for (const opt of pool) {
      const code = norm(opt.code);
      if (ctx.takenSet.has(code)) continue;
      if (ctx.alreadyPickedSet.has(code)) continue;
      if (!allowedByPolicies(code, ctx.constraints)) continue;

      const cr = Math.max(0, toNum(opt.credits) || 0);
      if (cr <= 0) continue;
      if (ctx.creditCapRemaining - cr < 0) continue; // do not exceed cap

      choice = opt;
      break;
    }

    if (!choice) break; // nothing fits

    picked.push({
      code: norm(choice.code),
      title: choice.title || null,
      credits: Math.max(0, toNum(choice.credits) || 0),
      fulfills: label
    });

    ctx.alreadyPickedSet.add(norm(choice.code));
    ctx.creditCapRemaining -= Math.max(0, toNum(choice.credits) || 0);
    remaining -= Math.max(0, toNum(choice.credits) || 0);
  }

  return picked;
}

export function buildPlan({ progress = null, gaps = null, alreadyTaken = [], constraints = {} } = {}) {
  const notes = [];
  const picks = [];

  // Resolve gaps strictly from progress if available
  const allGaps = Array.isArray(progress?.gaps) ? progress.gaps : Array.isArray(gaps) ? gaps : [];

  if (!allGaps.length) {
    notes.push('⚠️ No gaps provided from progress; nothing to plan.');
    return {
      picks,
      totalCredits: 0,
      creditTarget: 0,
      creditMin: 0,
      creditMax: 0,
      notes
    };
  }

  // Credit load defaults: treat 0/blank as "not provided"
  const creditMin    = positiveOr(12, constraints?.credit_load?.min);
  const creditMaxRaw = positiveOr(18, constraints?.credit_load?.max);
  const creditMax    = Math.max(creditMin, creditMaxRaw); // ensure max ≥ min
  const creditTarget = positiveOr(creditMin, constraints?.credit_load?.target);

  let creditCapRemaining = creditMax;

  // Taken & state
  const takenSet = new Set((alreadyTaken || []).map((c) => norm(c.code)));
  const alreadyPickedSet = new Set();

  // Eligible map per label
  const eligibleMap = buildEligibleMap(allGaps);

  // 1) REQUIRE first, then GROUP_SELECT, then anything else
  const requireGaps     = allGaps.filter((g) => (g.kind || g.type) === 'REQUIRE');
  const groupSelectGaps = allGaps.filter((g) => (g.kind || g.type) === 'GROUP_SELECT');
  const otherGaps       = allGaps.filter((g) => !['REQUIRE', 'GROUP_SELECT'].includes((g.kind || g.type)));

  const ctx = {
    takenSet,
    alreadyPickedSet,
    constraints,
    creditCapRemaining
  };

  function handleGap(gap) {
    if (ctx.creditCapRemaining <= 0) return;

    const label = String(gap.label || gap.kind || gap.type || 'Unlabeled');
    const need  = Math.max(0, toNum(gap.needCredits) || 0);

    if (need <= 0) return;

    const chosen = pickForGap(label, need, eligibleMap, ctx);
    picks.push(...chosen);

    const earned = chosen.reduce((s, x) => s + (toNum(x.credits) || 0), 0);
    if (earned < need) {
      const poolSize = (eligibleMap.get(label) || []).length;
      notes.push(`Gap "${label}" still needs ~${Math.max(0, need - earned)} credits after filtering (pool=${poolSize}).`);
    }
  }

  // REQUIRE → GROUP_SELECT → other
  for (const g of requireGaps)     handleGap(g);
  for (const g of groupSelectGaps) handleGap(g);
  for (const g of otherGaps)       handleGap(g);

  // Refresh remaining cap (ctx mutated inside)
  creditCapRemaining = ctx.creditCapRemaining;

  // 2) Top-up: try to reach target with any remaining eligibles while respecting policies
  let totalCredits = picks.reduce((s, p) => s + (toNum(p.credits) || 0), 0);
  if (totalCredits < creditTarget && creditCapRemaining > 0) {
    const flat = [];
    for (const [label, arr] of eligibleMap.entries()) {
      for (const e of arr) flat.push({ ...e, fulfills: label });
    }

    // favor bigger-credit courses to reach target quicker
    flat.sort((a, b) => (toNum(b.credits) || 0) - (toNum(a.credits) || 0));

    for (const e of flat) {
      if (totalCredits >= creditTarget) break;

      const code = norm(e.code);
      const cr   = Math.max(0, toNum(e.credits) || 0);
      if (!cr) continue;
      if (takenSet.has(code) || alreadyPickedSet.has(code)) continue;
      if (!allowedByPolicies(code, constraints)) continue;
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

  // Final tally
  totalCredits = picks.reduce((s, p) => s + (toNum(p.credits) || 0), 0);

  return {
    picks,
    totalCredits,
    creditTarget,
    creditMin,
    creditMax,
    notes
  };
}