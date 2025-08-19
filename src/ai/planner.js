// src/ai/planner.js
// Greedy planner: turns gaps into concrete picks under simple constraints.
// Supports optional constraints.top_up_prefixes: string[] of code prefixes to use as extra candidates.

const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toUpperCase();

// crude campus check by code suffix
function campusOf(code) {
  if (!code) return null;
  const c = norm(code);
  if (/-UA\b/.test(c) || /-UT\b/.test(c) || /-UE\b/.test(c) || /-UY\b/.test(c)) return "nyc";
  if (/-SHU\b/.test(c)) return "shanghai";
  if (/-AD\b/.test(c)) return "abudhabi";
  return null; // unknown
}

function pickCredits(defaultCredits, explicit) {
  if (typeof explicit === "number") return explicit;
  if (explicit?.min) return explicit.min;
  return defaultCredits ?? 4;
}

/**
 * Build a simple plan from gaps.
 * @param {Object} args
 * @param {Array} args.gaps - from computeProgress (each: {kind,label,needCredits,eligible[]})
 * @param {Array} args.alreadyTaken - [{code}] list to avoid duplicates
 * @param {Object} args.constraints - { campus?: ['nyc'], credit_load?: {target,min,max}, top_up_prefixes?: string[] }
 * @returns {Object} { picks: [{code, label, credits, fulfills}], totalCredits, notes }
 */
export function buildPlan({ gaps = [], alreadyTaken = [], constraints = {} } = {}) {
  const takenSet = new Set((alreadyTaken || []).map(c => norm(c.code)));
  const allowedCampus = Array.isArray(constraints.campus) && constraints.campus.length
    ? new Set(constraints.campus.map(x => String(x).toLowerCase()))
    : null;

  const creditTarget = constraints.credit_load?.target ?? 16;
  const creditMin    = constraints.credit_load?.min ?? Math.max(12, Math.min(creditTarget, 16));
  const creditMax    = constraints.credit_load?.max ?? Math.max(creditTarget, 18);

  const topUpPrefixes = Array.isArray(constraints.top_up_prefixes)
    ? constraints.top_up_prefixes.map(norm)
    : [];

  const picks = [];
  let totalCredits = 0;
  const notes = [];

  // 1) Satisfy each gap greedily
  for (const gap of gaps) {
    let remaining = gap.needCredits ?? 0;
    if (remaining <= 0) continue;

    // Build filtered candidate list from gap.eligible
    let candidates = Array.isArray(gap.eligible) ? gap.eligible.slice() : [];
    candidates = candidates
      .filter(c => c && c.code)
      .map(c => ({
        code: norm(c.code),
        title: c.title || null,
        credits: pickCredits(4, c.credits),
        campus: campusOf(c.code)
      }))
      .filter(c => !takenSet.has(c.code))
      .filter(c => (allowedCampus ? allowedCampus.has(c.campus || "") : true))
      .filter((c, i, arr) => arr.findIndex(x => x.code === c.code) === i);

    // Greedy add until we satisfy this gap's credits
    for (const cand of candidates) {
      if (remaining <= 0) break;
      if (picks.find(p => p.code === cand.code)) continue;
      // If adding would exceed hard creditMax too early, skip (only for top-offs, not gaps).
      // Here we prioritize fulfilling the gap even if it pushes toward creditMax.
      picks.push({
        code: cand.code,
        title: cand.title,
        credits: cand.credits,
        fulfills: gap.label || gap.kind
      });
      totalCredits += cand.credits;
      remaining -= cand.credits;
      takenSet.add(cand.code);
    }

    if (remaining > 0) {
      notes.push(`Gap "${gap.label || gap.kind}" still needs ~${remaining} credits after filtering.`);
    }
  }

  // 2) If we’re under target, optionally top up
  if (totalCredits < creditTarget) {
    // Build a pool from:
    //   a) leftover eligible items across gaps
    //   b) top_up_prefixes (if provided)
    const poolMap = new Map();

    // a) from gaps
    for (const g of gaps) {
      for (const c of g.eligible || []) {
        const code = norm(c.code);
        if (!code || takenSet.has(code) || picks.find(p => p.code === code)) continue;
        const credits = pickCredits(4, c.credits);
        const campus  = campusOf(code);
        if (allowedCampus && !allowedCampus.has(campus || "")) continue;
        if (!poolMap.has(code)) {
          poolMap.set(code, {
            code, title: c.title || null, credits,
            source: g.label || g.kind
          });
        }
      }
    }

    // b) from top_up_prefixes (synthetic candidates)
    if (topUpPrefixes.length) {
      // We don't have a full global catalog here, so we can only “suggest”
      // additional picks if they already appeared in rules as options.
      // (If you want to open this up to *any* catalog course, we need a course list by prefix.)
      for (const g of gaps) {
        for (const c of g.eligible || []) {
          const code = norm(c.code);
          if (!code) continue;
          if (topUpPrefixes.some(pref => code.startsWith(pref))) {
            if (!poolMap.has(code) && !takenSet.has(code) && !picks.find(p => p.code === code)) {
              const credits = pickCredits(4, c.credits);
              const campus  = campusOf(code);
              if (allowedCampus && !allowedCampus.has(campus || "")) continue;
              poolMap.set(code, { code, title: c.title || null, credits, source: 'top-up(prefix)' });
            }
          }
        }
      }
    }

    const pool = [...poolMap.values()];
    // Prefer 4-credit courses to hit targets neatly
    pool.sort((a, b) => Math.abs(a.credits - 4) - Math.abs(b.credits - 4));

    for (const cand of pool) {
      if (totalCredits >= creditTarget) break;
      if (picks.find(p => p.code === cand.code)) continue;
      if (totalCredits + cand.credits > creditMax) continue;

      picks.push({
        code: cand.code,
        title: cand.title,
        credits: cand.credits,
        fulfills: `Top-up (${cand.source})`
      });
      totalCredits += cand.credits;
      takenSet.add(cand.code);
    }
  }

  return { picks, totalCredits, creditTarget, creditMin, creditMax, notes };
}