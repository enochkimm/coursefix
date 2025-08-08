// src/data/transcriptReader/matcher.js
import fs from 'fs';
import path from 'path';

const catalogPath = path.join('./src/data/courseScraper', 'allCourses.json');
const allCourses = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));

/**
 * Matches parsed transcript courses to courses in allCourses.json
 * @param {Array} transcriptCourses - parsed from parseTranscriptText()
 * @returns {Array} - original transcript courses with a `matched` boolean
 */
export function matchTranscriptToCatalog(transcriptCourses) {
  return transcriptCourses.map(course => {
    const match = allCourses.find(c => c.code === course.code);
    return {
      ...course,
      matched: !!match,
    };
  });
}