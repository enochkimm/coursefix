// src/data/requirements/requirementsLinkScraper.js
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

const START_URL = "https://bulletins.nyu.edu/undergraduate/";
const OUTPUT_PATH = path.join("./src/data/requirements", "program_links.json");

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
    groupedPrograms[schoolKey] = [];

    console.log(`\n📖 School: ${schoolKey}`);
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
      groupedPrograms[schoolKey].push(curriculumUrl);
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