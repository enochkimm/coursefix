// src/server/courseRouter.js
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to allCourses.json (v8)
const COURSES_PATH = path.join(__dirname, '../data/courseScraper/allCourses.json');

// --- helpers ---
const norm = (s) => String(s || '').trim().toUpperCase();

// --- requirement string → structured object parser ---
function parseRequirementString(str) {
  if (!str || typeof str !== 'string') return null;
  const s = str.trim();

  if (/ or /i.test(s)) {
    return { anyOf: s.split(/ or /i).map(x => x.trim()) };
  }
  if (/ and /i.test(s)) {
    return { allOf: s.split(/ and /i).map(x => x.trim()) };
  }
  const chooseMatch = s.match(/choose\s+(\d+)\s+of\s+(.+)/i);
  if (chooseMatch) {
    const n = parseInt(chooseMatch[1], 10);
    const options = chooseMatch[2].split(/[,;]|\bor\b/i).map(x => x.trim()).filter(Boolean);
    return { choose: n, of: options };
  }

  return s;
}

function normalizeRequirements(reqObj = {}) {
  const out = {};
  if (reqObj.prerequisites) out.prerequisites = Array.isArray(reqObj.prerequisites)
    ? reqObj.prerequisites.map(x => parseRequirementString(x) || x)
    : parseRequirementString(reqObj.prerequisites);
  if (reqObj.corequisites) out.corequisites = Array.isArray(reqObj.corequisites)
    ? reqObj.corequisites.map(x => parseRequirementString(x) || x)
    : parseRequirementString(reqObj.corequisites);
  if (reqObj.restrictions) out.restrictions = reqObj.restrictions;
  return out;
}

// --- index courses ---
function indexCourses(coursesArray) {
  const index = new Map();
  const list = [];

  for (const course of coursesArray) {
    const code = norm(course.code || '');
    if (!code) continue;
    const title = course.name || course.title || null;
    list.push({ code, title, _course: course });

    // exact + no-space variants
    index.set(code, course);
    index.set(code.replace(/\s+/g, ''), course);
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

  // DEBUG
  console.log('Index has DS-UA 301?', COURSE_INDEX.has('DS-UA 301'));
  console.log('Index has DS-UA301?', COURSE_INDEX.has('DS-UA301'));
} catch (e) {
  console.warn('⚠️ Could not load course catalog for courseRouter:', e.message);
  COURSE_INDEX = new Map();
  COURSE_LIST = [];
}

// --- GET /api/course?code=DS-UA 301 ---
router.get('/course', (req, res) => {
  const raw = req.query.code || '';
  if (!raw) return res.status(400).json({ ok: false, error: 'Missing ?code=' });

  const codeNorm = norm(raw);
  const codeTight = codeNorm.replace(/\s+/g, '');

  const hit = COURSE_INDEX.get(codeNorm) || COURSE_INDEX.get(codeTight);
  if (!hit) {
    return res.status(404).json({
      ok: false,
      error: `Course not found for code "${raw}"`,
      tried: [codeNorm, codeTight]
    });
  }

  const requirements = normalizeRequirements(hit.requirements || {});

  const payload = {
    code: hit.code || raw,
    title: hit.name || hit.title || null,
    credits: hit.credits ?? null,
    description: hit.desc || hit.description || null,
    requirements,
    campus: hit.campus || null,
    department: hit.department || null,
    url: hit.url || null
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