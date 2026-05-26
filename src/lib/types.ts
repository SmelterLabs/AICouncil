export type CouncilMember = "gemini" | "claude" | "grok" | "gpt";

export type SessionStatus = "pending" | "in_progress" | "completed" | "failed";

export type RoundRole = "premortem" | "answer" | "critique" | "synthesize";

export interface CouncilSession {
  id: string;
  created_at: string;
  question: string;
  status: SessionStatus;
  members: string; // JSON array, e.g. '["gemini","claude"]'
  synthesizer: string | null;
  synthesis: string | null;
  total_duration_ms: number | null;
  triggered_by: string;
  discord_thread_id: string | null;
  error: string | null;
}

export interface CouncilRound {
  id: string;
  session_id: string;
  round_number: number;
  member: string;
  role: RoundRole;
  prompt: string;
  response: string;
  model_id: string;
  duration_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  // Member's self-reported calibrated confidence (0–10) at this round.
  // Round 1: confidence in initial answer. Round 2: confidence in Round 1
  // answer post-peer-review. Round 3 (synthesis): chairman's confidence in
  // the recommendation. Null if parsing failed.
  confidence: number | null;
  created_at: string;
}

export interface CreateSessionInput {
  question: string;
  members?: CouncilMember[];
  triggeredBy: string;
}

export interface SessionWithRounds extends CouncilSession {
  rounds: CouncilRound[];
}
