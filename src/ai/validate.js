// src/ai/validate.js
// Strong validator: per-semester credit bounds with overloads,
// duplicates, already-taken reuse, campus/prefix filters, bucket caps,
// overlap messages, PLUS deterministic prereq/coreq/restriction checks
// with tolerant course lookups.

import { meetsPrereqs, coreqNeeds, checkRestrictions } from './requirements.js';

const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toUpperCase();

function campusOf(code) {
  const c = norm(code);
  if (/-SHU\b/.test(c)) return "shanghai";
  if (/-AD\b/.test(c)) return "abudhabi";
  if (/-UA\b/.test(c) || /-UT\b/.test(c) || /-UE\b/.test(c) || /-UY\b/.test(c)) return "nyc";
  return null;
}

/** Generate plausible variants for a course code to tolerate formatting differences. */
function codeVariants(raw) {
  const c = norm(raw);
  const variants = new Set();

  // Raw, collapsed spaces, tight (no spaces)
  variants.add(c);
  variants.add(c.replace(/\s+/g, ' '));  // normalize internal spacing to single spaces
  variants.add(c.replace(/\s+/g, ''));   // remove all spaces

  // Collapse "-  " to "-"
  variants.add(c.replace(/-\s+/g, '-'));

  // Normalize single space between prefix and number: "IMNY-UT   400" -> "IMNY-UT 400"
  variants.add(c.replace(/([A-Z]{2,}-[A-Z]{2,})\s+(\d)/, '$1 $2'));

  // Drop trailing section letter (e.g., 400A -> 400)
  variants.add(c.replace(/(\d)[A-Z]$/, '$1'));

  return Array.from(variants);
}

/** Look up a course object in index using tolerant matching. */
function lookupCourse(index, rawCode) {
  if (!index) return null;
  for (const v of codeVariants(rawCode)) {
    if (index.has(v)) return index.get(v);

    // Try a few more common normalizations:
    const tight = v.replace(/\s+/g, '');
    if (index.has(tight)) return index.get(tight);

    const spaced = v.replace(/([A-Z]{2,}-[A-Z]{2,})(\d)/, '$1 $2'); // "IMNY-UT400" -> "IMNY-UT 400"
    if (index.has(spaced)) return index.get(spaced);
  }
  return null;
}

/**
 * @typedef {Object} ValidateArgs
 * @property {Array<{code:string,credits?:number,fulfills?:string,title?:string,semester?:string}>} picks
 * @property {Object} constraints
 *   - credit_load?: { min?:number, max?:number, target?:number, overload_max?:number, enforce_strict_min?:boolean }
 *   - campus?: string[]
 *   - allow_prefixes?: string[]
 *   - block_prefixes?: string[]
 *   - term?: string
 *   - student?: { majors?: string[], minors?: string[] }
 * @property {Array<{code:string,semester?:string}>} alreadyTaken
 * @property {Object} progress
 * @property {Object} overlap             // { messages?: string[] }
 * @property {Array<{label?:string, maxCourses?:number, maxCredits?:number}>} bucketCaps
 * @property {Map<string, any>} courseIndex // CODE -> course object (with requirements {prerequisites, corequisites, restrictions})
 */

/**
 * Validate a draft plan.
 * Returns {
 *   ok, errors[], warnings[],
 *   totals:{credits,courses},
 *   byBucket:{label:{credits,courses}},
 *   termLoad:{ [term]: { credits:number, courses:number } }
 * }
 */
