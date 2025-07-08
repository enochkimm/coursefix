import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';

import { parseTranscript } from '../ai/transcriptReader.js';
import { getEligibleCourses } from '../ai/requirementChecker.js';
import { getRecommendations } from '../ai/recommender.js';

const router = express.Router();
const upload = multer();

router.post('/upload', upload.single('transcript'), async (req, res) => {
  try {
    const transcriptData = await parseTranscript(req.file.buffer);
    const courseDataPath = path.join(path.dirname(new URL(import.meta.url).pathname), '../data/nyu_bulletins/courses.json');
    const courseData = JSON.parse(fs.readFileSync(courseDataPath, 'utf-8'));

    const coursesWithPrereqs = courseData.map(course => ({
      ...course,
      prereqs: course.code === 'DS-UA 204' ? ['DS-UA 111'] : []
    }));

    const eligibleCourses = getEligibleCourses(transcriptData, coursesWithPrereqs);
    const recommendations = await getRecommendations(transcriptData, eligibleCourses);

    res.json({
      parsedTranscript: transcriptData,
      eligibleCourses,
      recommendations
    });
  } catch (err) {
    console.error('❌ Error in uploadHandler:', err);
    res.status(500).send('Failed to process transcript or course recommendations.');
  }
});

export default router;