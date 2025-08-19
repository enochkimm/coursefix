// src/ai/progress.js

/**
 * Progress engine (deterministic, no GPT).
 * Supports your scraped rules schema:
 *  - REQUIRE { course:{code,title?,credits?} }
 *  - GROUP_SELECT { constraints:{min_credits?}, options:[{code,title?,credits?}] }
 *  - TOTAL (ignored except for reporting)
 *
 * Also stays backward-compatible with the simple shape you tested earlier:
 *  program = { name, requirements: [{ name, courses:[codes...] }, ...] }
 */

const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toUpperCase();

function inferCreditsFromCode(code) {
  if (!code) return 0;
  if (/-UA\b/i.test(code)) return 4;   // CAS (typical)
  if (/-UT\b/i.test(code)) return 4;   // Tisch
  if (/-UE\b/i.test(code)) return 4;   // Steinhardt
  if (/-UY\b/i.test(code)) return 4;   // Tandon
  if (/-SHU\b/i.test(code)) return 4;  // Shanghai
  return 0;
}
const getCourseCredits = (c) =>
  c?.credits?.min ?? (typeof c?.credits === "number" ? c.credits : inferCreditsFromCode(c?.code));

/** ---------- Simple legacy shape → rules ---------- */
function legacyRequirementsToRules(program) {
  // program = { name, requirements:[{name, courses:[code...]}, ...] }
  const rules = [];
  for (const r of program.requirements || []) {
    // If only one course, treat as REQUIRE, else group with min_credits=4
    const codes = Array.isArray(r.courses) ? r.courses : [];
    if (codes.length <= 1) {
      const code = norm(codes[0] || "");
      if (code) {
        rules.push({
          type: "REQUIRE",
          label: r.name || null,
          course: { code, title: null, credits: inferCreditsFromCode(code) }
        });
      }
    } else {
      rules.push({
        type: "GROUP_SELECT",
        label: r.name || null,
        constraints: { min_credits: 4 }, // conservative
        options: codes.map(code => ({ code: norm(code), title: null, credits: inferCreditsFromCode(code) }))
      });
    }
  }
  return rules;
}

/** ---------- Core evaluation over "rules" ---------- */
export function computeProgressFromRules(rules, studentCourses) {
  const taken = new Set((studentCourses || []).map(c => norm(c.code)));
  const satisfied = [];
  const pending = [];
  const gaps = []; // higher-level view for the planner
  const usageMap = {}; // code -> array of rule labels it satisfied (per-program)

  let requiredCredits = 0;
  let completedCredits = 0;
  const totals = [];

  // helper to record a used code
  const use = (code, byLabel) => {
    if (!code) return;
    usageMap[code] = usageMap[code] || [];
    usageMap[code].push(byLabel || null);
  };

  for (const r of rules || []) {
    // TOTAL (for report)
    if (r.type === "TOTAL" && r.credits?.min) {
      totals.push(r.credits.min);
      continue;
    }

    // REQUIRE
    if (r.type === "REQUIRE" && r.course?.code) {
      const code = norm(r.course.code);
      const need = getCourseCredits(r.course) || 0;
      if (need) requiredCredits += need;

      if (taken.has(code)) {
        const earned = need || inferCreditsFromCode(code) || 0;
        completedCredits += earned;
        satisfied.push({
          type: "REQUIRE",
          label: r.label || null,
          course: { code, title: r.course.title || null, credits: need || null },
          earned
        });
        use(code, r.label || `REQUIRE:${code}`);
      } else {
        pending.push({
          type: "REQUIRE",
          label: r.label || null,
          course: { code, title: r.course.title || null },
          needCredits: need || 0
        });
        gaps.push({
          kind: "REQUIRE",
          label: r.label || null,
          needCredits: need || 0,
          eligible: [{ code, title: r.course.title || null, credits: need || null }]
        });
      }
      continue;
    }

    // GROUP_SELECT (credit accumulation)
    if (r.type === "GROUP_SELECT") {
      const options = Array.isArray(r.options) ? r.options : [];
      const minCreds = r.constraints?.min_credits ?? 0;

      // Build option map
      const optMap = new Map();
      for (const o of options) {
        const code = norm(o?.code);
        if (!code) continue;
        optMap.set(code, {
          code,
          title: o?.title || null,
          credits: getCourseCredits(o) || inferCreditsFromCode(code) || 0
        });
      }

      let earned = 0;
      const hits = [];
      for (const code of taken) {
        if (!optMap.has(code)) continue;
        const opt = optMap.get(code);
        if (opt.credits > 0 && earned < minCreds) {
          earned += opt.credits;
          hits.push({ code, title: opt.title, credits: opt.credits });
          use(code, r.label || "GROUP_SELECT");
        }
      }

      requiredCredits += minCreds;

      if (earned >= minCreds) {
        completedCredits += minCreds; // cap at requirement
        satisfied.push({
          type: "GROUP_SELECT",
          label: r.label || null,
          earned: minCreds,
          picks: hits
        });
      } else {
        completedCredits += earned;
        const need = Math.max(0, minCreds - earned);
        const eligible = [...optMap.values()];
        pending.push({
          type: "GROUP_SELECT",
          label: r.label || null,
          needCredits: need,
          hits
        });
        gaps.push({
          kind: "GROUP_SELECT",
          label: r.label || null,
          needCredits: need,
          eligible
        });
      }
      continue;
    }

    // Other group types → expose as a gap with min_credits if present
    if (r.type && r.type.startsWith("GROUP_")) {
      const need = r.constraints?.min_credits ?? 0;
      requiredCredits += need;
      pending.push({
        type: r.type,
        label: r.label || null,
        needCredits: need
      });
      gaps.push({
        kind: r.type,
        label: r.label || null,
        needCredits: need,
        eligible: [] // unknown set; later planner can infer via dept/prefix if needed
      });
      continue;
    }
  }

  return {
    satisfied,
    pending,
    gaps,            // what planner will use next
    usageMap,        // { CODE: [labels satisfied] }
    summary: { requiredCredits, completedCredits, totals }
  };
}

/** ---------- Entry that accepts either full program or just rules ---------- */
export function computeProgress(programOrRules, studentCourses) {
  // If an array is passed, assume it is the rules array
  if (Array.isArray(programOrRules)) {
    return computeProgressFromRules(programOrRules, studentCourses);
  }

  // If a scraped program object with "rules"
  if (programOrRules?.rules) {
    return computeProgressFromRules(programOrRules.rules, studentCourses);
  }

  // Legacy simple shape fallback
  if (programOrRules?.requirements) {
    const rules = legacyRequirementsToRules(programOrRules);
    return computeProgressFromRules(rules, studentCourses);
  }

  throw new Error("computeProgress: expected rules array or program object with rules/requirements");
}