import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { CouncilMember } from "./types";

export interface LLMResponse {
  response: string;
  modelId: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface LLMClient {
  generate(prompt: string, systemInstruction: string): Promise<LLMResponse>;
}

const GEMINI_MODEL = "gemini-2.5-pro";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const GROK_MODEL = "grok-4";
const GPT_MODEL = "gpt-4o";

function createGeminiClient(): LLMClient {
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY!,
    httpOptions: {
      timeout: 120_000, // 2 min per request
      retryOptions: { attempts: 2 }, // 1 try + 1 retry (default is 5)
    },
  });

  return {
    async generate(prompt, systemInstruction) {
      const result = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          systemInstruction,
          tools: [{ googleSearch: {} }],
        },
      });
      const response = result.text ?? "";
      const usage = result.usageMetadata;
      return {
        response,
        modelId: GEMINI_MODEL,
        inputTokens: usage?.promptTokenCount,
        outputTokens: usage?.candidatesTokenCount,
      };
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

      return {
        response,
        modelId: CLAUDE_MODEL,
        inputTokens: message.usage?.input_tokens,
        outputTokens: message.usage?.output_tokens,
      };
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
      return {
        response: response.output_text,
        modelId: GROK_MODEL,
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
      };
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
      return {
        response: response.output_text,
        modelId: GPT_MODEL,
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
      };
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
