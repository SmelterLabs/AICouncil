import { task } from "@trigger.dev/sdk/v3";
import { createLLMClient } from "../../lib/llm-client";
import { CouncilMember } from "../../lib/types";
import { traceLLM } from "../lib/langfuse";

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

const SYNTHESIS_SYSTEM = `You are the chairman of a debate between several AI models. You did not participate in the debate. Your job is to produce a structured synthesis — a map of what the council established, what it failed to establish, and what should be trusted from the debate.

Treat each member's claims with skepticism. A confidently-asserted claim is not evidence — citation, reasoning, and concession patterns are evidence. If a claim was asserted without grounding and never challenged by peers, mark it as weakly supported.

If the debate did not actually resolve the question — for example because every member relied on assertion rather than verifiable evidence, or because key facts are user-specific and were not accessible to the council — say so explicitly rather than producing a forced answer. A flagged non-resolution is more useful than a confident wrong verdict.

Bring your own perspective through the synthesis structure, not by inserting an additional debate position.`;

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

  prompt += `Produce the synthesis in this structure:\n\n`;
  prompt += `1. **What the council agrees on** — points multiple members converged on independently in Round 1, before peer review. These are high-confidence signals.\n`;
  prompt += `2. **Where the council clashes** — genuine disagreements that survived Round 2. Present both sides with their reasoning. Do not pick a winner here.\n`;
  prompt += `3. **Weakly evidenced claims** — assertions any member made that were not grounded (no citation, no reasoning, no verification mechanism). Flag confident hallucinations.\n`;
  prompt += `4. **Recommendation** — your best read of the answer, OR a flag that the debate did not resolve. If the latter, explain why and what would be needed to resolve.\n`;
  prompt += `5. **Confidence** — your stated confidence in the recommendation, on a 0-10 scale.\n`;

  return prompt;
}

export const synthesize = task({
  id: "council-synthesize",
  run: async (payload: SynthesizePayload) => {
    const start = Date.now();
    const client = createLLMClient(payload.synthesizer);
    const prompt = buildSynthesisPrompt(payload.question, payload.allRounds);
    const result = await traceLLM(
      `council-synthesize-${payload.synthesizer}`,
      () => client.generate(prompt, SYNTHESIS_SYSTEM),
      prompt
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
  },
});
