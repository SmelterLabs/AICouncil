import { GoogleGenerativeAI } from "@google/generative-ai";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { CouncilMember } from "./types";

export interface LLMResponse {
  response: string;
  modelId: string;
}

export interface LLMClient {
  generate(prompt: string, systemInstruction: string): Promise<LLMResponse>;
}

const GEMINI_MODEL = "gemini-3.1-pro-preview";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const GROK_MODEL = "grok-3";
const GPT_MODEL = "gpt-4o";

function createGeminiClient(): LLMClient {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

  return {
    async generate(prompt, systemInstruction) {
      const model = genAI.getGenerativeModel({
        model: GEMINI_MODEL,
        systemInstruction,
      });
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} } as any],
      });
      const response = result.response.text();
      return { response, modelId: GEMINI_MODEL };
    },
  };
}

function createClaudeClient(): LLMClient {
  const anthropic = new Anthropic();

  return {
    async generate(prompt, systemInstruction) {
      const message = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        system: systemInstruction,
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      });

      const response = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");

      return { response, modelId: CLAUDE_MODEL };
    },
  };
}

function createGrokClient(): LLMClient {
  const client = new OpenAI({
    apiKey: process.env.XAI_API_KEY,
    baseURL: "https://api.x.ai/v1",
  });

  return {
    async generate(prompt, systemInstruction) {
      const response = await client.responses.create({
        model: GROK_MODEL,
        instructions: systemInstruction,
        input: prompt,
        tools: [{ type: "web_search" as any }],
      });
      return { response: response.output_text, modelId: GROK_MODEL };
    },
  };
}

function createGptClient(): LLMClient {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  return {
    async generate(prompt, systemInstruction) {
      const response = await client.responses.create({
        model: GPT_MODEL,
        instructions: systemInstruction,
        input: prompt,
        tools: [{ type: "web_search_preview" }],
      });
      return { response: response.output_text, modelId: GPT_MODEL };
    },
  };
}

export function createLLMClient(member: CouncilMember): LLMClient {
  switch (member) {
    case "gemini":
      return createGeminiClient();
    case "claude":
      return createClaudeClient();
    case "grok":
      return createGrokClient();
    case "gpt":
      return createGptClient();
    default:
      throw new Error(`Unknown council member: ${member}`);
  }
}
