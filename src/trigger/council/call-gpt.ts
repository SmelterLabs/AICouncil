import { task } from "@trigger.dev/sdk/v3";
import { createLLMClient } from "../../lib/llm-client";
import { traceLLM } from "../lib/langfuse";

export const callGpt = task({
  id: "council-call-gpt",
  run: async (payload: { prompt: string; systemInstruction: string }) => {
    const start = Date.now();
    const client = createLLMClient("gpt");
    const result = await traceLLM("council-gpt", () =>
      client.generate(payload.prompt, payload.systemInstruction)
    );
    const durationMs = Date.now() - start;

    return {
      response: result.response,
      modelId: result.modelId,
      durationMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
  },
});
