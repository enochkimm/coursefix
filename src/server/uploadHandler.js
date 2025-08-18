import express from 'express';
import multer from 'multer';
import { extractTextFromPDF } from '../utils/pdfToText.js';
import { parseTranscriptText } from '../transcriptReader/index.js';
import { matchTranscriptToCatalog } from '../transcriptReader/matcher.js';

const router = express.Router();
const upload = multer();

router.post('/upload', upload.single('transcript'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Transcript file is missing.' });
    }

    // Step 1: Extract text from uploaded PDF
    const text = await extractTextFromPDF(req.file.buffer);
    console.log('📝 Extracted PDF text:\n', text); // ← log raw text

    // Step 2: Parse transcript text
    const parsed = parseTranscriptText(text);
    console.log('📚 Parsed transcript courses:', parsed); // ← log parsed courses

    // Step 3: Match against catalog
    const matched = matchTranscriptToCatalog(parsed);

    // Step 4: Respond
    res.json({
      parsed: matched,
      matchedCount: matched.filter(c => c.matched).length,
      total: matched.length,
      unmatched: matched.filter(c => !c.matched),
    });

  } catch (err) {
    console.error('❌ Upload handler error:', err);
    res.status(500).json({ error: 'Failed to process transcript.' });
  }
});

export default router;