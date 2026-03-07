import { task } from "@trigger.dev/sdk/v3";
import { createLLMClient } from "../../lib/llm-client";
import { CouncilMember } from "../../lib/types";
import { traceLLM, flushLangfuse } from "../lib/langfuse";

interface RoundData {
  round: number;
  member: string;
  role: string;
  response: string;
}

interface SynthesizePayload {
  question: string;
  allRounds: RoundData[];
  synthesizer: CouncilMember;
}

const SYNTHESIS_SYSTEM = `You are synthesizing a structured debate between AI models. Your job is to produce a definitive final answer. Be concise and matter of fact.`;

function buildSynthesisPrompt(
  question: string,
  allRounds: RoundData[]
): string {
  let prompt = `Original question: ${question}\n\n`;
  prompt += `Below is the full debate transcript:\n\n`;

  for (const round of allRounds) {
    const label = round.member.charAt(0).toUpperCase() + round.member.slice(1);
    prompt += `--- Round ${round.round} — ${label} (${round.role}) ---\n`;
    prompt += `${round.response}\n\n`;
  }

  prompt += `Synthesize and give a concise conclusion. Be definitive. Don't summarize the debate.\n`;

  return prompt;
}

export const synthesize = task({
  id: "council-synthesize",
  run: async (payload: SynthesizePayload) => {
    try {
      const start = Date.now();
      const client = createLLMClient(payload.synthesizer);
      const prompt = buildSynthesisPrompt(payload.question, payload.allRounds);
      const result = await traceLLM(`council-synthesize-${payload.synthesizer}`, () =>
        client.generate(prompt, SYNTHESIS_SYSTEM)
      );
      const durationMs = Date.now() - start;

      return {
        synthesis: result.response,
        modelId: result.modelId,
        durationMs,
        prompt,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      };
    } finally {
      await flushLangfuse();
    }
  },
});
