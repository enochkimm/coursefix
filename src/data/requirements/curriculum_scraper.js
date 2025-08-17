// Scrapes ALL schools listed in program_links.json and emits credit-aware rules JSON (no GPT)
// Adds quick dev flags: --school="CAS" and/or --url="https://.../program" to iterate fast.

import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import {
  loadCourseCatalog,
  buildRulesFromSections,
  summarizeRules
} from "./credits_rules.js";

// -------- Paths --------
const LINKS_PATH = path.join("./src/data/requirements", "program_links.json");
const OUT_PATH   = path.join("./src/data/requirements", "requirements_all_schools.json");

// Optional: course catalog for credit backfill (safe if missing)
const COURSE_CATALOG_PATH = "./src/data/courseScraper/allCourses.json";

// --- tiny helpers ---
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const last  = (a) => a[a.length - 1];

function stripFragment(u) {
  try {
    const url = new URL(u);
    url.hash = "";
    return url.toString();
  } catch {
    return String(u).split("#")[0];
  }
}

/**
 * Parse a Program Requirements text block into structured sections.
 * (Includes a prose filter to avoid bogus REQUIREs.)
 */
function parseRequirementsBlock(text) {
  const lines = text
    .split("\n")
    .map(s => s.replace(/\u00A0/g, " ").trim())
    .filter(Boolean);

  const headingRx = /^(Program Requirements|Major Requirements|Core Requirements|Departmental Requirements|General Education Requirements|Liberal Arts|Electives|Free Electives|Other Requirements|Total Credits)$/i;
  const creditLineRx = /(\d+)\s*$/;
  const courseCodeRx = /\b[A-Z]{2,}-[A-Z]{2,}\s?\d+[A-Z-]*\b/;

  // Prose that should not become rules
  const proseRx = /^(Formerly\b|Students who\b|If a student\b|If you\b|Note:|Notes:|Advis(e|or|ing)\b|Pass\/Fail|Prereq|Coreq|May not|Should not|are expected to|It provides\b)/i;

  const sections = {};
  let current = "Unlabeled";

  for (const raw of lines) {
    const line = raw.replace(/\s{2,}/g, " ").trim();

    // SKIP prose
    if (proseRx.test(line)) continue;

    if (headingRx.test(line)) {
      current = line.replace(/^\d+\.\s*/, "");
      if (!sections[current]) sections[current] = [];
      continue;
    }

    const totalMatch = line.match(/^Total Credits\s+(\d+)/i);
    if (totalMatch) {
      sections["Total Credits"] = parseInt(totalMatch[1], 10);
      continue;
    }

    if (creditLineRx.test(line) || courseCodeRx.test(line) || /^Select\b/i.test(line) || /^Choose\b/i.test(line) || /^or\s+/i.test(line)) {
      if (!sections[current]) sections[current] = [];
      sections[current].push(line);
      continue;
    }
  }

  if (sections.Unlabeled && sections.Unlabeled.length === 0) delete sections.Unlabeled;
  return sections;
}

/**
 * Extracts the Program Requirements text from the page.
 */
async function extractProgramRequirements(page) {
  // 1) Click the "Curriculum" tab if present
  const tabSel = 'a[href*="#"]';
  const tabs = await page.$$eval(tabSel, as => as.map(a => ({ href: a.getAttribute("href") || "", text: (a.textContent || "").trim() }))).catch(() => []);
  const curriculumTab = tabs.find(t => /curriculum/i.test(t.text));
  if (curriculumTab && curriculumTab.href.startsWith("#")) {
    await page.evaluate((txt) => {
      const a = Array.from(document.querySelectorAll('a[href*="#"]')).find(x => (x.textContent || "").trim().match(new RegExp(txt, "i")));
      if (a) a.click();
    }, "Curriculum");
    await sleep(350);
  }

  // 2) Wait for likely containers
  const candidates = [
    "#curriculumtext",
    "#curriculum",
    "#tabs-4",
    'section[id*="curriculum"]',
    'div[role="tabpanel"]',
    "main"
  ];

  let containerHandle = null;
  for (const sel of candidates) {
    try {
      await page.waitForSelector(sel, { timeout: 2000 });
      const hasReq = await page.$eval(sel, el =>
        /Program Requirements|Course List|General Education Requirements/i.test(el.innerText || "")
      );
      if (hasReq) {
        containerHandle = sel;
        break;
      }
    } catch {}
  }

  // 3) Fallback: search for a heading and take its nearest section
  if (!containerHandle) {
    const ok = await page.evaluate(() => {
      const findHeading = (textRx) => {
        const rx = new RegExp(textRx, "i");
        const nodes = Array.from(document.querySelectorAll("h1,h2,h3,h4"));
        return nodes.find(n => rx.test(n.textContent || ""));
      };
      const h = findHeading("^Program Requirements$") || findHeading("Requirements") || findHeading("Curriculum");
      if (h) {
        const sec = h.closest("section") || h.parentElement;
        if (sec) { sec.setAttribute("data-cf-picked", "1"); return true; }
      }
      return false;
    });
    if (ok) containerHandle = '[data-cf-picked="1"]';
  }

  if (!containerHandle) return null;

  const text = await page.$eval(containerHandle, el => (el.innerText || "").trim());
  return text || null;
}