export function validatePlan({
  picks = [],
  constraints = {},
  alreadyTaken = [],
  progress = null,
  overlap = null,
  bucketCaps = [],
  courseIndex = new Map()
} = {}) {
  const errors = [];
  const warnings = [];

  // ---------- Normalize ----------
  const normalizedPicks = (picks || []).map((p) => ({
    ...p,
    code: norm(p.code),
    fulfills: p.fulfills ? String(p.fulfills) : null,
    credits: Number(p.credits ?? 0),
    campus: campusOf(p.code),
    semester: p.semester || null
  }));

  // ---------- Totals (overall) ----------
  const totalCredits = normalizedPicks.reduce((s, p) => s + (Number.isFinite(p.credits) ? p.credits : 0), 0);
  const totalCourses = normalizedPicks.length;

  // ---------- 1) Duplicate course in plan ----------
  const seen = new Set();
  for (const p of normalizedPicks) {
    if (seen.has(p.code)) errors.push(`Duplicate course in plan: ${p.code}`);
    seen.add(p.code);
  }

  // ---------- 2) Already taken ----------
  const takenSet = new Set((alreadyTaken || []).map((c) => norm(c.code)));
  for (const p of normalizedPicks) {
    if (takenSet.has(p.code)) errors.push(`Course already completed appears in plan: ${p.code}`);
  }

  // ---------- 3) Reusing courses that already satisfied requirements ----------
  if (progress && Array.isArray(progress.satisfied)) {
    const satisfiedCodes = new Set(
      progress.satisfied.flatMap((s) =>
        s?.type === "REQUIRE"
          ? [norm(s.course?.code)]
          : Array.isArray(s.picks)
          ? s.picks.map((x) => norm(x.code))
          : []
      )
    );
    for (const p of normalizedPicks) {
      if (satisfiedCodes.has(p.code)) {
        warnings.push(
          `Course ${p.code} already satisfied a requirement earlier; ensure it isn't double-counted.`
        );
      }
    }
  }

  // ---------- 4) Campus & prefix constraints ----------
  const allowedCampus = Array.isArray(constraints.campus) && constraints.campus.length
    ? new Set(constraints.campus.map((x) => String(x).toLowerCase()))
    : null;

  const allowPrefixes = Array.isArray(constraints.allow_prefixes)
    ? constraints.allow_prefixes.map(norm)
    : null;

  const blockPrefixes = Array.isArray(constraints.block_prefixes)
    ? constraints.block_prefixes.map(norm)
    : null;

  for (const p of normalizedPicks) {
    // campus filter
    if (allowedCampus && !allowedCampus.has((p.campus || "").toLowerCase())) {
      errors.push(`Course ${p.code} not permitted by campus constraint (campus=${p.campus || "unknown"}).`);
    }
    // block prefixes
    if (blockPrefixes && blockPrefixes.some((pref) => p.code.startsWith(pref))) {
      errors.push(`Course ${p.code} blocked by prefix policy.`);
    }
    // allow-list prefixes (if provided)
    if (allowPrefixes && !allowPrefixes.some((pref) => p.code.startsWith(pref))) {
      errors.push(`Course ${p.code} not allowed by prefix policy.`);
    }
    // sanity: non-positive credits
    if (!Number.isFinite(p.credits) || p.credits <= 0) {
      warnings.push(`Course ${p.code} has zero/unknown credits in plan.`);
    }
  }

  // ---------- 5) Prereqs/Coreqs/Restrictions per pick (tolerant lookup) ----------
  const withPicks = normalizedPicks.map(p => ({ code: p.code }));
  const studentCtx = constraints.student || {};

  for (const p of normalizedPicks) {
    const course = lookupCourse(courseIndex, p.code);
    if (!course) {
      warnings.push(`${p.code}: not found in course catalog; prereq/coreq/restriction checks skipped.`);
      continue;
    }

    // 5a) prereqs
    const pre = meetsPrereqs(course, alreadyTaken, withPicks);
    if (!pre.ok) errors.push(`${p.code}: missing prereqs → ${pre.missing.join('; ')}`);

    // 5b) coreqs
    const core = coreqNeeds(course, alreadyTaken, withPicks);
    if (core.length) {
      errors.push(
        `${p.code}: needs coreq(s) → ` +
        core.map(c =>
          c.anyOf ? `one of (${c.anyOf.join(', ')})` :
          c.allOf ? c.allOf.join(', ') :
          c.choose ? `${c.choose} of (${c.of.join(', ')})` : 'coreq'
        ).join(' + ')
      );
    }

    // 5c) restrictions
    const rest = checkRestrictions(course, studentCtx);
    if (rest.blocks.length) errors.push(`${p.code}: restricted → ${rest.blocks.join(', ')}`);
    if (rest.warnings.length) warnings.push(`${p.code}: ${rest.warnings.join('; ')}`);
    if (rest.needs_human_review) warnings.push(`${p.code}: restrictions need human/GPT review`);
  }

  // ---------- 6) Bucket-level aggregation & caps ----------
  const byBucket = {};
  for (const p of normalizedPicks) {
    const label = p.fulfills || "Unlabeled";
    byBucket[label] = byBucket[label] || { credits: 0, courses: 0 };
    byBucket[label].credits += p.credits || 0;
    byBucket[label].courses += 1;
  }

  for (const cap of bucketCaps || []) {
    const label = String(cap.label || "Unlabeled");
    const caps = byBucket[label] || { credits: 0, courses: 0 };
    if (cap.maxCredits != null && caps.credits > cap.maxCredits) {
      errors.push(`Bucket "${label}" exceeds credit cap: ${caps.credits} > ${cap.maxCredits}.`);
    }
    if (cap.maxCourses != null && caps.courses > cap.maxCourses) {
      errors.push(`Bucket "${label}" exceeds course cap: ${caps.courses} > ${cap.maxCourses}.`);
    }
  }

  // ---------- 7) Per-semester load with overload policy ----------
  const plannedTerm = constraints.term || constraints.semester || "PLANNED";
  const termLoad = {}; // { term: { credits, courses } }

  for (const p of normalizedPicks) {
    const t = p.semester || plannedTerm;
    termLoad[t] = termLoad[t] || { credits: 0, courses: 0 };
    termLoad[t].credits += p.credits || 0;
    termLoad[t].courses += 1;
  }

  const minPerTerm = constraints?.credit_load?.min ?? 12;
  const maxPerTerm = constraints?.credit_load?.max ?? 18;
  const overloadMax = constraints?.credit_load?.overload_max ?? 21;
  const strictMin = !!constraints?.credit_load?.enforce_strict_min;

  for (const [term, load] of Object.entries(termLoad)) {
    const c = load.credits;

    if (c < minPerTerm) {
      const msg = `Term "${term}" planned for ${c} credits (< ${minPerTerm}). This is below full-time; verify part-time status or add courses.`;
      strictMin ? errors.push(msg) : warnings.push(msg);
    }
    if (c > maxPerTerm && c <= overloadMax) {
      warnings.push(`Term "${term}" planned for ${c} credits (> ${maxPerTerm}). Overload up to ${overloadMax} usually requires approval.`);
    }
    if (c > overloadMax) {
      errors.push(`Term "${term}" planned for ${c} credits exceeds overload limit ${overloadMax}.`);
    }
  }

  // ---------- 8) Overlap policy messages (as warnings by default) ----------
  if (overlap?.messages && Array.isArray(overlap.messages)) {
    for (const msg of overlap.messages) warnings.push(msg);
  }

  // ---------- Optional debug to list any missing picks in catalog ----------
  if (process.env.DEBUG_MISSING_COURSES === '1') {
    const missing = [];
    for (const p of normalizedPicks) {
      if (!lookupCourse(courseIndex, p.code)) missing.push(p.code);
    }
    if (missing.length) {
      console.warn('🔎 Missing in catalog (debug):', Array.from(new Set(missing)).join(', '));
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    totals: { credits: totalCredits, courses: totalCourses },
    byBucket,
    termLoad
  };
}