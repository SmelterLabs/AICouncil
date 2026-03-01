import { GoogleGenerativeAI } from "@google/generative-ai";
import Anthropic from "@anthropic-ai/sdk";
import { CouncilMember } from "./types";

export interface LLMResponse {
  response: string;
  modelId: string;
}

export interface LLMClient {
  generate(prompt: string, systemInstruction: string): Promise<LLMResponse>;
}

const GEMINI_MODEL = "gemini-3.1-pro-preview";
const CLAUDE_MODEL = "claude-sonnet-4-6-20250514";

function createGeminiClient(): LLMClient {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

  return {
    async generate(prompt, systemInstruction) {
      const model = genAI.getGenerativeModel({
        model: GEMINI_MODEL,
        systemInstruction,
      });
      const result = await model.generateContent(prompt);
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
      });

      const response = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");

      return { response, modelId: CLAUDE_MODEL };
    },
  };
}

export function createLLMClient(member: CouncilMember): LLMClient {
  switch (member) {
    case "gemini":
      return createGeminiClient();
    case "claude":
      return createClaudeClient();
    default:
      throw new Error(`Unknown council member: ${member}`);
  }
}
