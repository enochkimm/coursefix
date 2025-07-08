import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

const urlsPath = path.join('./src/data/courseScraper', 'bulletin_links.json');
const outputPath = path.join('./src/data/courseScraper', 'allCourses.json');

// Load and convert grouped { school: [urls] } into flat array
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

  for (const { school, url } of flatLinks) {
    console.log(`🔍 Scraping ${school}: ${url}`);
    try {
      const deptCourses = await scrapeCoursesFromURL(url);
      allCourses.push(...deptCourses);
      console.log(`✅ ${url.split('/').at(-2)}: ${deptCourses.length} courses`);
    } catch (err) {
      console.warn(`❌ Failed to scrape ${url}: ${err.message}`);
    }

    await delay(1000); // polite delay between departments
  }

  fs.writeFileSync(outputPath, JSON.stringify(allCourses, null, 2));
  console.log(`🎉 Saved ${allCourses.length} total courses to allCourses.json`);
}

run();