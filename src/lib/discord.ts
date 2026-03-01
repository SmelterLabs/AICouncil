import { CouncilMember } from "./types";

const DISCORD_API = "https://discord.com/api/v10";
const MAX_MESSAGE_LENGTH = 1950;

export function splitMessage(text: string): string[] {
  if (text.length <= MAX_MESSAGE_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > MAX_MESSAGE_LENGTH) {
    let splitAt = remaining.lastIndexOf("\n", MAX_MESSAGE_LENGTH);
    if (splitAt === -1) splitAt = remaining.lastIndexOf(" ", MAX_MESSAGE_LENGTH);
    if (splitAt === -1) splitAt = MAX_MESSAGE_LENGTH;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

async function discordFetch(
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<unknown> {
  const res = await fetch(`${DISCORD_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Discord API error ${res.status}: ${body}`);
  }

  return res.json();
}

export async function postToChannel(
  channelId: string,
  content: string,
  token: string
): Promise<string> {
  const data = (await discordFetch(`/channels/${channelId}/messages`, token, {
    method: "POST",
    body: JSON.stringify({ content }),
  })) as { id: string };
  return data.id;
}

export async function createThread(
  channelId: string,
  messageId: string,
  name: string,
  token: string
): Promise<string> {
  // Truncate thread name to Discord's 100-char limit
  const threadName = name.length > 100 ? name.slice(0, 97) + "..." : name;

  const data = (await discordFetch(
    `/channels/${channelId}/messages/${messageId}/threads`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        name: threadName,
        auto_archive_duration: 1440, // 24 hours
      }),
    }
  )) as { id: string };
  return data.id;
}

export async function postToThread(
  threadId: string,
  content: string,
  token: string
): Promise<void> {
  const chunks = splitMessage(content);
  for (const chunk of chunks) {
    await discordFetch(`/channels/${threadId}/messages`, token, {
      method: "POST",
      body: JSON.stringify({ content: chunk }),
    });
  }
}

export function getBotToken(member: CouncilMember): string {
  switch (member) {
    case "gemini":
      return process.env.GEMINI_BOT_TOKEN!;
    case "claude":
      return process.env.CLAUDE_BOT_TOKEN!;
    case "grok":
      return process.env.GROK_BOT_TOKEN!;
    case "gpt":
      return process.env.GPT_BOT_TOKEN!;
    default:
      throw new Error(`No bot token for member: ${member}`);
  }
}