/** ---------------- CLI flags for fast iteration ---------------- **/

const argv = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith("--"))
    .map(a => a.replace(/^--/, "").split("="))
    .map(([k, v]) => [k, v ?? true])
);
// Usage examples:
//   node all_schools_scraper.js --school=CAS
//   node all_schools_scraper.js --url=https://bulletins.nyu.edu/undergraduate/arts-science/programs/art-history-ba/

async function run() {
  if (!fs.existsSync(LINKS_PATH)) {
    console.error(`❌ Missing ${LINKS_PATH}`);
    process.exit(1);
  }
  const linksJson = JSON.parse(fs.readFileSync(LINKS_PATH, "utf-8"));

  // Optional catalog (for credit backfill). Safe if missing.
  const catalogIndex = loadCourseCatalog(COURSE_CATALOG_PATH);
  console.log(`📚 Catalog entries loaded: ${catalogIndex.size}`);
  const lookup = (code) => catalogIndex.get(code) || null;

  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.setUserAgent("coursefix/1.0 (+nyu-scraper; puppeteer)");
  await page.setViewport({ width: 1280, height: 900 });

  // Block heavy assets to speed up dev runs
  await page.setRequestInterception(true);
  const BLOCK_TYPES = new Set(["image","font","media","stylesheet"]);
  page.on("request", req => BLOCK_TYPES.has(req.resourceType()) ? req.abort() : req.continue());

  const results = {}; // { School: { ProgramTitle: {...} } }

  const schoolNames = Object.keys(linksJson)
    .filter(k => k && Array.isArray(linksJson[k]))
    .filter(k => argv.school ? k.toLowerCase() === String(argv.school).toLowerCase() : true);

  console.log(`🏫 Schools to scrape: ${schoolNames.length}`);

  // Single URL dev mode
  const singleUrl = argv.url ? stripFragment(String(argv.url)) : null;

  for (const school of schoolNames) {
    const allLinksRaw = linksJson[school] || [];
    let links = allLinksRaw.filter(u => !/programs\.pdf/i.test(u)).map(stripFragment);

    if (singleUrl) {
      links = links.filter(u => u === singleUrl);
      if (links.length === 0) continue;
    }

    links = Array.from(new Set(links));
    if (links.length === 0) {
      console.log(`  • ${school}: (no curriculum links)`);
      continue;
    }

    results[school] = {};
    console.log(`  • ${school}: scraping ${links.length} programs…`);

    for (const url of links) {
      const slug = last(url.replace(/\/$/, "").split("/"));
      process.stdout.write(`    - ${slug} … `);

      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
        await sleep(300);

        const title = await page.$eval("h1", el => (el.textContent || "").trim()).catch(() => slug);

        const reqText = await extractProgramRequirements(page);
        if (!reqText) {
          console.log("⚠️ no requirements block");
          continue;
        }

        // 1) Sectionize lines (with prose filter)
        const parsedSections = parseRequirementsBlock(reqText);

        // 2) Convert to credit-aware rules (with inference + GROUP_SELECT→4 + prefix defaults)
        const rules = buildRulesFromSections(parsedSections, lookup);
        const summary = summarizeRules(rules);

        results[school][title] = {
          url,
          double_counting_default: "none",
          rules,
          raw_excerpt: reqText.slice(0, 600),
          _summary: summary
        };

        console.log(`ok (rules:${rules.length} unknowns:${summary.unknowns})`);
      } catch (e) {
        console.log(`❌ ${e.message}`);
      }
    }
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
  console.log(`\n✅ Saved → ${OUT_PATH}`);

  await browser.close();
}

run().catch(e => {
  console.error("💥 Fatal:", e);
  process.exit(1);
});