// src/server/courseRouter.js
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Point this at your actual course catalog JSON:
const COURSES_PATH = path.join(
  __dirname,
  '../data/courseScraper/allCourses.json' // adjust if your filename differs
);

// --- helpers ---
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toUpperCase();

function codeVariants(raw) {
  const c = norm(raw);
  const set = new Set();
  set.add(c);
  set.add(c.replace(/\s+/g, ' '));          // single spaces
  set.add(c.replace(/\s+/g, ''));           // no spaces
  set.add(c.replace(/-\s+/g, '-'));         // collapse "-   " → "-"
  set.add(c.replace(/([A-Z]{2,}-[A-Z]{2,})\s+(\d)/, '$1 $2')); // "IMNY-UT   400" -> "IMNY-UT 400"
  set.add(c.replace(/(\d)[A-Z]$/, '$1'));   // strip trailing section letter (400A -> 400)
  return Array.from(set);
}

function indexCourses(coursesObj) {
  const index = new Map();
  const list = [];

  const entries = Array.isArray(coursesObj)
    ? coursesObj.map((c) => [norm(c.code || ''), c])
    : Object.entries(coursesObj).map(([k, v]) => [norm(k), v]);

  for (const [key, course] of entries) {
    if (!key) continue;
    const title = course.title || course.course_title || null;
    list.push({ code: key, title, _course: course });

    const vars = codeVariants(key);
    for (const v of vars) {
      if (!index.has(v)) index.set(v, course);
      const tight = v.replace(/\s+/g, '');
      if (!index.has(tight)) index.set(tight, course);
    }
  }
  return { index, list };
}

let COURSE_INDEX = new Map();
let COURSE_LIST = [];
try {
  const catalog = JSON.parse(fs.readFileSync(COURSES_PATH, 'utf-8'));
  const { index, list } = indexCourses(catalog);
  COURSE_INDEX = index;
  COURSE_LIST = list;
  console.log(`📘 [/api/course] catalog loaded: ${COURSE_INDEX.size} keys, ${COURSE_LIST.length} courses`);
} catch (e) {
  console.warn('⚠️ Could not load course catalog for courseRouter:', e.message);
  COURSE_INDEX = new Map();
  COURSE_LIST = [];
}

// --- GET /api/course?code=IMNY-UT 400 ---
router.get('/course', (req, res) => {
  const raw = req.query.code || '';
  if (!raw) return res.status(400).json({ ok: false, error: 'Missing ?code=' });
  const variantsTried = codeVariants(raw);
  let course = null;
  for (const v of variantsTried) {
    const key1 = norm(v);
    const key2 = key1.replace(/\s+/g, '');
    const hit = COURSE_INDEX.get(key1) || COURSE_INDEX.get(key2);
    if (hit) { course = hit; break; }
  }
  if (!course) {
    return res.status(404).json({
      ok: false,
      error: `Course not found for code "${raw}"`,
      tried: variantsTried
    });
  }

  // normalize payload fields
  const requirements = course.requirements || {};
  const payload = {
    code: course.code || raw,
    title: course.title || course.course_title || null,
    credits: course.credits ?? course.credit_hours ?? null,
    description: course.description || null,
    requirements: {
      prerequisites: requirements.prerequisites ?? null,
      corequisites: requirements.corequisites ?? null,
      restrictions: requirements.restrictions ?? null
    },
    campus: course.campus || null,
    department: course.department || course.subject || null,
    url: course.url || null
  };

  return res.json({ ok: true, course: payload });
});

// --- GET /api/courses/suggest?q=IMNY ---
router.get('/courses/suggest', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (!q) return res.json({ ok: true, results: [] });

  const MAX = 20;
  const results = [];
  for (const row of COURSE_LIST) {
    if (
      row.code.toLowerCase().includes(q) ||
      (row.title || '').toLowerCase().includes(q)
    ) {
      results.push({ code: row.code, title: row.title });
      if (results.length >= MAX) break;
    }
  }
  res.json({ ok: true, results });
});

export default router;