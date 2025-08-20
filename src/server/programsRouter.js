// src/server/programsRouter.js
import express from 'express';

// classify school → campus bucket
function schoolCampus(schoolName = '') {
  const s = String(schoolName).toLowerCase();
  if (/(abu\s*dhabi|nyu\s*abu\s*dhabi|nyuad)/i.test(s)) return 'abudhabi';
  if (/(shanghai|nyu\s*shanghai|nyush)/i.test(s)) return 'shanghai';
  return 'nyc'; // default to NY
}

function includeByCampus(school, campusFilters) {
  if (!campusFilters || campusFilters.length === 0) return true;
  const sc = schoolCampus(school);
  return campusFilters.includes(sc);
}

export default function programsRouterFactory(CATALOG) {
  const router = express.Router();

  /**
   * GET /api/programs
   * ?q=substring
   * ?campus=nyc[,abudhabi][,shanghai]
   */
  router.get('/programs', (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const campusQ = String(req.query.campus || '').trim().toLowerCase();
    const campusFilters = campusQ
      ? campusQ.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    const out = [];
    for (const school of Object.keys(CATALOG)) {
      if (!includeByCampus(school, campusFilters)) continue;
      const progs = CATALOG[school] || {};
      for (const name of Object.keys(progs)) {
        if (!q || name.toLowerCase().includes(q)) {
          out.push({
            id: `${school}::${name}`,
            school,
            program: name,
            url: progs[name]?.url || null
          });
        }
      }
    }

    out.sort((a, b) => (a.school.localeCompare(b.school) || a.program.localeCompare(b.program)));
    res.json({ ok: true, programs: out });
  });

  return router;
}