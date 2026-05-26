import { batch, task, tasks } from "@trigger.dev/sdk/v3";
import { getChairmanCounts, insertRound, updateSession } from "../../lib/db";
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

const DEBATE_SYSTEM = `You are participating in a multi-model debate. Several AI models with different training will independently answer this question, then critique each other's answers, then a chairman (a different model that did not participate in the debate) will synthesize.

Your job is to be useful, not to win. Disagree when you have reason to. Concede when you don't. The synthesis benefits more from one well-supported claim than from many assertions.

Critical: distinguish what you know from what you're guessing. If the question references something you don't have direct knowledge of — a specific file path, a user's local configuration, a repo you can't verify exists, a price you can't confirm, a recent event you can't look up — say so. Mark uncertain claims as uncertain. Do not invent specifics to sound authoritative.

When you make a factual claim, cite a source if you can. When you reason from your training, say "based on my training data" rather than asserting it as fact.

Be concise. Use plain language.`;

const TASK_MAP = {
  gemini: callGemini,
  claude: callClaude,
  grok: callGrok,
  gpt: callGpt,
} as const;

// Shuffle array (Fisher-Yates). Used to randomize per-reviewer presentation order
// in Round 2 — addresses LLM-as-judge position bias (60-75% magnitude across the literature).
function shuffleArray<T>(array: T[]): T[] {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Extract calibrated confidence (0–10) from a model response.
// Matches "CONFIDENCE: N" or "UPDATED CONFIDENCE: N" (case-insensitive).
// Returns null if no valid confidence value is present.
function parseConfidence(text: string): number | null {
  const match = text.match(/(?:UPDATED\s+)?CONFIDENCE:\s*(\d{1,2})/i);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  if (isNaN(n) || n < 0 || n > 10) return null;
  return n;
}

// Compute the confidence dispersion diagnostic. Mirrors the Hermes-Council
// design: compares pre-critique (Round 1) vs post-critique (Round 2) mean +
// dispersion across debaters. Healthy debate surfaces doubt (mean drops,
// dispersion holds or widens). Groupthink shows the opposite (mean rises,
// dispersion narrows — members anchored to a confident voice instead of
// evaluating on merit). Casey's recent failure (Gemini revising toward
// Claude's hallucinated answer) is the canonical groupthink pattern.
interface DispersionDiagnostic {
  flag: "healthy" | "mixed" | "groupthink" | "insufficient";
  emoji: string;
  description: string;
  r1Mean: number;
  r2Mean: number;
  r1Stddev: number;
  r2Stddev: number;
  r1Count: number;
  r2Count: number;
}

function computeStats(values: number[]): { mean: number; stddev: number } {
  if (values.length === 0) return { mean: 0, stddev: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return { mean, stddev: Math.sqrt(variance) };
}

function computeDispersionDiagnostic(
  r1Values: number[],
  r2Values: number[]
): DispersionDiagnostic {
  const r1 = computeStats(r1Values);
  const r2 = computeStats(r2Values);

  if (r1Values.length < 2 || r2Values.length < 2) {
    return {
      flag: "insufficient",
      emoji: "⚪",
      description:
        "Insufficient confidence data for diagnostic (need ≥2 confidence readings per round).",
      r1Mean: r1.mean,
      r2Mean: r2.mean,
      r1Stddev: r1.stddev,
      r2Stddev: r2.stddev,
      r1Count: r1Values.length,
      r2Count: r2Values.length,
    };
  }

  const meanDelta = r2.mean - r1.mean;
  const stddevDelta = r2.stddev - r1.stddev;

  // 🟢 Healthy: mean dropped + dispersion held or widened.
  if (meanDelta < -0.1 && stddevDelta >= -0.2) {
    return {
      flag: "healthy",
      emoji: "🟢",
      description:
        "Healthy debate — peer review surfaced doubt and members did not converge prematurely.",
      r1Mean: r1.mean,
      r2Mean: r2.mean,
      r1Stddev: r1.stddev,
      r2Stddev: r2.stddev,
      r1Count: r1Values.length,
      r2Count: r2Values.length,
    };
  }

  // 🔴 Groupthink warning: mean rose AND dispersion narrowed.
  if (meanDelta > 0.1 && stddevDelta < -0.3) {
    return {
      flag: "groupthink",
      emoji: "🔴",
      description:
        "Possible groupthink — confidence rose AND dispersion narrowed. Members may have anchored to a confident voice rather than evaluated on merit. Treat the verdict with extra skepticism.",
      r1Mean: r1.mean,
      r2Mean: r2.mean,
      r1Stddev: r1.stddev,
      r2Stddev: r2.stddev,
      r1Count: r1Values.length,
      r2Count: r2Values.length,
    };
  }

  // 🟡 Mixed signal
  return {
    flag: "mixed",
    emoji: "🟡",
    description:
      "Mixed signal — debate did not cleanly converge or fail. Treat the verdict with normal caution.",
    r1Mean: r1.mean,
    r2Mean: r2.mean,
    r1Stddev: r1.stddev,
    r2Stddev: r2.stddev,
    r1Count: r1Values.length,
    r2Count: r2Values.length,
  };
}

function formatDiagnosticForDiscord(d: DispersionDiagnostic): string {
  return `${d.emoji} **Debate Health Diagnostic**\n\n${d.description}\n\nRound 1 (initial): mean **${d.r1Mean.toFixed(1)}**, spread **±${d.r1Stddev.toFixed(1)}** (n=${d.r1Count})\nRound 2 (post-critique): mean **${d.r2Mean.toFixed(1)}**, spread **±${d.r2Stddev.toFixed(1)}** (n=${d.r2Count})`;
}

// Pick a chairman via rotation-with-recusal. Counts past completed sessions
// where each candidate served as synthesizer; picks the candidate with the
// lowest count to keep chairman duty evenly distributed. Random tie-breaker.
async function pickChairman(
  members: CouncilMember[]
): Promise<CouncilMember> {
  if (members.length === 1) return members[0];
  const counts = await getChairmanCounts(members);
  const minCount = Math.min(...members.map((m) => counts[m] ?? 0));
  const candidates = members.filter((m) => (counts[m] ?? 0) === minCount);
  return candidates[Math.floor(Math.random() * candidates.length)];
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

      // ── Pick chairman (rotation-with-recusal) ──
      // For ≥3 members: chairman is recused from the debate; the other members debate.
      // For 2 members: both debate; one synthesizes (no recusal possible — too few voices).
      // For 1 member: degenerate — that member answers and synthesizes themself.
      const chairman = await pickChairman(members);
      const debaters: CouncilMember[] =
        members.length >= 3 ? members.filter((m) => m !== chairman) : members;

      // Persist chairman early so the rotation counter increments cleanly even
      // if synthesis later fails. (The rotation only counts completed sessions,
      // so this is bookkeeping for observability, not for rotation correctness.)
      await updateSession(sessionId, { synthesizer: chairman });

      // ── Round 0: Premortem (private to each debater) ──
      // Each debater independently imagines their eventual answer is wrong and
      // catalogs ways it could be. Output is NOT shared with peers — it folds
      // back into that debater's own Round 1 prompt as private context.
      // Klein's research: doubles risks identified, +30% failure-identification.
      // Big-Muddy (arxiv 2508.01545): 99.2% positional-commitment escalation in
      // symmetric peer setups WITHOUT premortem.
      const premortemPrompt = `Question: ${question}\n\nBefore you write your final answer, take 60 seconds to think about how your eventual answer could be wrong. Imagine you state an answer, and a year from now you discover it was meaningfully wrong. What are 3 specific, distinct ways it could have been wrong?\n\nList them as PREMORTEM 1, PREMORTEM 2, PREMORTEM 3 — each in one sentence. Be concrete: "I might have assumed X when actually Y" rather than "I might be wrong."\n\nThis is for your private use as you formulate your real answer. No other model will see it.`;

      const premortemSystem = `You are about to participate in a multi-model debate. Before writing your answer, you are running a premortem — imagining ways your eventual answer could be wrong. This is private; it is not shared with the other models. Use it to inform your real answer with appropriate caution.`;

      const premortemBatch = await batch.triggerByTaskAndWait(
        debaters.map((member) => ({
          task: TASK_MAP[member],
          payload: {
            prompt: premortemPrompt,
            systemInstruction: premortemSystem,
          },
        }))
      );

      const premortemResponses: Record<string, string> = {};
      for (let i = 0; i < debaters.length; i++) {
        const member = debaters[i];
        const result = premortemBatch.runs[i];
        if (!result.ok) {
          // Premortem failure is non-fatal — proceed without it for that member.
          premortemResponses[member] = "";
          continue;
        }
        premortemResponses[member] = result.output.response;
        await insertRound(
          sessionId,
          0,
          member,
          "premortem",
          premortemPrompt,
          result.output.response,
          result.output.modelId,
          result.output.durationMs,
          result.output.inputTokens,
          result.output.outputTokens,
          null
        );
      }

      // ── Round 1: Debaters answer independently (with private premortem context) ──
      const buildRound1Prompt = (member: CouncilMember): string => {
        const premortemContext = premortemResponses[member]
          ? `Your private premortem (your own reflections on how you might be wrong — not shared with other models):\n${premortemResponses[member]}\n\n`
          : "";
        return `Question: ${question}\n\n${premortemContext}Before answering, search the web for any factual claims you intend to make. Do not answer from training data alone unless you have verified the question does not reference current or user-specific information.\n\nProvide your independent answer in this exact format:\n\nANSWER:\n<your answer — matter of fact, concise, no pontification>\n\nCONFIDENCE: <integer 0-10, your calibrated confidence in your answer>\n\nEVIDENCE THAT WOULD CHANGE MY ANSWER:\n<one specific piece of evidence that, if true, would shift your answer>`;
      };

      const round1Prompts: Record<string, string> = {};
      const round1Batch = await batch.triggerByTaskAndWait(
        debaters.map((member) => {
          const prompt = buildRound1Prompt(member);
          round1Prompts[member] = prompt;
          return {
            task: TASK_MAP[member],
            payload: {
              prompt,
              systemInstruction: DEBATE_SYSTEM,
            },
          };
        })
      );

      // Store Round 1 and collect responses
      const round1Responses: Record<string, string> = {};
      let threadId: string | undefined;

      for (let i = 0; i < debaters.length; i++) {
        const member = debaters[i];
        const result = round1Batch.runs[i];

        if (!result.ok) {
          throw new Error(
            `Round 1 failed for ${member}: ${JSON.stringify(result.error)}`
          );
        }

        round1Responses[member] = result.output.response;
        const round1Confidence = parseConfidence(result.output.response);

        await insertRound(
          sessionId,
          1,
          member,
          "answer",
          round1Prompts[member],
          result.output.response,
          result.output.modelId,
          result.output.durationMs,
          result.output.inputTokens,
          result.output.outputTokens,
          round1Confidence
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

      // ── Round 2: Anonymized critique with per-reviewer order randomization ──
      // Skip if only 1 debater (nothing to critique). For 2+, each reviewer sees
      // peers as Response A/B/C with a per-reviewer-randomized mapping. Identity
      // anonymization reduces sycophancy-driven belief shifts (96% IBC reduction
      // measured on prompt-level anonymization in arxiv 2510.07517).
      const round2Prompts: Record<string, string> = {};
      const round2Responses: Record<string, string> = {};
      const round2Mappings: Record<string, Record<string, string>> = {}; // reviewer -> { A: peerName, B: peerName, ... }

      if (debaters.length >= 2) {
        const round2Batch = await batch.triggerByTaskAndWait(
          debaters.map((member) => {
            const peers = debaters.filter((m) => m !== member);
            const shuffledPeers = shuffleArray(peers);
            const labels = ["A", "B", "C", "D"].slice(0, shuffledPeers.length);

            const mapping: Record<string, string> = {};
            shuffledPeers.forEach((m, idx) => {
              mapping[labels[idx]] = m;
            });
            round2Mappings[member] = mapping;

            const otherResponses = shuffledPeers
              .map(
                (m, idx) =>
                  `Response ${labels[idx]}:\n${round1Responses[m]}`
              )
              .join("\n\n");

            const critiquePrompt = `Original question: ${question}\n\nYour Round 1 answer:\n${round1Responses[member]}\n\nOther participants' answers (anonymized — model identities are hidden to reduce identity bias):\n${otherResponses}\n\nFor each other participant's answer:\n1. Identify their single strongest claim and briefly say why it's strong.\n2. Identify their single weakest claim and explain why it's wrong or unsupported.\n3. If their answer changes your position on anything, state what you'd revise and why.\n\nReference responses by their letter (e.g., "Response A's strongest claim is..."). Be concise. No preamble.\n\nAfter your critique, state your updated confidence in your Round 1 answer:\n\nUPDATED CONFIDENCE: <integer 0-10, your confidence in your Round 1 answer after seeing the others>`;
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

        for (let i = 0; i < debaters.length; i++) {
          const member = debaters[i];
          const result = round2Batch.runs[i];

          if (!result.ok) {
            throw new Error(
              `Round 2 failed for ${member}: ${JSON.stringify(result.error)}`
            );
          }

          round2Responses[member] = result.output.response;
          const round2Confidence = parseConfidence(result.output.response);

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
            result.output.outputTokens,
            round2Confidence
          );

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
      }

      // ── Round 3: Chairman synthesis ──
      // The chairman did not participate in Round 1 or Round 2. Round 2 critiques
      // reference peers as "Response A/B/C..." — we annotate each critique with
      // its per-reviewer mapping so the chairman can decode the references.
      const allRoundsData: Array<{
        round: number;
        member: string;
        role: string;
        response: string;
      }> = [];

      for (const member of debaters) {
        allRoundsData.push({
          round: 1,
          member,
          role: "answer",
          response: round1Responses[member],
        });
      }
      for (const member of debaters) {
        if (round2Responses[member]) {
          const mapping = round2Mappings[member];
          const mappingNote = mapping
            ? `(Note for synthesizer: ${member} saw peers as ${Object.entries(
                mapping
              )
                .map(([letter, name]) => `${letter}=${name}`)
                .join(", ")})`
            : "";
          const annotatedResponse = mappingNote
            ? `${mappingNote}\n${round2Responses[member]}`
            : round2Responses[member];
          allRoundsData.push({
            round: 2,
            member,
            role: "critique",
            response: annotatedResponse,
          });
        }
      }

      const synthesisResult = await tasks.triggerAndWait(
        "council-synthesize",
        {
          question,
          allRounds: allRoundsData,
          synthesizer: chairman,
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

      const synthesisConfidence = parseConfidence(synthesisOutput.synthesis);

      await insertRound(
        sessionId,
        3,
        chairman,
        "synthesize",
        synthesisOutput.prompt,
        synthesisOutput.synthesis,
        synthesisOutput.modelId,
        synthesisOutput.durationMs,
        synthesisOutput.inputTokens,
        synthesisOutput.outputTokens,
        synthesisConfidence
      );

      // Post synthesis to Discord
      if (channelId && threadId) {
        await tasks.triggerAndWait("council-post-discord", {
          round: 3,
          member: chairman,
          content: synthesisOutput.synthesis,
          sessionQuestion: question,
          channelId,
          threadId,
        });
      }

      // ── Compute and post confidence dispersion diagnostic ──
      // Healthy debate: mean confidence drops + dispersion holds/widens.
      // Groupthink warning: mean confidence rises + dispersion narrows.
      const r1Confidences: number[] = [];
      const r2Confidences: number[] = [];
      for (const member of debaters) {
        const r1c = parseConfidence(round1Responses[member]);
        if (r1c !== null) r1Confidences.push(r1c);
        if (round2Responses[member]) {
          const r2c = parseConfidence(round2Responses[member]);
          if (r2c !== null) r2Confidences.push(r2c);
        }
      }
      const diagnostic = computeDispersionDiagnostic(
        r1Confidences,
        r2Confidences
      );
      const diagnosticText = formatDiagnosticForDiscord(diagnostic);

      if (channelId && threadId) {
        await tasks.triggerAndWait("council-post-discord", {
          round: 3,
          member: chairman,
          content: diagnosticText,
          sessionQuestion: question,
          channelId,
          threadId,
        });
      }

      // ── Complete ──
      const totalDurationMs = Date.now() - startTime;
      await updateSession(sessionId, {
        status: "completed",
        synthesizer: chairman,
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
