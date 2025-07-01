const pdfParse = require('pdf-parse');

async function parseTranscript(pdfBuffer) {
  const data = await pdfParse(pdfBuffer);
  const text = data.text;

  const result = {
    major: null,
    minor: null,
    courses: []
  };

  const majorMatch = text.match(/Major:\s*(.+)/i);
  const minorMatch = text.match(/Minor:\s*(.+)/i);
  result.major = majorMatch?.[1]?.trim() || null;
  result.minor = minorMatch?.[1]?.trim() || null;

  const courseRegex = /([A-Z]{2,}-[A-Z]{2,} \d{3})\s+(.+?)\s+([A-F][+-]?)/g;
  let match;
  while ((match = courseRegex.exec(text)) !== null) {
    result.courses.push({
      code: match[1],
      name: match[2].trim(),
      grade: match[3]
    });
  }

  return result;
}

module.exports = { parseTranscript };
