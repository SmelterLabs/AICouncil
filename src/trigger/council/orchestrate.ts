import { task, tasks } from "@trigger.dev/sdk/v3";
import { insertRound, updateSession } from "../../lib/db";
import { CouncilMember } from "../../lib/types";

interface OrchestratePayload {
  sessionId: string;
  question: string;
  members: CouncilMember[];
}

const DEBATE_SYSTEM = `You are participating in a structured debate with another AI. Critique honestly, concede when the other side is right, and focus on reaching the best answer.`;

function getTaskId(member: CouncilMember): string {
  return `council-call-${member}`;
}

// Pick synthesizer: rotate based on session count (simple alternation)
function pickSynthesizer(members: CouncilMember[]): CouncilMember {
  // Use current time modulo member count for simple rotation
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
      const round1Prompt = `Question: ${question}\n\nProvide your independent answer to this question. Be thorough and well-reasoned.`;

      const round1Results = await Promise.all(
        members.map((member) =>
          tasks.triggerAndWait(getTaskId(member), {
            prompt: round1Prompt,
            systemInstruction: DEBATE_SYSTEM,
          })
        )
      );

      // Store Round 1 and collect responses
      const round1Responses: Record<string, string> = {};
      let threadId: string | undefined;

      for (let i = 0; i < members.length; i++) {
        const member = members[i];
        const result = round1Results[i];

        if (!result.ok) {
          throw new Error(
            `Round 1 failed for ${member}: ${JSON.stringify(result.error)}`
          );
        }

        const output = result.output as {
          response: string;
          modelId: string;
          durationMs: number;
        };
        round1Responses[member] = output.response;

        await insertRound(
          sessionId,
          1,
          member,
          "answer",
          round1Prompt,
          output.response,
          output.modelId,
          output.durationMs
        );

        // Post to Discord
        if (channelId) {
          const discordResult = await tasks.triggerAndWait(
            "council-post-discord",
            {
              round: 1,
              member,
              content: output.response,
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
      const round2Results = await Promise.all(
        members.map((member) => {
          // Each member critiques the OTHER members' responses
          const otherResponses = members
            .filter((m) => m !== member)
            .map((m) => {
              const label = m.charAt(0).toUpperCase() + m.slice(1);
              return `${label}'s answer:\n${round1Responses[m]}`;
            })
            .join("\n\n");

          const critiquePrompt = `Original question: ${question}\n\nYour Round 1 answer:\n${round1Responses[member]}\n\nOther participant(s)' answers:\n${otherResponses}\n\nCritique the other participant(s)' answers. Identify strengths and weaknesses. Where you agree, acknowledge it. Where you disagree, explain why with specific reasoning. Also reflect on whether the other answers revealed any weaknesses in your own position.`;

          return tasks.triggerAndWait(getTaskId(member), {
            prompt: critiquePrompt,
            systemInstruction: DEBATE_SYSTEM,
          });
        })
      );

      // Store Round 2
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

      for (let i = 0; i < members.length; i++) {
        const member = members[i];
        const result = round2Results[i];

        if (!result.ok) {
          throw new Error(
            `Round 2 failed for ${member}: ${JSON.stringify(result.error)}`
          );
        }

        const output = result.output as {
          response: string;
          modelId: string;
          durationMs: number;
        };

        // Build the critique prompt for storage (same as above)
        const otherResponses = members
          .filter((m) => m !== member)
          .map((m) => {
            const label = m.charAt(0).toUpperCase() + m.slice(1);
            return `${label}'s answer:\n${round1Responses[m]}`;
          })
          .join("\n\n");

        const critiquePrompt = `Original question: ${question}\n\nYour Round 1 answer:\n${round1Responses[member]}\n\nOther participant(s)' answers:\n${otherResponses}\n\nCritique the other participant(s)' answers.`;

        await insertRound(
          sessionId,
          2,
          member,
          "critique",
          critiquePrompt,
          output.response,
          output.modelId,
          output.durationMs
        );

        allRoundsData.push({
          round: 2,
          member,
          role: "critique",
          response: output.response,
        });

        // Post to Discord
        if (channelId && threadId) {
          await tasks.triggerAndWait("council-post-discord", {
            round: 2,
            member,
            content: output.response,
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
      };

      await insertRound(
        sessionId,
        3,
        synthesizer,
        "synthesize",
        synthesisOutput.prompt,
        synthesisOutput.synthesis,
        synthesisOutput.modelId,
        synthesisOutput.durationMs
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
