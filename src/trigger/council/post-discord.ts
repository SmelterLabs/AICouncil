import { task } from "@trigger.dev/sdk/v3";
import {
  postToChannel,
  createThread,
  postToThread,
  getBotToken,
  splitMessage,
} from "../../lib/discord";
import { CouncilMember } from "../../lib/types";

interface PostDiscordPayload {
  round: number;
  member: CouncilMember;
  content: string;
  sessionQuestion: string;
  channelId: string;
  threadId?: string;
}

export const postDiscord = task({
  id: "council-post-discord",
  run: async (payload: PostDiscordPayload) => {
    const token = getBotToken(payload.member);
    const label = payload.member.charAt(0).toUpperCase() + payload.member.slice(1);

    if (!payload.threadId) {
      // Round 1, first post: create the thread
      const headerContent = `**Council Debate**\n> ${payload.sessionQuestion}`;
      const messageId = await postToChannel(
        payload.channelId,
        headerContent,
        token
      );

      const threadId = await createThread(
        payload.channelId,
        messageId,
        `Council: ${payload.sessionQuestion}`,
        token
      );

      // Post this member's Round 1 answer in the thread
      const roundContent = `**Round ${payload.round} — ${label}**\n\n${payload.content}`;
      await postToThread(threadId, roundContent, token);

      return { threadId };
    }

    // Subsequent rounds: post to existing thread
    const roleLabel =
      payload.round === 2
        ? "Critique"
        : payload.round === 3
          ? "Synthesis"
          : "Response";
    const roundContent = `**Round ${payload.round} — ${label} (${roleLabel})**\n\n${payload.content}`;
    await postToThread(payload.threadId, roundContent, token);

    return { threadId: payload.threadId };
  },
});
