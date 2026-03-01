import { createClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";
import {
  CouncilSession,
  CouncilRound,
  SessionStatus,
  RoundRole,
  SessionWithRounds,
} from "./types";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables"
  );
}

const supabase = createClient(supabaseUrl, supabaseKey);

export async function createSession(
  question: string,
  members: string[],
  triggeredBy: string
): Promise<string> {
  const id = uuidv4();
  const { error } = await supabase.from("council_sessions").insert({
    id,
    question,
    status: "pending",
    members: JSON.stringify(members),
    triggered_by: triggeredBy,
  });
  if (error) throw new Error(`Failed to create session: ${error.message}`);
  return id;
}

export async function updateSession(
  id: string,
  updates: {
    status?: SessionStatus;
    synthesizer?: string;
    synthesis?: string;
    totalDurationMs?: number;
    discordThreadId?: string;
    error?: string;
  }
): Promise<void> {
  const updateData: Record<string, unknown> = {};
  if (updates.status !== undefined) updateData.status = updates.status;
  if (updates.synthesizer !== undefined)
    updateData.synthesizer = updates.synthesizer;
  if (updates.synthesis !== undefined) updateData.synthesis = updates.synthesis;
  if (updates.totalDurationMs !== undefined)
    updateData.total_duration_ms = updates.totalDurationMs;
  if (updates.discordThreadId !== undefined)
    updateData.discord_thread_id = updates.discordThreadId;
  if (updates.error !== undefined) updateData.error = updates.error;

  if (Object.keys(updateData).length === 0) return;

  const { error } = await supabase
    .from("council_sessions")
    .update(updateData)
    .eq("id", id);
  if (error) throw new Error(`Failed to update session: ${error.message}`);
}

export async function getSession(
  id: string
): Promise<SessionWithRounds | null> {
  const { data: session, error: sessionError } = await supabase
    .from("council_sessions")
    .select("*")
    .eq("id", id)
    .single();

  if (sessionError) {
    if (sessionError.code === "PGRST116") return null; // not found
    throw new Error(`Failed to get session: ${sessionError.message}`);
  }

  const { data: rounds, error: roundsError } = await supabase
    .from("council_rounds")
    .select("*")
    .eq("session_id", id)
    .order("round_number")
    .order("member");

  if (roundsError)
    throw new Error(`Failed to get rounds: ${roundsError.message}`);

  return {
    ...(session as CouncilSession),
    rounds: (rounds ?? []) as CouncilRound[],
  };
}

export async function listSessions(
  limit: number = 20,
  offset: number = 0,
  status?: SessionStatus
): Promise<{ sessions: CouncilSession[]; total: number }> {
  let query = supabase
    .from("council_sessions")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, count, error } = await query;
  if (error) throw new Error(`Failed to list sessions: ${error.message}`);

  return {
    sessions: (data ?? []) as CouncilSession[],
    total: count ?? 0,
  };
}

export async function insertRound(
  sessionId: string,
  roundNumber: number,
  member: string,
  role: RoundRole,
  prompt: string,
  response: string,
  modelId: string,
  durationMs: number,
  inputTokens?: number,
  outputTokens?: number
): Promise<string> {
  const id = uuidv4();
  const { error } = await supabase.from("council_rounds").insert({
    id,
    session_id: sessionId,
    round_number: roundNumber,
    member,
    role,
    prompt,
    response,
    model_id: modelId,
    duration_ms: durationMs,
    input_tokens: inputTokens ?? null,
    output_tokens: outputTokens ?? null,
  });
  if (error) throw new Error(`Failed to insert round: ${error.message}`);
  return id;
}
