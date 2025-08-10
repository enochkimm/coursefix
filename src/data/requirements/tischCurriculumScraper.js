import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

const LINKS_PATH  = path.join("./src/data/requirements", "program_links.json");
const OUT_PATH    = path.join("./src/data/requirements", "tisch_requirements.json");

// --- tiny helpers ---
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const last   = (a) => a[a.length - 1];

/**
 * Parse a Program Requirements text block into structured sections.
 * Works for Tisch pages that show lines like:
 *   IMNY-UT 101 Creative Computing 4
 *   General Education Requirements
 *   Expository Writing (two courses...) 8
 */
function parseRequirementsBlock(text) {
  const lines = text
    .split("\n")
    .map(s => s.replace(/\u00A0/g, " ").trim())
    .filter(Boolean);

  // headings we care about
  const headingRx = /^(Program Requirements|Major Requirements|Core Requirements|Departmental Requirements|General Education Requirements|Liberal Arts|Electives|Free Electives|Other Requirements|Total Credits)$/i;

  // a line that ends with an integer credit
  const creditLineRx = /(\d+)\s*$/;

  // course-like: CODE TITLE CREDITS (code optional; we keep the whole line)
  // Accept things like "IMNY-UT 101", "CSCI-UA 102", etc.
  const courseCodeRx = /\b[A-Z]{2,}-[A-Z]{2,}\s?\d+[A-Z-]*\b/;

  const sections = {};
  let current = "Unlabeled";

  for (const raw of lines) {
    const line = raw.replace(/\s{2,}/g, " ").trim();

    // normalize headings
    if (headingRx.test(line)) {
      current = line.replace(/^\d+\.\s*/, ""); // drop any numbering
      if (!sections[current]) sections[current] = [];
      continue;
    }

    // Stop words that are not requirements
    if (/^(On This Page|Program Description|Admissions|Study Abroad|Internships|Policies|Outcomes|Learning Outcomes)$/i.test(line)) {
      continue;
    }

    // Total credits line
    const totalMatch = line.match(/^Total Credits\s+(\d+)/i);
    if (totalMatch) {
      sections["Total Credits"] = parseInt(totalMatch[1], 10);
      continue;
    }

    // Likely requirement row if it ends with a number (credits),
    // or looks like a course code + title, or a bullet/choice statement.
    if (creditLineRx.test(line) || courseCodeRx.test(line) || /^Select\b/i.test(line) || /^Choose\b/i.test(line)) {
      if (!sections[current]) sections[current] = [];
      sections[current].push(line);
      continue;
    }

    // If we are in a known requirement section and it's a short label line, keep it.
    if (sections[current] && /^(Group|Track|Option|Capstone|Thesis|Minor|Concentration)\b/i.test(line)) {
      sections[current].push(line);
      continue;
    }
  }

  // Small cleanup: if we only captured "Unlabeled" with nothing useful, drop it.
  if (sections.Unlabeled && sections.Unlabeled.length === 0) {
    delete sections.Unlabeled;
  }
  return sections;
}

/**
 * Extracts the Program Requirements text from the page.
 * Tries multiple strategies because Bulletin markup varies.
 */
async function extractProgramRequirements(page) {
  // 1) Click the "Curriculum" tab if present
  const tabSel = 'a[href*="#"]';
  const tabs = await page.$$eval(tabSel, as => as.map(a => ({ href: a.getAttribute("href") || "", text: (a.textContent || "").trim() })));
  const curriculumTab = tabs.find(t => /curriculum/i.test(t.text));
  if (curriculumTab && curriculumTab.href.startsWith("#")) {
    // click by text match to avoid anchor rewrites
    await page.evaluate((txt) => {
      const a = Array.from(document.querySelectorAll('a[href*="#"]')).find(x => (x.textContent || "").trim().match(new RegExp(txt, "i")));
      if (a) a.click();
    }, "Curriculum");
    await sleep(400);
  }

  // 2) Wait for something that usually contains requirements
  // Try common containers in priority order
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
      await page.waitForSelector(sel, { timeout: 2500 });
      // Confirm it actually contains "Program Requirements" or a course list
      const hasReq = await page.$eval(sel, el => /Program Requirements|Course List|General Education Requirements/i.test(el.innerText));
      if (hasReq) {
        containerHandle = sel;
        break;
      }
    } catch {}
  }

  // 3) If not found yet, fall back: locate the heading node by text and take its nearest section
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
        if (sec) {
          sec.setAttribute("data-cf-picked", "1");
          return true;
        }
      }
      return false;
    });
    if (ok) containerHandle = '[data-cf-picked="1"]';
  }

  if (!containerHandle) return null;

  // Grab innerText of the chosen container
  const text = await page.$eval(containerHandle, el => (el.innerText || "").trim());
  return text || null;
}

async function run() {
  // load links
  if (!fs.existsSync(LINKS_PATH)) {
    console.error(`❌ Missing ${LINKS_PATH}`);
    process.exit(1);
  }
  const linksJson = JSON.parse(fs.readFileSync(LINKS_PATH, "utf-8"));
  const tischLinks = (linksJson["Tisch"] || []).filter(u => !/programs\.pdf/i.test(u));
  if (tischLinks.length === 0) {
    console.error("❌ No Tisch curriculum links found in program_links.json");
    process.exit(1);
  }

  // normalize: strip fragments so we’re not dependent on old anchors
  const normalized = Array.from(new Set(tischLinks.map(u => u.split("#")[0])));

  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.setUserAgent("coursefix/1.0 (+tisch-scraper; puppeteer)");
  await page.setViewport({ width: 1280, height: 900 });

  const results = { Tisch: {} };

  console.log(`🎭 Scraping ${normalized.length} Tisch programs…`);
  for (const url of normalized) {
    const slug = last(url.replace(/\/$/, "").split("/")); // e.g. interactive-media-arts-bfa
    console.log(`  • ${slug}`);

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });

      // Wait a breath for any JS that hydrates the tab content
      await sleep(300);

      const title = await page.$eval("h1", el => (el.textContent || "").trim()).catch(() => slug);

      const reqText = await extractProgramRequirements(page);
      if (!reqText) {
        console.log("    ↳ ⚠️ Program Requirements block not found");
        continue;
      }

      const parsed = parseRequirementsBlock(reqText);

      results.Tisch[title] = {
        url,
        parsed,
        // keep a small raw excerpt for debugging (first 600 chars)
        raw_excerpt: reqText.slice(0, 600)
      };

      console.log(`    ↳ ✅ parsed sections: ${Object.keys(parsed).join(", ") || "none"}`);
    } catch (e) {
      console.log(`    ↳ ❌ ${e.message}`);
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
