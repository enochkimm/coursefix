import 'dotenv/config';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function extractPrereqsFromDescription(desc) {
  try {
    const prompt = `
Extract a list of NYU course codes that are actual prerequisites from this course description.

✅ Include courses students must take before this one.
❌ Do NOT include courses the student must avoid, or courses listed only under restrictions.

Only return a plain JSON array of course codes. Return [] if there are no prerequisites.

Description:
${desc}
    `.trim();

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: 'You extract NYU course prerequisites from text.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    let content = response.choices[0].message.content.trim();
    content = content.replace(/```json|```/g, '').trim();

    const parsed = JSON.parse(content);

    // Basic sanity filter: keep only things that look like valid course codes
    const filtered = (Array.isArray(parsed) ? parsed : []).filter(code =>
      /^[A-Z]{2,}-[A-Z]{2,} \d{3,4}$/.test(code)
    );

    return [...new Set(filtered)];
  } catch (err) {
    console.warn('⚠️ GPT failed, falling back to regex:', err.message);
    const fallback = desc.match(/[A-Z]{2,}-[A-Z]{2,} \d{3,4}/g);
    return fallback ? [...new Set(fallback)] : [];
  }
}