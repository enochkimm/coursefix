// src/data/requirements/credits_rules.js
// Deterministic, credit-aware parsing + inference (no GPT)

import fs from "fs";

/** ---------------- Utilities ---------------- **/

function cleanText(s) {
  return String(s ?? "")
    .replace(/\u00A0/g, " ")
    .replace(/\t+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Return the last standalone integer (safeguard to 1..30)
function lastInteger(s, max = 30) {
  const m = [...String(s ?? "").matchAll(/(\d+)(?!.*\d)/g)].pop();
  if (!m) return null;
  const v = parseInt(m[1], 10);
  if (Number.isNaN(v) || v < 0 || v > max) return null;
  return v;
}

/** ---------------- Credits + course parsing ---------------- **/

// Parse "4", "4 credits", "1-4", "2–4", "4 or 8", "0 to 12", "(4 credits)"
export function parseCreditExpr(s) {
  if (!s) return null;
  const cleaned = cleanText(String(s).replace(/[()]/g, "").toLowerCase());

  const range = cleaned.match(/(\d+)\s*(?:-|–|to)\s*(\d+)\s*(?:credits|points)?\b/);
  if (range) return { min: +range[1], max: +range[2] };

  const alt = cleaned.match(/(\d+)\s*or\s*(\d+)\s*(?:credits|points)?\b/);
  if (alt) return { min: Math.min(+alt[1], +alt[2]), max: Math.max(+alt[1], +alt[2]) };

  const single = cleaned.match(/(\d+)\s*(?:credits|points)?\b/);
  if (single) return { min: +single[1], max: +single[1] };

  return null;
}

// Reassemble table-ish rows: ["ARTH-UA 1", "Intro", "4"] → "ARTH-UA 1 Intro 4"
function reassembleRows(lines) {
  const out = [];
  const codeRx = /\b[A-Z]{2,}-[A-Z]{2,}\s?\d+[A-Z-]*\b/;

  for (let i = 0; i < lines.length; i++) {
    let l0 = cleanText(lines[i]);
    if (!l0) continue;

    if (codeRx.test(l0) && /\d/.test(l0)) { out.push(l0); continue; }

    const l1 = cleanText(lines[i + 1] || "");
    const l2 = cleanText(lines[i + 2] || "");

    if (codeRx.test(l0) && l1 && !codeRx.test(l1)) {
      const creditChunk =
        (l1.match(/(\d+\s*(?:credits?|points?)\b|\d+\s*(?:-|–|to)\s*\d+|\d+\s*or\s*\d+)/i)?.[0]) ||
        (l2.match(/(\d+\s*(?:credits?|points?)\b|\d+\s*(?:-|–|to)\s*\d+|\d+\s*or\s*\d+)/i)?.[0]) ||
        (lastInteger(l1) != null ? String(lastInteger(l1)) : null) ||
        (lastInteger(l2) != null ? String(lastInteger(l2)) : null);

      if (creditChunk) {
        out.push(cleanText(`${l0} ${l1} ${creditChunk}`));
        const consumedL2 = l2 && creditChunk && l2.includes(creditChunk);
        i += consumedL2 ? 2 : 1;
        continue;
      }

      out.push(cleanText(`${l0} ${l1}`));
      i += 1;
      continue;
    }

    out.push(l0);
  }
  return out;
}

// Return { code, title, credits }
export function parseCourseLine(line) {
  const cleaned = cleanText(line);
  const codeRx = /\b[A-Z]{2,}-[A-Z]{2,}\s?\d+[A-Z-]*\b/;
  const codeMatch = cleaned.match(codeRx);
  const code = codeMatch ? codeMatch[0].replace(/\s+/g, " ") : null;

  // "rest" after code
  let rest = code ? cleaned.slice(cleaned.indexOf(code) + code.length) : cleaned;

  // Ignore hour counts in credit parsing (e.g., "4–5 hours per week")
  rest = rest.replace(/\b\d+\s*(?:hours?|hrs?)\b(?:[^0-9]|$)/gi, " ");

  // Prefer ranges and alternatives anywhere in rest
  const range = [...rest.matchAll(/(\d+)\s*(?:-|–|to)\s*(\d+)/gi)].pop();
  const alt   = [...rest.matchAll(/(\d+)\s*or\s*(\d+)/gi)].pop();
  const word  = [...rest.matchAll(/(\d+)\s*(?:credits?|points?)\b/gi)].pop();

  let credits = null;
  if (range) {
    credits = { min: +range[1], max: +range[2] };
  } else if (alt) {
    const a = +alt[1], b = +alt[2];
    credits = { min: Math.min(a, b), max: Math.max(a, b) };
  } else if (word) {
    credits = { min: +word[1], max: +word[1] };
  } else {
    const v = lastInteger(rest);
    if (v != null) credits = { min: v, max: v };
  }

  // Title from remainder; strip leading separators, parentheticals, and trailing debris
  let title = cleaned;
  if (code) title = title.slice(title.indexOf(code) + code.length).trim();
  title = title.replace(/^[\-\–:•\s]+/, "");
  // drop parenthetical blocks like "(Formerly …)" and leftover parens
  title = title.replace(/\([^)]*\)/g, " ").replace(/\s{2,}/g, " ").trim();
  if (credits) {
    title = title.replace(/\s+\d+(?:\s+\d+)*\s*$/, "").trim();
  }
  if (!title || /^[()]+$/.test(title)) title = null;

  return { code, title, credits };
}

/** ---------------- Group / directive parsing ---------------- **/

const directiveStartRx = /^(Select|Choose)\b/i;
export function isDirectiveStart(line) {
  return directiveStartRx.test(cleanText(line));
}

export function parseDirective(line) {
  const cleaned = cleanText(line);
  const constraints = {};

  const minCred = cleaned.match(/(?:at least\s*)?(\d+)\s*(?:credits?|points?)\b/i);
  if (minCred) constraints.min_credits = +minCred[1];

  const minCourses = cleaned.match(/(?:select|choose)\s+(\d+)\s+(?:course|courses)\b/i);
  if (minCourses) constraints.min_courses = +minCourses[1];

  if (!constraints.min_credits && !constraints.min_courses) {
    const v = lastInteger(cleaned);
    if (v != null) constraints.min_credits = v;
  }

  return { label: cleaned, constraints };
}

/** ---------------- Course catalog lookup (optional) ---------------- **/

export function loadCourseCatalog(catalogPath) {
  try {
    const raw = fs.readFileSync(catalogPath, "utf-8");
    const data = JSON.parse(raw);
    const index = new Map();

    const add = (c) => {
      const code = c?.code || c?.courseCode || c?.course_id;
      if (!code) return;

      let credits = null;
      const min = c.minCredits ?? c.min_credit ?? c.min ?? c.creditsMin;
      const max = c.maxCredits ?? c.max_credit ?? c.max ?? c.creditsMax;
      const fixed = c.credits ?? c.points ?? c.units;

      if (fixed != null) credits = { min: +fixed, max: +fixed };
      else if (min != null && max != null) credits = { min: +min, max: +max };
      else if (min != null) credits = { min: +min, max: +min };

      index.set(String(code).replace(/\s+/g, " "), {
        title: c.title ?? c.name ?? null,
        credits,
      });
    };

    if (Array.isArray(data)) data.forEach(add);
    else if (data && typeof data === "object") {
      for (const v of Object.values(data)) if (Array.isArray(v)) v.forEach(add);
    }
    return index;
  } catch {
    return new Map();
  }
}

/** ---------------- Defaults & helpers ---------------- **/

// Conservative per-prefix defaults (common undergrad patterns)
const PREFIX_DEFAULTS = [
  { rx: /-[Uu][Aa]\b/, credits: 4 },  // CAS "UA"
  { rx: /-[Uu][Tt]\b/, credits: 4 },  // Tisch "UT"
  { rx: /-[Uu][Ee]\b/, credits: 4 },  // Steinhardt "UE"
  { rx: /-[Ss][Hh][Uu]\b/, credits: 4 }, // Shanghai "SHU"
  { rx: /-[Uu][Yy]\b/, credits: 4 },  // Tandon "UY" (often 4)
];

function applyPrefixDefault(courseObj) {
  if (!courseObj || courseObj.credits || !courseObj.code) return false;
  for (const { rx, credits } of PREFIX_DEFAULTS) {
    if (rx.test(courseObj.code)) {
      courseObj.credits = { min: credits, max: credits };
      courseObj.credits_inferred = courseObj.credits_inferred || "prefix_default";
      return true;
    }
  }
  return false;
}

// Default per-option credits for GROUP_SELECT when still unknown
const DEFAULT_GROUP_OPTION_CREDITS = 4;

/** ---------------- Section → rules post-processor ---------------- **/

// Fold a trailing "or CODE ..." into the previous REQUIRE as a group
function convertLastRequireToGroup(rules, altItem) {
  for (let i = rules.length - 1; i >= 0; i--) {
    const r = rules[i];
    if (r?.type === "REQUIRE" && r.course) {
      const base = r.course;
      const inferred = Math.max(base.credits?.min ?? 0, altItem.credits?.min ?? 0) || 4;
      const group = {
        type: "GROUP_SELECT",
        label: "Select one of the following:",
        constraints: { min_credits: inferred },
        options: [base, altItem],
        raw_line: `Auto-converted: alternate for ${base.code || base.title || "course"}`
      };
      rules.splice(i, 1, group);
      return true;
    }
  }
  return false;
}

// Core inference for groups, incl. default 4 credits for GROUP_SELECT options
function inferOptionCreditsInGroup(group) {
  if (!group || !group.type) return group;
  const isGroup = group.type.startsWith("GROUP_");
  const isGroupSelect = group.type === "GROUP_SELECT";
  if (!isGroup) return group;

  const opts = Array.isArray(group.options) ? group.options : [];

  // Pull constraints from group / label
  const mc  = group.constraints?.min_courses;
  const mcr = group.constraints?.min_credits;

  if ((mc == null || mcr == null) && typeof group.label === "string") {
    const s = group.label;
    const pair = s.match(/(\d+)\s+(\d+)\s*$/);
    if (pair) {
      if (!group.constraints) group.constraints = {};
      if (mc  == null) group.constraints.min_courses  = parseInt(pair[1], 10);
      if (mcr == null) group.constraints.min_credits = parseInt(pair[2], 10);
    } else {
      const v = lastInteger(s);
      if (v != null) {
        if (!group.constraints) group.constraints = {};
        if (group.constraints.min_credits == null) group.constraints.min_credits = v;
      }
    }
  }

  const min_courses  = group.constraints?.min_courses;
  const min_credits  = group.constraints?.min_credits;

  // Per-option from constraints (e.g., 8 ÷ 2 = 4)
  let perOption = null;
  if (min_courses && min_credits) {
    const each = min_credits / min_courses;
    if (Number.isInteger(each) && each > 0 && each <= 6) perOption = each;
  } else if (min_credits && !min_courses) {
    perOption = min_credits; // assume one course
  }

  // Mode of known option credits
  const known = opts
    .map(o => (o && o.credits && Number.isFinite(o.credits.min) ? o.credits.min : null))
    .filter(v => v != null);
  let modeVal = null;
  if (known.length) {
    const cnt = new Map();
    for (const v of known) cnt.set(v, (cnt.get(v) || 0) + 1);
    modeVal = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  // Fill missing option credits (group → mode → default → prefix)
  for (const o of opts) {
    if (o && o.credits == null) {
      if (perOption) {
        o.credits = { min: perOption, max: perOption };
        o.credits_inferred = "group";
      } else if (modeVal) {
        o.credits = { min: modeVal, max: modeVal };
        o.credits_inferred = "mode";
      } else if (isGroupSelect) {
        o.credits = { min: DEFAULT_GROUP_OPTION_CREDITS, max: DEFAULT_GROUP_OPTION_CREDITS };
        o.credits_inferred = "default_group_option";
      } else {
        applyPrefixDefault(o);
      }
    }
  }

  // Dedupe options by code; drop items with no code & no title
  const byCode = new Map();
  const dedup = [];
  for (const o of opts) {
    if (!o) continue;
    if (!o.code && !o.title) continue;
    if (o.code) {
      const key = o.code;
      if (byCode.has(key)) continue;
      byCode.set(key, 1);
    }
    dedup.push(o);
  }
  group.options = dedup;

  // Normalize directive label (strip trailing numbers like "1 4")
  if (typeof group.label === "string") {
    group.label = group.label.replace(/\s+\d+(?:\s+\d+)?\s*$/, "").trim();
  }

  return group;
}

export function postProcessSectionLines(lines, courseLookup) {
  // 1) Clean & reassemble multi-line table rows
  const prepped = reassembleRows(lines).map(cleanText);

  const rules = [];
  let openGroup = null;

  const courseLikeRx = /\b[A-Z]{2,}-[A-Z]{2,}\s?\d+[A-Z-]*\b/;

  const finishGroup = () => {
    if (!openGroup) return;
    const finalized = inferOptionCreditsInGroup(openGroup);
    rules.push({
      type: finalized.minCoursesOnly ? "GROUP_CHOOSE_N_COURSES" : "GROUP_SELECT",
      label: finalized.label,
      constraints: finalized.constraints,
      options: finalized.options,
      raw_line: finalized.raw_line,
    });
    openGroup = null;
  };

  for (const raw of prepped) {
    const line = raw;
    if (!line) continue;

    // 2) Handle "or CODE ..." as alternative
    const orLine = line.match(/^or\s+(.+)$/i);
    if (orLine) {
      const altParsed = parseCourseLine(orLine[1]);
      if (!altParsed.credits && altParsed.code && courseLookup) {
        const hit = courseLookup(altParsed.code);
        if (hit?.credits) altParsed.credits = hit.credits;
        if (!altParsed.title && hit?.title) altParsed.title = hit.title;
      }
      if (openGroup) {
        if (altParsed.code || altParsed.title) openGroup.options.push(altParsed);
      } else {
        convertLastRequireToGroup(rules, altParsed);
      }
      continue;
    }

    // 3) Start of directive group
    if (isDirectiveStart(line)) {
      finishGroup();
      const { label, constraints } = parseDirective(line);
      openGroup = {
        label,
        constraints,
        minCoursesOnly: !!constraints.min_courses && !constraints.min_credits,
        options: [],
        raw_line: line,
      };
      continue;
    }

    // 4) Inside a group: push course-like options
    if (openGroup) {
      if (courseLikeRx.test(line) || /^[•\-–]/.test(line) || /^[A-Z]/.test(line)) {
        const item = parseCourseLine(line);
        if (!item.credits && item.code && courseLookup) {
          const hit = courseLookup(item.code);
          if (hit?.credits) item.credits = hit.credits;
          if (!item.title && hit?.title) item.title = hit.title;
        }
        if (!item.credits) applyPrefixDefault(item);
        if (item.code || item.title) openGroup.options.push(item);
        continue;
      } else {
        finishGroup();
      }
    }

    // 5) Outside group: TOTAL / caps / free electives / single requires
    const total = line.match(/^Total\s+Credits?\s*[:\-]?\s*(.+)$/i);
    if (total) {
      const v = parseCreditExpr(total[1]) ?? (lastInteger(line) != null ? { min: lastInteger(line), max: lastInteger(line) } : null);
      if (v) {
        rules.push({ type: "TOTAL", label: "Total credits required to graduate", credits: v, raw_line: line });
        continue;
      }
    }

    const cap = line.match(/no\s+more\s+than\s+(\d+)\s+credits?\s+outside\s+liberal\s+arts/i);
    if (cap) {
      rules.push({
        type: "AREA_CAP",
        label: "Non-Liberal Arts credit cap",
        credits: { max: +cap[1] },
        area: "non_liberal_arts",
        raw_line: line,
      });
      continue;
    }

    if (/free\s+electives/i.test(line)) {
      const c = parseCreditExpr(line);
      rules.push({
        type: "FREE_ELECTIVES",
        label: line.replace(/\([^)]*\)/g, "").trim(),
        credits: c ?? null,
        allowed_tags: ["liberal_arts", "open"],
        raw_line: line,
      });
      continue;
    }

    if (courseLikeRx.test(line)) {
      const item = parseCourseLine(line);
      if (!item.credits && item.code && courseLookup) {
        const hit = courseLookup(item.code);
        if (hit?.credits) item.credits = hit.credits;
        if (!item.title && hit?.title) item.title = hit.title;
      }
      if (!item.credits) applyPrefixDefault(item);

      // Skip totally empty row
      if (!item.code && !item.title) continue;

      rules.push({
        type: "REQUIRE",
        label: item.title ? `Require: ${item.title}` : "Require: course",
        course: item,
        raw_line: line,
      });
      continue;
    }
  }

  finishGroup();
  return rules;
}

/** ---------------- Whole-program builder ---------------- **/

function finalizeRules(rules) {
  for (const r of rules) {
    if (!r) continue;

    if (r.type === "GROUP_SELECT" && Array.isArray(r.options)) {
      const dedupByCode = new Map();
      const newOpts = [];
      for (const o of r.options) {
        if (!o) continue;
        if (o.credits == null && !applyPrefixDefault(o)) {
          o.credits = { min: DEFAULT_GROUP_OPTION_CREDITS, max: DEFAULT_GROUP_OPTION_CREDITS };
          o.credits_inferred = o.credits_inferred || "default_group_option";
        }
        if (!o.code && !o.title) continue;
        if (o.code) {
          if (dedupByCode.has(o.code)) continue;
          dedupByCode.set(o.code, 1);
        }
        newOpts.push(o);
      }
      r.options = newOpts;
      if (typeof r.label === "string") r.label = r.label.replace(/\s+\d+(?:\s+\d+)?\s*$/, "").trim();
    }

    if (r.type && r.type.startsWith("GROUP_") && r.type !== "GROUP_SELECT" && Array.isArray(r.options)) {
      const dedupByCode = new Map();
      const newOpts = [];
      for (const o of r.options) {
        if (!o) continue;
        if (o.credits == null) applyPrefixDefault(o);
        if (!o.code && !o.title) continue;
        if (o.code) {
          if (dedupByCode.has(o.code)) continue;
          dedupByCode.set(o.code, 1);
        }
        newOpts.push(o);
      }
      r.options = newOpts;
      if (typeof r.label === "string") r.label = r.label.replace(/\s+\d+(?:\s+\d+)?\s*$/, "").trim();
    }

    if (r.type === "REQUIRE" && r.course && r.course.credits == null) {
      applyPrefixDefault(r.course);
    }
  }
  return rules;
}

export function buildRulesFromSections(sections, courseLookupFn) {
  const rules = [];
  const headings = Object.keys(sections);

  for (const h of headings) {
    if (h.toLowerCase().includes("total") && Number.isInteger(sections[h])) {
      rules.push({
        type: "TOTAL",
        label: "Total credits required to graduate",
        credits: { min: sections[h], max: sections[h] },
        raw_line: `Total Credits ${sections[h]}`,
      });
      continue;
    }

    const lines = Array.isArray(sections[h]) ? sections[h] : [];
    const rs = postProcessSectionLines(lines, courseLookupFn);
    rules.push(...rs);
  }

  return finalizeRules(rules);
}

/** ---------------- Lightweight validator (optional) ---------------- **/

export function summarizeRules(rules) {
  const out = { min_required: 0, max_required: 0, totals: [], unknowns: 0 };

  for (const r of rules) {
    if (r.type === "REQUIRE" && r.course?.credits) {
      out.min_required += r.course.credits.min ?? 0;
      out.max_required += r.course.credits.max ?? r.course.credits.min ?? 0;
    }
    if (r.type === "GROUP_SELECT" && r.constraints?.min_credits) {
      out.min_required += r.constraints.min_credits;
      out.max_required += r.constraints.min_credits; // conservative
    }
    if (r.type === "TOTAL" && r.credits) {
      out.totals.push(r.credits.min ?? r.credits.max ?? null);
    }

    // count unknown credit-bearing items
    if (r.type === "REQUIRE" && !r.course?.credits) out.unknowns++;
    if ((r.type?.startsWith("GROUP_")) && Array.isArray(r.options)) {
      for (const o of r.options) if (!o.credits) out.unknowns++;
    }
  }
  return out;
}