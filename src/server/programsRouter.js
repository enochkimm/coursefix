import express from "express";
import fs from "fs";
import path from "path";

const router = express.Router();

// Path to v8 JSON
const requirementsPath = path.join(
  process.cwd(),
  "src/data/requirements/requirements_all_schools.json"
);

function loadPrograms() {
  const raw = fs.readFileSync(requirementsPath, "utf-8");
  return JSON.parse(raw);
}

router.get("/", (req, res) => {
  try {
    let { campus } = req.query;
    const programs = loadPrograms();

    // Default to NYC if nothing given
    if (!campus) campus = "nyc";
    const campuses = campus.split(",").map((c) => c.trim().toLowerCase());

    const filtered = programs.filter((p) => {
      const name = (p.program_name || "").toLowerCase();
      const school = (p.school || "").toLowerCase();

      const isAbu = name.includes("abu dhabi") || school.includes("abu dhabi");
      const isShanghai = name.includes("shanghai") || school.includes("shanghai");

      if (campuses.includes("abudhabi") && isAbu) return true;
      if (campuses.includes("shanghai") && isShanghai) return true;
      if (campuses.includes("nyc")) {
        if (!isAbu && !isShanghai) return true;
      }
      return false;
    });

    // return only metadata for dropdown
    const metadataOnly = filtered
      .map((p) => ({
        school: p.school,
        program_name: p.program_name,
        degree: p.degree,
        url: p.url,
      }))
      .sort((a, b) => a.program_name.localeCompare(b.program_name));

    res.json(metadataOnly);
  } catch (err) {
    console.error("Error loading programs:", err);
    res.status(500).json({ error: "Failed to load program list" });
  }
});

router.get("/:name", (req, res) => {
  try {
    const { name } = req.params;
    const { school, degree } = req.query;

    const programs = loadPrograms();
    const program = programs.find((p) => {
      if (name && !p.program_name.toLowerCase().includes(name.toLowerCase()))
        return false;
      if (school && !p.school.toLowerCase().includes(school.toLowerCase()))
        return false;
      if (degree && !p.degree.toLowerCase().includes(degree.toLowerCase()))
        return false;
      return true;
    });

    if (!program) {
      return res.status(404).json({ error: "Program not found" });
    }

    res.json(program);
  } catch (err) {
    console.error("Error finding program:", err);
    res.status(500).json({ error: "Failed to find program" });
  }
});

export default router;