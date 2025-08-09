export function parseTranscriptText(text) {
  const semesterRegex = /^(Fall|Spring|Summer|Winter)\s+\d{4}$/;
  const courseCodeRegex = /\b[A-Z]{2,}-[A-Z]{2,}\s?\d{1,4}\b/g;

  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const results = [];
  let currentSemester = '';

  for (const line of lines) {
    if (semesterRegex.test(line)) {
      currentSemester = line;
    }

    const matches = line.match(courseCodeRegex);
    if (matches) {
      for (const code of matches) {
        results.push({
          semester: currentSemester,
          code: code.trim()
        });
      }
    }
  }

  return results;
}
