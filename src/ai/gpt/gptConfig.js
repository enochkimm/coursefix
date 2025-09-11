// src/ai/gpt/gptConfig.js
import fs from "fs";
import path from "path";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";

dotenv.config();

// ----------------------------
// API Clients
// ----------------------------
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ----------------------------
// Model Defaults (override via .env)
// ----------------------------
export const MODELS = {
  transcript: process.env.MODEL_TRANSCRIPT || "gpt-4.1",    // quick + cheap
  transcript_fallback: "gpt-4o-mini",

  curriculum: process.env.MODEL_CURRICULUM || "claude-3-5-sonnet-20240620",
  curriculum_fallback: "claude-3-opus-20240229",

  progress: process.env.MODEL_PROGRESS || "claude-3-5-sonnet-20240620",
  progress_fallback: "gpt-4.1",

  recommend: process.env.MODEL_RECOMMEND || "gpt-4.1",          // advisor
  recommend_fallback: "claude-3-5-sonnet-20240620",
};

// ----------------------------
// Prompt Loader
// ----------------------------
const PROMPTS_DIR = path.join(process.cwd(), "src/ai/gpt/prompts");

export function loadPrompt(filename) {
  const filePath = path.join(PROMPTS_DIR, filename);
  return fs.readFileSync(filePath, "utf-8");
}

// ----------------------------
// Generic Helpers
// ----------------------------
export async function askOpenAI({ model, systemPrompt, userPrompt, responseFormat = "json" }) {
  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: responseFormat === "json" ? { type: "json_object" } : undefined,
  });

  const text = completion.choices[0]?.message?.content || "";
  if (responseFormat === "json") {
    try {
      return JSON.parse(text);
    } catch (e) {
      return { error: "Invalid JSON", raw: text };
    }
  }
  return text;
}

export async function askAnthropic({ model, systemPrompt, userPrompt, responseFormat = "json" }) {
  const msg = await anthropic.messages.create({
    model,
    max_tokens: 1000,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = msg.content[0]?.text || "";
  if (responseFormat === "json") {
    try {
      return JSON.parse(text);
    } catch (e) {
      return { error: "Invalid JSON", raw: text };
    }
  }
  return text;
}