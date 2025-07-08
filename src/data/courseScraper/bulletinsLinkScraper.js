import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const SCHOOL_SUFFIXES = {
  "CAS": "_ua/",
  "Stern": "_ub/",
  "Tandon": "_uy/",
  "Steinhardt": "_ge/",
  "SPS": "_uc/",
  "Tisch": "_ut/",
  "Dentistry": "_ud/",
  "Nursing": "_un/",
  "Wagner": "_gp/",
  "Silver": "_us/",
  "Liberal Studies": "_uf/",
  "Gallatin": "_ug/"
};

async function scrapeBulletinLinks() {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  console.log('🔍 Navigating to NYU Bulletin...');
  await page.goto('https://bulletins.nyu.edu/courses/', { waitUntil: 'domcontentloaded' });

  const allLinks = await page.evaluate(() => {
    const seen = new Set();
    return Array.from(document.querySelectorAll('a[href^="/courses/"]'))
      .map(a => a.getAttribute('href'))
      .filter(href => href && href.endsWith('/') && href.startsWith('/courses/'))
      .map(href => `https://bulletins.nyu.edu${href}`)
      .filter(link => {
        if (seen.has(link)) return false;
        seen.add(link);
        return true;
      });
  });

  console.log(`🔗 Found ${allLinks.length} unique course links`);

  const groupedResults = {};

  for (const [school, suffix] of Object.entries(SCHOOL_SUFFIXES)) {
    const matches = allLinks.filter(link => link.includes(suffix));
    if (matches.length > 0) {
      groupedResults[school] = [...new Set(matches)].sort();
    }
  }

  const outputPath = path.join('./src/data/courseScraper', 'bulletin_links.json');
  fs.writeFileSync(outputPath, JSON.stringify(groupedResults, null, 2));

  console.log(`✅ Saved grouped course links (${Object.keys(groupedResults).length} schools) to ${outputPath}`);

  await browser.close();
  process.exit(0);
}

scrapeBulletinLinks();
