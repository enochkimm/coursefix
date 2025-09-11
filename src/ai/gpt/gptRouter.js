// src/ai/gpt/gptRouter.js
import { MODELS, loadPrompt, askOpenAI, askAnthropic } from "./gptConfig.js";

// ----------------------------
// 1) Fix Curriculum JSON
// ----------------------------
export async function fixCurriculum({ bulletinText, scrapedJSON }) {
  const systemPrompt = loadPrompt("curriculum.txt");
  const userPrompt = JSON.stringify({ bulletinText, scrapedJSON }, null, 2);

  try {
    return await askAnthropic({
      model: MODELS.curriculum,
      systemPrompt,
      userPrompt,
      responseFormat: "json",
    });
  } catch (e) {
    console.warn("⚠️ Curriculum primary failed, trying fallback:", e.message);
    return await askAnthropic({
      model: MODELS.curriculum_fallback,
      systemPrompt,
      userPrompt,
      responseFormat: "json",
    });
  }
}

// ----------------------------
// 2) Compute / Verify Progress
// ----------------------------
export async function computeProgressLLM({ transcript, curriculumJSON, deterministicProgress }) {
  const systemPrompt = loadPrompt("progress.txt");
  const userPrompt = JSON.stringify({ transcript, curriculumJSON, deterministicProgress }, null, 2);

  try {
    return await askAnthropic({
      model: MODELS.progress,
      systemPrompt,
      userPrompt,
      responseFormat: "json",
    });
  } catch (e) {
    console.warn("⚠️ Progress check primary failed, trying fallback:", e.message);
    return await askOpenAI({
      model: MODELS.progress_fallback,
      systemPrompt,
      userPrompt,
      responseFormat: "json",
    });
  }
}

// ----------------------------
// 3) Recommend Next Term
// ----------------------------
export async function recommendNextTerm({ transcript, curriculumJSON, constraints, intentText }) {
  const systemPrompt = loadPrompt("recommend.txt");
  const userPrompt = JSON.stringify({ transcript, curriculumJSON, constraints, intentText }, null, 2);

  try {
    return await askOpenAI({
      model: MODELS.recommend,
      systemPrompt,
      userPrompt,
      responseFormat: "json",
    });
  } catch (e) {
    console.warn("⚠️ Recommend primary failed, trying fallback:", e.message);
    return await askAnthropic({
      model: MODELS.recommend_fallback,
      systemPrompt,
      userPrompt,
      responseFormat: "json",
    });
  }
}

// ----------------------------
// 4) Disambiguate Transcript Lines
// ----------------------------
export async function disambiguateTranscriptLine({ line, courseCatalog }) {
  const systemPrompt = loadPrompt("transcript.txt");
  const userPrompt = JSON.stringify({ line, courseCatalog }, null, 2);

  try {
    return await askOpenAI({
      model: MODELS.transcript,
      systemPrompt,
      userPrompt,
      responseFormat: "json",
    });
  } catch (e) {
    console.warn("⚠️ Transcript disambiguation primary failed, trying fallback:", e.message);
    return await askOpenAI({
      model: MODELS.transcript_fallback,
      systemPrompt,
      userPrompt,
      responseFormat: "json",
    });
  }
}