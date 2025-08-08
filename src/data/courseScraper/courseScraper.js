//main course scraper

import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

const urlsPath = path.join('./src/data/courseScraper', 'bulletin_links.json');
const outputPath = path.join('./src/data/courseScraper', 'allCourses.json');

const rawLinks = JSON.parse(fs.readFileSync(urlsPath, 'utf-8'));
const flatLinks = [];

for (const [school, urls] of Object.entries(rawLinks)) {
  for (const url of urls) {
    flatLinks.push({ school, url });
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrapeCoursesFromURL(url) {
  const { data } = await axios.get(url);
  const $ = cheerio.load(data);
  const courses = [];

  const blocks = $('.courseblock').toArray();
  for (const el of blocks) {
    const code = $(el).find('.detail-code strong').text().trim();
    const name = $(el).find('.detail-title strong').text().trim();
    const desc = $(el).find('.courseblockextra').text().trim().replace(/\s+/g, ' ');

    const prereqs = [];
    const prereqLinks = $(el).find('.detail-prerequisites a');
    prereqLinks.each((_, elem) => {
      const title = $(elem).attr('title');
      if (title) {
        const clean = title.replace(/\xa0/g, ' ').trim();
        if (/^[A-Z]{2,}-[A-Z]{2,} \d{3,4}$/.test(clean)) {
          prereqs.push(clean);
        }
      }
    });

    if (code && name) {
      courses.push({ code, name, desc, prereqs });
    }
  }

  return courses;
}

async function run() {
  const allCourses = [];

  console.log(`\n📘 Starting course scraping from ${flatLinks.length} departments...\n`);

  for (let i = 0; i < flatLinks.length; i++) {
    const { school, url } = flatLinks[i];
    const deptName = url.split('/').at(-2);

    console.log(`🧾 [${i + 1}/${flatLinks.length}] ${school} → ${deptName}`);

    try {
      const deptCourses = await scrapeCoursesFromURL(url);
      allCourses.push(...deptCourses);
      console.log(`   ✅ ${deptCourses.length} courses scraped\n`);
    } catch (err) {
      console.warn(`   ❌ Failed to scrape: ${err.message}\n`);
    }

    await delay(1000);
  }

  fs.writeFileSync(outputPath, JSON.stringify(allCourses, null, 2));
  console.log(`\n🎉 Done! Total courses saved: ${allCourses.length}\n📁 Output: ${outputPath}\n`);
}

run();