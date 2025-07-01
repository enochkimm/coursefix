// src/data/courseScraper/courseScraper.js

import axios from 'axios';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { extractPrereqsFromDescription } from '../../utils/extractPrereqs.js';

const BULLETIN_URL = 'https://bulletins.nyu.edu/courses/ds_ua/';
const COURSICLE_URL = 'https://www.coursicle.com/nyu/courses/DSUA/';

async function scrapeBulletin() {
  const { data } = await axios.get(BULLETIN_URL);
  const $ = cheerio.load(data);
  const courses = [];

  const blocks = $('.courseblock').toArray();
  for (const el of blocks) {
    const code = $(el).find('.detail-code strong').text().trim();
    const name = $(el).find('.detail-title strong').text().trim();
    const desc = $(el).find('.courseblockextra').text().trim().replace(/\s+/g, ' ');

    const prereqs = await extractPrereqsFromDescription(desc);

    if (code && name) {
      courses.push({ code, name, desc, prereqs });
    }
  }

  return courses;
}

async function scrapeCoursicle() {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(COURSICLE_URL, { waitUntil: 'networkidle2' });

  const courses = await page.evaluate(() => {
    const tiles = document.querySelectorAll('#tileContainer .tileElement:not(#moreTile)');
    const results = [];

    tiles.forEach(tile => {
      const code = tile.querySelector('.tileElementText')?.textContent?.trim();
      const name = tile.querySelector('.tileElementHiddenText')?.textContent?.trim();
      if (code && name) {
        results.push({ code, name });
      }
    });

    return results;
  });

  await browser.close();
  return courses;
}

async function run() {
  const bulletinCourses = await scrapeBulletin();
  const coursicleCourses = await scrapeCoursicle();
  const coursicleSet = new Set(coursicleCourses.map(c => c.code.trim().toUpperCase()));

  const merged = bulletinCourses.map(course => ({
    ...course,
    offered: coursicleSet.has(course.code.trim().toUpperCase())
  }));

  const outputPath = path.join('./src/data/courseScraper', 'mergedCourses.json');
  fs.writeFileSync(outputPath, JSON.stringify(merged, null, 2));
  console.log(`✅ Merged ${merged.length} courses to mergedCourses.json`);
}

run();
