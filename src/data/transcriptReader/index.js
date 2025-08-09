// src/data/transcriptReader/index.js
// Robust parser: (1) extracts semesters by slicing the text into blocks,
// (2) matches codes even with weird PDF spacing (e.g., EXPOS-UA   5),
// (3) de-dupes results.

export function parseTranscriptText(text) {
  // Match "Fall 2024", "Spring 2025", etc. anywhere in the text
  const semHdr = /(Fall|Spring|Summer|Winter)\s+(\d{4})/g;

  // Match course codes like "IMNY-UT 101", "EXPOS-UA   5", "CAMS-UA 152"
  // Allow ANY whitespace (incl. non-breaking) between dept and number
  const codeRe = /([A-Z]{2,}-[A-Z]{2,})[\s\u00A0]*([0-9]{1,4})/g;

  // Build semester blocks so matches inherit the correct semester
  const blocks = [];
  let m, last = null;
  while ((m = semHdr.exec(text)) !== null) {
    if (last) {
      last.end = m.index;
      last.text = text.slice(last.start, last.end);
      blocks.push(last);
    }
    last = { semester: `${m[1]} ${m[2]}`, start: m.index };
  }
  if (last) {
    last.end = text.length;
    last.text = text.slice(last.start, last.end);
    blocks.push(last);
  }

  const results = [];
  const seen = new Set();
  const push = (semester, dept, num) => {
    const code = `${dept} ${num}`.trim();
    const key = `${semester}|${code}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ semester, code });
    }
  };

  if (blocks.length === 0) {
    // Fallback: no semester headers found — scan all text, semester empty
    let c;
    while ((c = codeRe.exec(text)) !== null) push('', c[1], c[2]);
    return results;
    }

  // Normal path: scan each semester block
  for (const b of blocks) {
    codeRe.lastIndex = 0;
    let c;
    while ((c = codeRe.exec(b.text)) !== null) push(b.semester, c[1], c[2]);
  }

  return results;
}
