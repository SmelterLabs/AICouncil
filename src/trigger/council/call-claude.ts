import { task } from "@trigger.dev/sdk/v3";
import { createLLMClient } from "../../lib/llm-client";

export const callClaude = task({
  id: "council-call-claude",
  run: async (payload: { prompt: string; systemInstruction: string }) => {
    const start = Date.now();
    const client = createLLMClient("claude");
    const result = await client.generate(
      payload.prompt,
      payload.systemInstruction
    );
    const durationMs = Date.now() - start;

    return {
      response: result.response,
      modelId: result.modelId,
      durationMs,
    };
  },
});
