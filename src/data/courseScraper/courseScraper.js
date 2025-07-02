import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

// CHANGE THIS TO ANY BULLETIN URL YOU WANT
const BULLETIN_URL = 'https://bulletins.nyu.edu/courses/ds_ua/';

async function scrapeBulletin() {
  const { data } = await axios.get(BULLETIN_URL);
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
      let title = $(elem).attr('title');
      if (title) {
        title = title.replace(/\xa0/g, ' ').trim();
        if (/^[A-Z]{2,}-[A-Z]{2,} \d{3,4}$/.test(title)) {
          prereqs.push(title);
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
  const courses = await scrapeBulletin();

  const outputPath = path.join('./src/data/courseScraper', 'courselist.json');
  fs.writeFileSync(outputPath, JSON.stringify(courses, null, 2));

  console.log(`✅ Scraped ${courses.length} courses from NYU Bulletin.`);
}

run();
