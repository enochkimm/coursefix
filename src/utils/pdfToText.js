// src/utils/pdfToText.js

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Tell PDF.js where to find fonts locally
pdfjsLib.GlobalWorkerOptions.standardFontDataUrl = path.join(
  __dirname,
  '../../node_modules/pdfjs-dist/standard_fonts/'
);

export async function extractTextFromPDF(buffer) {
  const uint8Array = new Uint8Array(buffer);

  const pdf = await pdfjsLib.getDocument({ data: uint8Array }).promise;
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(item => item.str).join(' ');
    fullText += text + '\n';
  }

  return fullText;
}