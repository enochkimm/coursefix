// src/ai/overlap.js
// Overlap utilities: build cross-program usage and check simple policies.

/**
 * usage shape:
 * {
 *   "IMNY-UT 101": {
 *     totalCount: 2,
 *     byProgram: { "Interactive Media Arts (BFA)": 1, "Data Science (BA)": 1 }
 *   },
 *   ...
 * }
 */
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toUpperCase();

/**
 * Build an overlap usage map from satisfied progress entries across programs.
 * @param {Array<{ programName: string, satisfied: Array }>} progressByProgram
 * @returns {Object} usage
 */
export function buildOverlapUsage(progressByProgram = []) {
  const usage = {};
  for (const { programName, satisfied = [] } of progressByProgram) {
    for (const s of satisfied) {
      if (s?.type === "REQUIRE" && s.course?.code) {
        const code = norm(s.course.code);
        usage[code] = usage[code] || { totalCount: 0, byProgram: {} };
        usage[code].totalCount++;
        usage[code].byProgram[programName] = (usage[code].byProgram[programName] || 0) + 1;
      }
      if (s?.type === "GROUP_SELECT" && Array.isArray(s.picks)) {
        for (const p of s.picks) {
          const code = norm(p.code);
          usage[code] = usage[code] || { totalCount: 0, byProgram: {} };
          usage[code].totalCount++;
          usage[code].byProgram[programName] = (usage[code].byProgram[programName] || 0) + 1;
        }
      }
    }
  }
  return usage;
}

/**
 * Check overlap policy and return human-readable messages (warnings by default).
 * policy supports:
 *  - maxSharedCourses: number                // max # of courses used across >1 program
 *  - perProgram?: { [programName]: number }  // per-program cap of *shared* courses
 *  - disallowList?: string[]                 // codes that must not be shared
 */
export function checkOverlapPolicy({ usage = {}, policy = {}, programs = [] } = {}) {
  const messages = [];

  const sharedCodes = Object.entries(usage)
    .filter(([, v]) => Object.keys(v.byProgram || {}).length > 1)
    .map(([code, v]) => ({ code, programs: Object.keys(v.byProgram || {}) }));

  // 1) Global cap on number of shared courses
  if (policy.maxSharedCourses != null && sharedCodes.length > policy.maxSharedCourses) {
    messages.push(
      `Overlap: ${sharedCodes.length} shared courses across programs (limit ${policy.maxSharedCourses}).`
    );
  }

  // 2) Per-program cap on shared courses
  if (policy.perProgram && typeof policy.perProgram === "object") {
    const perProgShared = {};
    for (const { code, programs: progs } of sharedCodes) {
      for (const pn of progs) {
        perProgShared[pn] = (perProgShared[pn] || 0) + 1;
      }
    }
    for (const pn of Object.keys(policy.perProgram)) {
      const cap = policy.perProgram[pn];
      const count = perProgShared[pn] || 0;
      if (count > cap) {
        messages.push(`Overlap: ${pn} uses ${count} shared courses (limit ${cap}).`);
      }
    }
  }

  // 3) Disallow-list (cannot be shared)
  if (Array.isArray(policy.disallowList) && policy.disallowList.length) {
    const disSet = new Set(policy.disallowList.map(norm));
    for (const { code, programs: progs } of sharedCodes) {
      if (disSet.has(norm(code))) {
        messages.push(`Overlap: ${code} may not be shared between programs (${progs.join(" & ")}).`);
      }
    }
  }

  // Optional: tell which courses are shared
  if (sharedCodes.length) {
    messages.push(
      `Shared courses: ${sharedCodes.map(({ code, programs }) => `${code} [${programs.join(" & ")}]`).join(", ")}.`
    );
  }

  return { messages, sharedCodes };
}