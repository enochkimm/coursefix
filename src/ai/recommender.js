require('dotenv').config();
const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Recommend optimal courses using GPT based on student info and course options
 * @param {Object} student - Parsed transcript JSON
 * @param {Array} courseList - List of eligible courses
 * @returns {Promise<Array>} - GPT-chosen recommended courses
 */
async function getRecommendations(student, courseList) {
  const prompt = `
You're an NYU academic advisor. The student has the following transcript data:
Major: ${student.major || 'Unknown'}
Minor: ${student.minor || 'None'}
Courses taken: ${student.courses.map(c => `${c.code} (${c.grade})`).join(', ')}

Here are available courses they are eligible to take:
${courseList.map(c => `${c.code}: ${c.name}`).join('\n')}

Recommend 3–5 courses. For each, return:
- Course name and code
- One-sentence reason (e.g., "Fulfills GenEd", "Top professor", "Important for major")

Respond ONLY as a JSON array like this:
[
  { "course": "DS-UA 204: Machine Learning", "reason": "..." },
  ...
]
`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7
  });

  // Try parsing output as JSON
  try {
    const raw = response.choices[0].message.content;
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (err) {
    console.error('Failed to parse GPT response:', err);
    return [];
  }
}

module.exports = { getRecommendations };
