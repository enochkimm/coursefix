// src/data/requirements/requirementsLinkScraper.js
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

const START_URL = "https://bulletins.nyu.edu/undergraduate/";
const OUTPUT_PATH = path.join("./src/data/requirements", "program_links.json");

// Map slugs to readable names
const SCHOOL_NAME_MAP = {
  "arts-science": "CAS",
  "business": "Stern",
  "engineering": "Tandon",
  "arts": "Tisch",
  "social-work": "Silver",
  "public-service": "Wagner",
  "liberal-studies": "Liberal Studies",
  "professional-studies": "SPS",
  "culture-education-human-development": "Steinhardt",
  "global-public-health": "Global Public Health",
  "individualized-study": "Gallatin",
  "nursing": "Rory Meyers College of Nursing",
  "abu-dhabi": "NYU Abu Dhabi",
  "shanghai": "NYU Shanghai",
  "dentistry": "Dentistry"
};

async function scrapeRequirementsLinks() {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();

  console.log("🔍 Navigating to NYU Bulletin...");
  await page.goto(START_URL, { waitUntil: "domcontentloaded" });

  // Step 1: Get all school pages
  const schoolLinks = await page.$$eval('a[href^="/undergraduate/"]', (links) =>
    [...new Set(
      links
        .map((a) => a.href)
        .filter((href) => href.endsWith("/") && !href.includes("/programs/"))
    )]
  );

  console.log(`🏫 Found ${schoolLinks.length} schools`);

  const groupedPrograms = {};

  // Step 2: Loop through each school and get program links
  for (const schoolUrl of schoolLinks) {
    const schoolKey = schoolUrl.split("/")[4]; // e.g., "arts-science"
    const schoolName = SCHOOL_NAME_MAP[schoolKey] || schoolKey; // Map to readable name
    groupedPrograms[schoolName] = [];

    console.log(`\n📖 School: ${schoolName}`);
    await page.goto(schoolUrl + "programs/", { waitUntil: "domcontentloaded" }).catch(() => null);

    const programLinks = await page.$$eval('a[href*="/programs/"]', (links) =>
      [...new Set(
        links
          .map((a) => a.href)
          .filter((href) => !href.endsWith("/programs/"))
      )]
    );

    console.log(`   ↳ Found ${programLinks.length} programs`);

    // Append #curriculumtext and group by school
    for (const program of programLinks) {
      const curriculumUrl = program + "#curriculumtext";
      groupedPrograms[schoolName].push(curriculumUrl);
      console.log(`      ✓ ${curriculumUrl}`);
    }
  }

  // Step 3: Save results
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(groupedPrograms, null, 2));

  console.log(`\n✅ Saved grouped curriculum links to ${OUTPUT_PATH}`);

  await browser.close();
}

scrapeRequirementsLinks();
