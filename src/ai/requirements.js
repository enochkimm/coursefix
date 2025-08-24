// src/ai/requirements.js
// Deterministic requirement checks (no GPT).
// Supports: "CODE"  |  ["A","B"] (any-of)  |  {choose: k, of:[...]}

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();

function toCodeSet(courses) {
  const set = new Set();
  for (const c of courses || []) {
    if (c?.code) set.add(norm(c.code));
    else if (typeof c === 'string') set.add(norm(c));
  }
  return set;
}

// ----- logic evaluation -----
function evalNode(node, haveSet) {
  // returns { ok:boolean, missing:string[] }
  if (!node) return { ok: true, missing: [] };

  if (typeof node === 'string') {
    const code = norm(node);
    return haveSet.has(code) ? { ok: true, missing: [] } : { ok: false, missing: [code] };
  }

  if (Array.isArray(node)) {
    const alts = node.map(norm);
    const hasOne = alts.some(c => haveSet.has(c));
    return hasOne ? { ok: true, missing: [] } : { ok: false, missing: [alts.join(' OR ')] };
  }

  if (node && typeof node === 'object' && Number.isFinite(node.choose) && Array.isArray(node.of)) {
    const pool = node.of.map(norm);
    const have = pool.filter(c => haveSet.has(c)).length;
    if (have >= node.choose) return { ok: true, missing: [] };
    const needed = Math.max(0, node.choose - have);
    return { ok: false, missing: [`${needed} of (${pool.join(', ')})`] };
  }

  return { ok: true, missing: [] }; // unknown → treat as ok; validator can warn later
}

function evalAll(nodes, haveSet) {
  const missing = [];
  for (const n of nodes || []) {
    const res = evalNode(n, haveSet);
    if (!res.ok) missing.push(...res.missing);
  }
  return { ok: missing.length === 0, missing };
}

// ----- public API -----
export function meetsPrereqs(course, have = [], withPicks = []) {
  const haveSet = toCodeSet([...have, ...withPicks]);
  const nodes = course?.requirements?.prerequisites || [];
  const res = evalAll(nodes, haveSet);
  return { ok: res.ok, missing: res.missing };
}

export function coreqNeeds(course, have = [], withPicks = []) {
  const haveSet = toCodeSet([...have, ...withPicks]);
  const nodes = course?.requirements?.corequisites || [];
  const unmet = [];

  for (const n of nodes || []) {
    const res = evalNode(n, haveSet);
    if (!res.ok) {
      if (Array.isArray(n)) unmet.push({ anyOf: n });
      else if (typeof n === 'string') unmet.push({ allOf: [n] });
      else if (n && typeof n === 'object' && Array.isArray(n.of) && Number.isFinite(n.choose)) {
        unmet.push({ choose: n.choose, of: n.of });
      }
    }
  }
  return unmet; // array of unmet coreq clauses
}

// Basic restriction cues
const RE_MAJORS_ONLY = /majors?\s+only/i;
const RE_MINORS_ONLY = /minors?\s+only/i;
const RE_NOT_OPEN = /not\s+open\s+to/i;
const RE_PERMISSION = /permission\s+of\s+(?:the\s+)?instructor|department\s+consent/i;

export function checkRestrictions(course, studentContext = {}) {
  const out = { blocks: [], warnings: [], needs_human_review: false };
  const restrictions = course?.requirements?.restrictions || [];
  const blob = restrictions.join(' ').trim();

  if (!blob) return out;

  if (RE_MAJORS_ONLY.test(blob)) {
    const ok = (studentContext.majors || []).some(m => blob.toLowerCase().includes(m.toLowerCase()));
    if (!ok) out.blocks.push('Major-restricted');
  }
  if (RE_MINORS_ONLY.test(blob)) {
    const ok = (studentContext.minors || []).some(m => blob.toLowerCase().includes(m.toLowerCase()));
    if (!ok) out.blocks.push('Minor-restricted');
  }
  if (RE_NOT_OPEN.test(blob)) out.warnings.push('“Not open to …” found — verify eligibility.');
  if (RE_PERMISSION.test(blob)) out.warnings.push('Permission/consent may be required.');

  if (restrictions.length && out.blocks.length === 0 && out.warnings.length === 0) {
    out.needs_human_review = true;
  }
  return out;
}

export function explainCourseEligibility(course, have = [], withPicks = [], ctx = {}) {
  const pre = meetsPrereqs(course, have, withPicks);
  const core = coreqNeeds(course, have, withPicks);
  const rest = checkRestrictions(course, ctx);

  const ok = pre.ok && core.length === 0 && rest.blocks.length === 0;
  const reasons = [];
  if (!pre.ok) reasons.push(`Missing prereqs: ${pre.missing.join('; ')}`);
  if (core.length) reasons.push(`Needs coreq(s): ${core.map(c =>
    c.anyOf ? `one of (${c.anyOf.join(', ')})` :
    c.allOf ? c.allOf.join(', ') :
    c.choose ? `${c.choose} of (${c.of.join(', ')})` : 'coreq'
  ).join(' + ')}`);
  if (rest.blocks.length) reasons.push(`Blocked: ${rest.blocks.join(', ')}`);
  if (rest.warnings.length) reasons.push(`Warn: ${rest.warnings.join('; ')}`);

  return { ok, reasons, prereq: pre, coreq: core, restrictions: rest };
}