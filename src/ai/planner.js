// src/ai/planner.js
// Greedy planner: turns gaps into concrete picks under simple constraints.

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
 * @param {Object} args.constraints - { campus?: ['nyc'], credit_load?: {target,min,max} }
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

  const picks = [];
  let totalCredits = 0;
  const notes = [];

  // Flatten eligible options per gap, filter, then greedily add until each gap's need is met
  for (const gap of gaps) {
    let remaining = gap.needCredits ?? 0;
    if (remaining <= 0) continue;

    // Build filtered candidate list
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
      // de-dup by code
      .filter((c, i, arr) => arr.findIndex(x => x.code === c.code) === i);

    // greedy: add until we satisfy this gap's credits
    for (const cand of candidates) {
      if (remaining <= 0) break;
      if (picks.find(p => p.code === cand.code)) continue;

      // If adding would exceed hard creditMax too early, delay unless we still need this gap.
      if (totalCredits + cand.credits > creditMax && remaining <= 0) continue;

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

  // If we’re under target, optionally top up from any leftover eligible items across gaps
  if (totalCredits < creditTarget) {
    const pool = [];
    for (const g of gaps) {
      for (const c of g.eligible || []) {
        const code = norm(c.code);
        if (!code || takenSet.has(code) || picks.find(p => p.code === code)) continue;
        const credits = pickCredits(4, c.credits);
        const campus  = campusOf(code);
        if (allowedCampus && !allowedCampus.has(campus || "")) continue;
        pool.push({ code, title: c.title || null, credits, source: g.label || g.kind });
      }
    }
    // Prefer 4-credit courses to hit common targets neatly
    pool.sort((a, b) => Math.abs(b.credits - 4) - Math.abs(a.credits - 4));

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