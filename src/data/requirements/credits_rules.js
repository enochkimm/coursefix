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

// Return the last standalone integer (defaults to 1..30 as reasonable credit range)
function lastInteger(s, max = 30) {
  const m = [...String(s ?? "").matchAll(/(\d+)(?!.*\d)/g)].pop();
  if (!m) return null;
  const v = parseInt(m[1], 10);
  if (Number.isNaN(v)) return null;
  if (v < 0 || v > max) return null;
  return v;
}

// Default per-option credits for GROUP_SELECT when still unknown
const DEFAULT_GROUP_OPTION_CREDITS = 4;

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

// Join rows like: ["CINE-UT 10", "Intro to Cinema Studies", "4"] → "CINE-UT 10 Intro to Cinema Studies 4"
function reassembleRows(lines) {
  const out = [];
  const codeRx = /\b[A-Z]{2,}-[A-Z]{2,}\s?\d+[A-Z-]*\b/;

  for (let i = 0; i < lines.length; i++) {
    let l0 = cleanText(lines[i]);
    if (!l0) continue;

    // Already looks like a full row (has code + any digit)
    const looksFull = codeRx.test(l0) && /\d/.test(l0);
    if (looksFull) { out.push(l0); continue; }

    // Try to stitch with next 1–2 lines (table → innerText)
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

      // No explicit credit; still merge to help parser
      out.push(cleanText(`${l0} ${l1}`));
      i += 1;
      continue;
    }

    // Fallback: push as-is
    out.push(l0);
  }
  return out;
}

// Return { code, title, credits } (credits may be null)
export function parseCourseLine(line) {
  const cleaned = cleanText(line);
  const codeRx = /\b[A-Z]{2,}-[A-Z]{2,}\s?\d+[A-Z-]*\b/;
  const codeMatch = cleaned.match(codeRx);
  const code = codeMatch ? codeMatch[0].replace(/\s+/g, " ") : null;

  // Search only in the "rest" (after code)
  const rest = code ? cleaned.slice(cleaned.indexOf(code) + code.length) : cleaned;

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
    const v = +word[1]; credits = { min: v, max: v };
  } else {
    const v = lastInteger(rest);
    if (v != null) credits = { min: v, max: v };
  }

  // Title from remainder
  let title = cleaned;
  if (code) title = title.slice(title.indexOf(code) + code.length).trim();
  title = title.replace(/^[\-\–:•\s]+/, ""); // strip leading separators

  return { code, title: title || null, credits };
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

  // Fallback: use bare trailing integer as min_credits if nothing else found
  if (!constraints.min_credits && !constraints.min_courses) {
    const v = lastInteger(cleaned);
    if (v != null) constraints.min_credits = v;
  }

  return { label: cleaned, constraints };
}

/** ---------------- Course catalog lookup (optional) ---------------- **/

// Try to read your allCourses.json and index by code → {title?, credits?}
export function loadCourseCatalog(catalogPath) {
  try {
    const raw = fs.readFileSync(catalogPath, "utf-8");
    const data = JSON.parse(raw);
    const index = new Map();

    const add = (c) => {
      if (!c) return;
      const code = c.code || c.courseCode || c.course_id || null;
      if (!code) return;
      // normalize credits from multiple shapes
      let credits = null;
      const min = c.minCredits ?? c.min_credit ?? c.min ?? c.creditsMin ?? null;
      const max = c.maxCredits ?? c.max_credit ?? c.max ?? c.creditsMax ?? null;
      const fixed = c.credits ?? c.points ?? c.units ?? null;

      if (fixed != null) credits = { min: +fixed, max: +fixed };
      else if (min != null && max != null) credits = { min: +min, max: +max };
      else if (min != null) credits = { min: +min, max: +min };

      index.set(String(code).replace(/\s+/g, " "), {
        title: c.title ?? c.name ?? null,
        credits,
      });
    };

    if (Array.isArray(data)) {
      data.forEach(add);
    } else if (data && typeof data === "object") {
      for (const v of Object.values(data)) {
        if (Array.isArray(v)) v.forEach(add);
      }
    }
    return index;
  } catch {
    return new Map();
  }
}

/** ---------------- Section → rules post-processor ---------------- **/

