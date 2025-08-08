// data/transcriptReader.js
// reads transcript/parses codes

export function parseTranscriptText(text) {
  const semesterRegex = /^(Fall|Spring|Summer|Winter)\s+\d{4}$/;
  const courseLineRegex = /^(.*?)([A-Z]{2,}-[A-Z]{2,}\s+\d{1,4})\s+(\d+\.\d)\s+([A-F][+-]?|\*\*\*|P)$/;

  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const results = [];
  let currentSemester = '';

  for (const line of lines) {
    if (semesterRegex.test(line)) {
      currentSemester = line;
      continue;
    }

    const match = line.match(courseLineRegex);
    if (match) {
      const [, rawName, code, credits, grade] = match;
      const name = rawName.trim().replace(/\s{2,}/g, ' ');

      results.push({
        semester: currentSemester,
        code: code.trim(),
        name,
        grade: grade === '***' ? null : grade,
        credits: parseFloat(credits),
      });
    }
  }

  return results;
}
