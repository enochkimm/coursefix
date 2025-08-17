// src/data/requirements/credits_rules.js
// Deterministic credits/rules parser for curriculum text blocks (no GPT).

import fs from "fs";

/** ---------------- Utilities ---------------- **/

// Whitespace & artifact cleanup (tabs, non-breaking spaces, multiple spaces, trailing junk)
function cleanText(s) {
  return String(s ?? "")
    .replace(/\u00A0/g, " ")
    .replace(/\t+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/[^\S\r\n]+$/g, ""); // trim only trailing spaces (keep leading if needed)
}

// Return the last standalone integer (defaults to 1..30 as reasonable credit range)
function lastInteger(s, max = 30) {
  const str = String(s ?? "");
  const m = [...str.matchAll(/(\d+)(?!.*\d)/g)].pop();
  if (!m) return null;
  const v = parseInt(m[1], 10);
  if (Number.isNaN(v)) return null;
  if (v < 0 || v > max) return null;
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

// Join rows like: ["CINE-UT 10", "Intro to Cinema Studies", "4"] → "CINE-UT 10 Intro to Cinema Studies 4"
function reassembleRows(lines) {
  const out = [];
  const codeRx = /\b[A-Z]{2,}-[A-Z]{2,}\s?\d+[A-Z-]*\b/;

  for (let i = 0; i < lines.length; i++) {
    let l0 = cleanText(lines[i]);
    if (!l0) continue;

    // Already looks like a full row (has code and some digits somewhere)
    const looksFull = codeRx.test(l0) && /\d/.test(l0);
    if (looksFull) {
      out.push(l0);
      continue;
    }

    // Try to stitch with next 1–2 lines (common for table → innerText)
    const l1 = cleanText(lines[i + 1] || "");
    const l2 = cleanText(lines[i + 2] || "");

    // Pattern: code on l0, title on l1, credits on l1 or l2
    if (codeRx.test(l0) && l1 && !codeRx.test(l1)) {
      const creditChunk =
        (l1.match(/(\d+\s*(?:credits?|points?)\b|\d+\s*(?:-|–|to)\s*\d+|\d+\s*or\s*\d+)/i)?.[0]) ||
        (l2.match(/(\d+\s*(?:credits?|points?)\b|\d+\s*(?:-|–|to)\s*\d+|\d+\s*or\s*\d+)/i)?.[0]) ||
        (lastInteger(l1) != null ? String(lastInteger(l1)) : null) ||
        (lastInteger(l2) != null ? String(lastInteger(l2)) : null);

      if (creditChunk) {
        out.push(cleanText(`${l0} ${l1} ${creditChunk}`));
        // If we consumed l2 (credits there), skip 2; else skip 1
        const consumedL2 = l2 && creditChunk && l2.includes(creditChunk);
        i += consumedL2 ? 2 : 1;
        continue;
      }

      // No explicit credit; still merge to help parser
      out.push(cleanText(`${l0} ${l1}`));
      i += 1;
      continue;
    }

    // Fallback: just push cleaned line
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

  // Search in the "rest" (after code) so digits inside code don't confuse us
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
    const v = +word[1];
    credits = { min: v, max: v };
  } else {
    // Last resort: last integer in rest (handles tab-separated columns & footnotes)
    const v = lastInteger(rest);
    if (v != null) credits = { min: v, max: v };
  }

  // Title: remaining text after code
  let title = cleaned;
  if (code) title = title.slice(title.indexOf(code) + code.length).trim();
  title = title.replace(/^[\-\–:•\s]+/, ""); // strip leading separators

  return { code, title: title || null, credits };
}

/** ---------------- Group / directive parsing ---------------- **/

const directiveStartRx = /^(Select|Choose)\b/i;
export function isDirectiveStart(line) {
  return directiveStartRx.test(line);
}

export function parseDirective(line) {
  const cleaned = cleanText(line);

  const minCred = cleaned.match(/(?:at least\s*)?(\d+)\s*(?:credits?|points?)\b/i);
  const minCourses = cleaned.match(/(?:at least\s*)?(\d+)\s*(?:courses?)\b/i);

  const constraints = {};
  if (minCred) constraints.min_credits = +minCred[1];
  if (minCourses) constraints.min_courses = +minCourses[1];

  // If neither matched, but there is a bare trailing integer, treat it as min_credits.
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

export function postProcessSectionLines(lines, courseLookup) {
  // Clean & reassemble multi-line table rows first
  const prepped = reassembleRows(lines).map(cleanText);

  const rules = [];
  let openGroup = null;

  const finishGroup = () => {
    if (!openGroup) return;
    rules.push({
      type: openGroup.minCoursesOnly ? "GROUP_CHOOSE_N_COURSES" : "GROUP_SELECT",
      label: openGroup.label,
      constraints: openGroup.constraints,
      options: openGroup.options,
      raw_line: openGroup.raw_line,
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
      // accept bare numbers too
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
  return rules;
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