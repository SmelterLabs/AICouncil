import { batch, task, tasks } from "@trigger.dev/sdk/v3";
import { insertRound, updateSession } from "../../lib/db";
import { CouncilMember } from "../../lib/types";
import { callGemini } from "./call-gemini";
import { callClaude } from "./call-claude";
import { callGrok } from "./call-grok";
import { callGpt } from "./call-gpt";
import { postDiscord } from "./post-discord";
import { synthesize } from "./synthesize";

interface OrchestratePayload {
  sessionId: string;
  question: string;
  members: CouncilMember[];
}

const DEBATE_SYSTEM = `You are participating in a structured debate with another AI. Critique honestly, concede when the other side is right, and focus on reaching the best answer. Be concise and matter of fact.`;

const TASK_MAP = {
  gemini: callGemini,
  claude: callClaude,
  grok: callGrok,
  gpt: callGpt,
} as const;

// Pick synthesizer: rotate based on session count (simple alternation)
function pickSynthesizer(members: CouncilMember[]): CouncilMember {
  return members[Date.now() % members.length];
}

export const orchestrate = task({
  id: "council-orchestrate",
  run: async (payload: OrchestratePayload) => {
    const { sessionId, question, members } = payload;
    const startTime = Date.now();
    const channelId = process.env.COUNCIL_CHANNEL_ID;

    try {
      // Update status to in_progress
      await updateSession(sessionId, { status: "in_progress" });

      // ── Round 1: Independent Answers ──
      const round1Prompt = `Question: ${question}\n\nProvide your independent answer. Be matter of fact and concise. Do not pontificate.`;

      const round1Batch = await batch.triggerByTaskAndWait(
        members.map((member) => ({
          task: TASK_MAP[member],
          payload: {
            prompt: round1Prompt,
            systemInstruction: DEBATE_SYSTEM,
          },
        }))
      );

      // Store Round 1 and collect responses
      const round1Responses: Record<string, string> = {};
      let threadId: string | undefined;

      for (let i = 0; i < members.length; i++) {
        const member = members[i];
        const result = round1Batch.runs[i];

        if (!result.ok) {
          throw new Error(
            `Round 1 failed for ${member}: ${JSON.stringify(result.error)}`
          );
        }

        round1Responses[member] = result.output.response;

        await insertRound(
          sessionId,
          1,
          member,
          "answer",
          round1Prompt,
          result.output.response,
          result.output.modelId,
          result.output.durationMs,
          result.output.inputTokens,
          result.output.outputTokens
        );

        // Post to Discord (sequential — first creates thread, rest post to it)
        if (channelId) {
          const discordResult = await tasks.triggerAndWait(
            "council-post-discord",
            {
              round: 1,
              member,
              content: result.output.response,
              sessionQuestion: question,
              channelId,
              threadId,
            }
          );

          if (discordResult.ok) {
            const discordOutput = discordResult.output as {
              threadId: string;
            };
            threadId = discordOutput.threadId;
          }
        }
      }

      // Save thread ID
      if (threadId) {
        await updateSession(sessionId, { discordThreadId: threadId });
      }

      // ── Round 2: Critique ──
      const round2Prompts: Record<string, string> = {};
      const round2Batch = await batch.triggerByTaskAndWait(
        members.map((member) => {
          const otherResponses = members
            .filter((m) => m !== member)
            .map((m) => {
              const label = m.charAt(0).toUpperCase() + m.slice(1);
              return `${label}'s answer:\n${round1Responses[m]}`;
            })
            .join("\n\n");

          const critiquePrompt = `Original question: ${question}\n\nYour Round 1 answer:\n${round1Responses[member]}\n\nOther participants' answers:\n${otherResponses}\n\nFor each other participant's answer:\n1. Identify their single strongest claim and briefly say why it's strong.\n2. Identify their single weakest claim and explain why it's wrong or unsupported.\n3. If their answer changes your position on anything, state what you'd revise and why.\n\nBe concise. No preamble.`;
          round2Prompts[member] = critiquePrompt;

          return {
            task: TASK_MAP[member],
            payload: {
              prompt: critiquePrompt,
              systemInstruction: DEBATE_SYSTEM,
            },
          };
        })
      );

      // Collect all rounds data for synthesis
      const allRoundsData: Array<{
        round: number;
        member: string;
        role: string;
        response: string;
      }> = [];

      // Add Round 1 data
      for (const member of members) {
        allRoundsData.push({
          round: 1,
          member,
          role: "answer",
          response: round1Responses[member],
        });
      }

      // Store Round 2
      for (let i = 0; i < members.length; i++) {
        const member = members[i];
        const result = round2Batch.runs[i];

        if (!result.ok) {
          throw new Error(
            `Round 2 failed for ${member}: ${JSON.stringify(result.error)}`
          );
        }

        await insertRound(
          sessionId,
          2,
          member,
          "critique",
          round2Prompts[member],
          result.output.response,
          result.output.modelId,
          result.output.durationMs,
          result.output.inputTokens,
          result.output.outputTokens
        );

        allRoundsData.push({
          round: 2,
          member,
          role: "critique",
          response: result.output.response,
        });

        // Post to Discord
        if (channelId && threadId) {
          await tasks.triggerAndWait("council-post-discord", {
            round: 2,
            member,
            content: result.output.response,
            sessionQuestion: question,
            channelId,
            threadId,
          });
        }
      }

      // ── Round 3: Synthesis ──
      const synthesizer = pickSynthesizer(members);

      const synthesisResult = await tasks.triggerAndWait(
        "council-synthesize",
        {
          question,
          allRounds: allRoundsData,
          synthesizer,
        }
      );

      if (!synthesisResult.ok) {
        throw new Error(
          `Synthesis failed: ${JSON.stringify(synthesisResult.error)}`
        );
      }

      const synthesisOutput = synthesisResult.output as {
        synthesis: string;
        modelId: string;
        durationMs: number;
        prompt: string;
        inputTokens?: number;
        outputTokens?: number;
      };

      await insertRound(
        sessionId,
        3,
        synthesizer,
        "synthesize",
        synthesisOutput.prompt,
        synthesisOutput.synthesis,
        synthesisOutput.modelId,
        synthesisOutput.durationMs,
        synthesisOutput.inputTokens,
        synthesisOutput.outputTokens
      );

      // Post synthesis to Discord
      if (channelId && threadId) {
        await tasks.triggerAndWait("council-post-discord", {
          round: 3,
          member: synthesizer,
          content: synthesisOutput.synthesis,
          sessionQuestion: question,
          channelId,
          threadId,
        });
      }

      // ── Complete ──
      const totalDurationMs = Date.now() - startTime;
      await updateSession(sessionId, {
        status: "completed",
        synthesizer,
        synthesis: synthesisOutput.synthesis,
        totalDurationMs,
      });

      return { sessionId, status: "completed", totalDurationMs };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await updateSession(sessionId, {
        status: "failed",
        error: errorMessage,
      });
      throw error;
    }
  },
});