// Core inference for groups, incl. default 4 credits for GROUP_SELECT options
function inferOptionCreditsInGroup(group) {
  if (!group || !group.type) return group;
  const isGroup = group.type.startsWith("GROUP_");
  const isGroupSelect = group.type === "GROUP_SELECT";
  if (!isGroup) return group;

  const opts = Array.isArray(group.options) ? group.options : [];

  // Pull constraints from group
  const mc  = group.constraints?.min_courses;
  const mcr = group.constraints?.min_credits;

  // If label had something like "... 2 8" but constraints are missing, try to parse again
  if ((mc == null || mcr == null) && typeof group.label === "string") {
    const s = group.label;
    const pair = s.match(/(\d+)\s+(\d+)\s*$/);
    if (pair) {
      if (!group.constraints) group.constraints = {};
      if (mc  == null) group.constraints.min_courses  = parseInt(pair[1], 10);
      if (mcr == null) group.constraints.min_credits = parseInt(pair[2], 10);
    } else {
      // single trailing number → total credits
      const v = lastInteger(s);
      if (v != null) {
        if (!group.constraints) group.constraints = {};
        if (group.constraints.min_credits == null) group.constraints.min_credits = v;
      }
    }
  }

  const min_courses  = group.constraints?.min_courses;
  const min_credits  = group.constraints?.min_credits;

  // Per-option from constraints (e.g., 8 ÷ 2 = 4) when clean integer 1..6
  let perOption = null;
  if (min_courses && min_credits) {
    const each = min_credits / min_courses;
    if (Number.isInteger(each) && each > 0 && each <= 6) perOption = each;
  } else if (min_credits && !min_courses) {
    // Common case: "Select one of the following: 4"
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

  // Fill missing option credits
  for (const o of opts) {
    if (o && o.credits == null) {
      if (perOption) {
        o.credits = { min: perOption, max: perOption };
        o.credits_inferred = "group";
      } else if (modeVal) {
        o.credits = { min: modeVal, max: modeVal };
        o.credits_inferred = "mode";
      } else if (isGroupSelect) {
        // FINAL FALLBACK: default to 4 credits for GROUP_SELECT options
        o.credits = { min: DEFAULT_GROUP_OPTION_CREDITS, max: DEFAULT_GROUP_OPTION_CREDITS };
        o.credits_inferred = "default_group_option";
      }
    }
  }

  return group;
}

export function postProcessSectionLines(lines, courseLookup) {
  // Clean & reassemble multi-line table rows first
  const prepped = reassembleRows(lines).map(cleanText);

  const rules = [];
  let openGroup = null;

  const finishGroup = () => {
    if (!openGroup) return;
    // Finalize group and run inference for its options
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

  const courseLikeRx = /\b[A-Z]{2,}-[A-Z]{2,}\s?\d+[A-Z-]*\b/;

  for (const raw of prepped) {
    const line = raw;
    if (!line) continue;

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

    // Inside a group: accumulate likely course options
    if (openGroup) {
      if (courseLikeRx.test(line) || /^[•\-–]/.test(line) || /^[A-Z]/.test(line)) {
        const item = parseCourseLine(line);
        if (!item.credits && item.code && courseLookup) {
          const hit = courseLookup(item.code);
          if (hit?.credits) item.credits = hit.credits;
          if (!item.title && hit?.title) item.title = hit.title;
        }
        openGroup.options.push(item);
        continue;
      } else {
        finishGroup();
      }
    }

    // Outside a group: TOTAL / caps / free electives / single requires
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
        label: line,
        credits: c ?? null,
        allowed_tags: ["liberal_arts", "ima", "open"],
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

// Final hardening pass: force GROUP_SELECT option credits to default if still null
function finalizeRules(rules) {
  for (const r of rules) {
    if (r && r.type === "GROUP_SELECT" && Array.isArray(r.options)) {
      for (const o of r.options) {
        if (o && (o.credits == null)) {
          o.credits = { min: DEFAULT_GROUP_OPTION_CREDITS, max: DEFAULT_GROUP_OPTION_CREDITS };
          o.credits_inferred = o.credits_inferred || "default_group_option";
        }
      }
    }
  }
  return rules;
}

export function buildRulesFromSections(sections, courseLookupFn) {
  const rules = [];
  const headings = Object.keys(sections);

  for (const h of headings) {
    // If a section is just a number for total credits, handle separately
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

  // **Hard fallback pass** to guarantee GROUP_SELECT options have credits
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
    if ((r.type === "GROUP_SELECT" || r.type === "GROUP_CHOOSE_N_COURSES") && Array.isArray(r.options)) {
      for (const o of r.options) if (!o.credits) out.unknowns++;
    }
  }
  return out;
}