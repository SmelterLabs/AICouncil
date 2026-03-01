import { task } from "@trigger.dev/sdk/v3";
import { createLLMClient } from "../../lib/llm-client";
import { CouncilMember } from "../../lib/types";

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

const SYNTHESIS_SYSTEM = `You are synthesizing a structured debate between AI models. Your job is to produce a fair, balanced final answer.`;

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

  prompt += `Based on the debate above, provide a synthesis that includes:\n`;
  prompt += `1. **Points of Agreement** — Where both sides converge\n`;
  prompt += `2. **Points of Disagreement** — Where they differ, with reasoning from each side\n`;
  prompt += `3. **Synthesized Final Answer** — Your best answer incorporating both perspectives\n`;
  prompt += `4. **Confidence Assessment** — How confident you are in the synthesized answer and why\n`;

  return prompt;
}

export const synthesize = task({
  id: "council-synthesize",
  run: async (payload: SynthesizePayload) => {
    const start = Date.now();
    const client = createLLMClient(payload.synthesizer);
    const prompt = buildSynthesisPrompt(payload.question, payload.allRounds);
    const result = await client.generate(prompt, SYNTHESIS_SYSTEM);
    const durationMs = Date.now() - start;

    return {
      synthesis: result.response,
      modelId: result.modelId,
      durationMs,
      prompt,
    };
  },
});
