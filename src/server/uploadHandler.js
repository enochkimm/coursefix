const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const { parseTranscript } = require('../ai/transcriptReader');
const { getEligibleCourses } = require('../ai/requirementChecker');
const { getRecommendations } = require('../ai/recommender');

const router = express.Router();
const upload = multer();

router.post('/upload', upload.single('transcript'), async (req, res) => {
  try {
    // Step 1: Parse transcript
    const transcriptData = await parseTranscript(req.file.buffer);

    // Step 2: Load real courses from NYU Bulletin (scraped)
    const courseDataPath = path.join(__dirname, '../data/nyu_bulletins/courses.json');
    const courseData = JSON.parse(fs.readFileSync(courseDataPath, 'utf-8'));

    // 🧪 TEMP: Add mock prereqs manually (until you parse real ones properly)
    const coursesWithPrereqs = courseData.map(course => ({
      ...course,
      prereqs: course.code === 'DS-UA 204' ? ['DS-UA 111'] : [] // dummy logic
    }));

    // Step 3: Filter courses based on transcript
    const eligibleCourses = getEligibleCourses(transcriptData, coursesWithPrereqs);

    // Step 4: Ask GPT to recommend courses from the eligible list
    const recommendations = await getRecommendations(transcriptData, eligibleCourses);

    // Step 5: Return the results
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

module.exports = router;
