import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { extractTextFromPDF } from "../utils/pdfToText.js";
import { parseTranscriptText } from "../transcriptReader/index.js";

import { computeProgress } from "../ai/progress.js";
import { buildPlan } from "../ai/planner.js";
import { validatePlan } from "../ai/validate.js";

const router = express.Router();
const upload = multer();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Paths ──────────────────────────────
const REQUIREMENTS_PATH = path.join(
  __dirname,
  "../data/requirements/requirements_all_schools.json"
);
const COURSES_PATH = path.join(
  __dirname,
  "../data/courseScraper/allCourses.json"
);

// ── Load requirements ──────────────────
let CATALOG = [];
try {
  CATALOG = JSON.parse(fs.readFileSync(REQUIREMENTS_PATH, "utf-8"));
  console.log("📘 Loaded requirements JSON (programs):", CATALOG.length);
} catch (e) {
  console.warn("⚠️ Could not load requirements JSON:", e.message);
  CATALOG = [];
}

// ── Build tolerant course index ────────
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toUpperCase();

function codeVariants(raw) {
  const c = norm(raw);
  const set = new Set();
  set.add(c);
  set.add(c.replace(/\s+/g, " "));
  set.add(c.replace(/\s+/g, ""));
  set.add(c.replace(/-\s+/g, "-"));
  return Array.from(set);
}

function indexCourses(coursesArr) {
  const index = new Map();
  for (const c of coursesArr) {
    const key = norm(c.code || "");
    for (const v of codeVariants(key)) {
      if (!index.has(v)) index.set(v, c);
      const tight = v.replace(/\s+/g, "");
      if (!index.has(tight)) index.set(tight, c);
    }
  }
  return index;
}

let COURSE_INDEX = new Map();
try {
  const catalog = JSON.parse(fs.readFileSync(COURSES_PATH, "utf-8"));
  COURSE_INDEX = indexCourses(catalog);
  console.log(`📗 Loaded course catalog: ${COURSE_INDEX.size} keys`);
} catch (e) {
  console.warn("⚠️ Course catalog not found:", e.message);
  COURSE_INDEX = new Map();
}

// ── Find program in v8 flat structure ───
function findProgram(programName) {
  if (!programName) return null;
  const q = String(programName).toLowerCase();

  // exact match
  let match = CATALOG.find(
    (p) => (p.program_name || "").toLowerCase() === q
  );
  if (match) return match;

  // fuzzy match
  return CATALOG.find((p) =>
    (p.program_name || "").toLowerCase().includes(q)
  );
}

// ── Route: POST /api/upload ────────────
router.post("/upload", upload.single("transcript"), async (req, res) => {
  try {
    let parsed = [];

    if (req.file?.buffer) {
      const text = await extractTextFromPDF(req.file.buffer);
      parsed = parseTranscriptText(text) || [];
    }

    if (!req.file?.buffer && Array.isArray(req.body?.courses)) {
      parsed = req.body.courses.map((c) => ({
        semester: c.semester || null,
        code: norm(c.code),
      }));
    }

    if (!parsed.length) {
      return res.status(400).json({
        ok: false,
        error: "No courses parsed. Upload a PDF or send {courses:[...]}",
      });
    }

    console.log("📚 Parsed transcript courses:", parsed);

    const studentCourses = parsed.map((x) => ({
      code: norm(x.code),
      semester: x.semester || null,
    }));

    const program = req.body?.program;
    let constraints = {};
    try {
      constraints = req.body?.constraints
        ? JSON.parse(req.body.constraints)
        : {};
    } catch {
      constraints = {};
    }

    const match = findProgram(program);
    if (!match || !Array.isArray(match.rules)) {
      return res
        .status(404)
        .json({ ok: false, error: `Program not found: ${program}` });
    }

    const progress = computeProgress(match.rules, studentCourses);

    const plan = buildPlan({
      gaps: progress.gaps,
      alreadyTaken: studentCourses,
      constraints,
    });

    const validation = validatePlan({
      picks: plan.picks,
      constraints,
      alreadyTaken: studentCourses,
      progress,
      courseIndex: COURSE_INDEX,
      overlap: { messages: [] },
      bucketCaps: [],
    });

    console.log("🧠 Plan summary:", {
      program: match.program_name,
      required: progress.summary?.requiredCredits,
      completed: progress.summary?.completedCredits,
      picks: plan.picks?.length || 0,
      totalCredits: plan.totalCredits,
    });

    return res.json({
      ok: true,
      parsed: studentCourses,
      matchedCount: studentCourses.length,
      total: studentCourses.length,
      unmatched: [],
      plan: {
        match: {
          school: match.school,
          program: match.program_name,
          degree: match.degree,
          url: match.url || null,
        },
        progress,
        plan,
        validation,
      },
    });
  } catch (err) {
    console.error("❌ Upload handler error:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Failed to process transcript." });
  }
});

export default router;