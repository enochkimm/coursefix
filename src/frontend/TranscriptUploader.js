import { useState } from 'react';
import { parseTranscriptText } from '../data/transcriptReader';
import { matchTranscriptToCatalog } from '../data/transcriptReader/matcher';

export default function TranscriptUploader() {
  const [file, setFile] = useState(null);
  const [output, setOutput] = useState('');

  const handleUpload = async () => {
    if (!file) return alert('Please select a PDF transcript');

    const formData = new FormData();
    formData.append('transcript', file);

    try {
      const res = await fetch('http://localhost:3001/api/uploadTranscript', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!data.text) {
        setOutput('⚠️ Failed to extract text from PDF.');
        return;
      }

      const parsedCourses = parseTranscriptText(data.text);               // Step 1: Parse text
      const matchedCourses = matchTranscriptToCatalog(parsedCourses);     // Step 2: Match to catalog

      setOutput(JSON.stringify(matchedCourses, null, 2));                 // Step 3: Show result
    } catch (err) {
      console.error(err);
      setOutput('❌ Error uploading or processing transcript.');
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className="text-xl font-bold mb-4">Upload Your NYU Transcript (PDF)</h2>
      <input type="file" accept=".pdf" onChange={(e) => setFile(e.target.files[0])} />
      <button
        onClick={handleUpload}
        className="mt-4 px-4 py-2 bg-blue-600 text-white rounded"
      >
        Upload & Analyze
      </button>

      {output && (
        <pre className="mt-6 bg-gray-100 p-4 rounded whitespace-pre-wrap text-sm">
          {output}
        </pre>
      )}
    </div>
  );
}