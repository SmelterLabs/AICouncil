import crypto from "crypto";

const BASE_URL = "https://api.clickup.com/api/v2";

interface ClickUpConfig {
  apiKey: string;
  teamId: string;
}

// ── Workspace Configs ──

export function getPersonalConfig(): ClickUpConfig {
  const apiKey = process.env.CLICKUP_PERSONAL_API_KEY;
  const teamId = process.env.CLICKUP_PERSONAL_TEAM_ID;
  if (!apiKey || !teamId) throw new Error("Missing CLICKUP_PERSONAL env vars");
  return { apiKey, teamId };
}

export function getVantageBPConfig(): ClickUpConfig {
  const apiKey = process.env.CLICKUP_VANTAGEBP_API_KEY;
  const teamId = process.env.CLICKUP_VANTAGEBP_TEAM_ID;
  if (!apiKey || !teamId) throw new Error("Missing CLICKUP_VANTAGEBP env vars");
  return { apiKey, teamId };
}

// ── API Client ──

async function clickupFetch(
  config: ClickUpConfig,
  path: string,
  options: RequestInit = {}
): Promise<any> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: config.apiKey,
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ClickUp API ${response.status}: ${body}`);
  }

  return response.json();
}

// ── Task Operations ──

export async function getTask(config: ClickUpConfig, taskId: string) {
  return clickupFetch(config, `/task/${taskId}`);
}

export async function createTask(
  config: ClickUpConfig,
  listId: string,
  task: {
    name: string;
    description?: string;
    assignees?: number[];
    tags?: string[];
    status?: string;
    priority?: number;
    due_date?: number;
    due_date_time?: boolean;
  }
) {
  return clickupFetch(config, `/list/${listId}/task`, {
    method: "POST",
    body: JSON.stringify(task),
  });
}

export async function updateTaskStatus(
  config: ClickUpConfig,
  taskId: string,
  status: string
) {
  return clickupFetch(config, `/task/${taskId}`, {
    method: "PUT",
    body: JSON.stringify({ status }),
  });
}

// ── Webhook Verification ──

export function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  signature: string
): boolean {
  const hash = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(hash),
      Buffer.from(signature)
    );
  } catch {
    return false;
  }
}

// ── Webhook Registration ──

export async function createWebhook(
  config: ClickUpConfig,
  endpoint: string,
  events: string[],
  listId?: string
) {
  const body: Record<string, unknown> = { endpoint, events };
  if (listId) body.list_id = parseInt(listId);

  return clickupFetch(config, `/team/${config.teamId}/webhook`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function listWebhooks(config: ClickUpConfig) {
  return clickupFetch(config, `/team/${config.teamId}/webhook`);
}

export async function deleteWebhook(
  config: ClickUpConfig,
  webhookId: string
) {
  return clickupFetch(config, `/webhook/${webhookId}`, {
    method: "DELETE",
  });
}
