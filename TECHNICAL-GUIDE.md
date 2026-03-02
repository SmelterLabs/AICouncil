# AI Council — Technical Guide

## Quick Start

```bash
npm install              # Install dependencies
npm run dev              # Start Express API (loads .env)
npm run trigger:dev      # Start Trigger.dev worker (separate terminal)
npm run build            # TypeScript compile check
```

Both `npm run dev` AND `npm run trigger:dev` must run simultaneously during local development.

## Architecture Overview

```
REST API (Express, port 3001)
  ├── POST /council         → creates session, triggers orchestrator
  ├── GET  /council/:id     → full session with rounds
  ├── GET  /council         → paginated session list
  └── GET  /health          → uptime check
  │
  ▼
Trigger.dev Tasks
  ├── council-orchestrate   → runs full 3-round debate
  ├── council-call-gemini   → single Gemini API call
  ├── council-call-claude   → single Claude API call
  ├── council-call-grok     → single Grok API call
  ├── council-call-gpt      → single GPT API call
  ├── council-synthesize    → final synthesis round
  └── council-post-discord  → posts to Discord as bot
  │
  ▼
Supabase (Postgres)
  ├── council_sessions      → debate metadata + synthesis
  └── council_rounds        → per-round per-member responses
```

## Project Structure

```
src/
├── server.ts                           # Express API + static file server
├── lib/
│   ├── types.ts                        # Shared TypeScript types
│   ├── db.ts                           # Supabase database client
│   ├── llm-client.ts                   # Unified LLM interface + factory
│   └── discord.ts                      # Discord REST API helpers
├── trigger/
│   └── council/
│       ├── orchestrate.ts              # Full debate orchestrator
│       ├── call-gemini.ts              # Gemini LLM call task
│       ├── call-claude.ts              # Claude LLM call task
│       ├── call-grok.ts               # Grok LLM call task
│       ├── call-gpt.ts                # GPT LLM call task
│       ├── synthesize.ts               # Synthesis round task
│       └── post-discord.ts             # Discord posting task
web/
├── index.html                          # Start debate + browse history
├── session.html                        # View debate transcript
└── style.css                           # Dark theme design system
```

## Key Implementation Details

### Supabase (Postgres)

Uses Supabase free tier as a shared cloud database. Both the Express server (Railway) and Trigger.dev tasks (cloud) connect to the same Postgres instance via `@supabase/supabase-js`.

No initialization step required — the Supabase client connects on first use. All db functions in `src/lib/db.ts` are async.

Tables must be created in Supabase dashboard (or via SQL editor) before first use. See CLAUDE.md for the full schema.

### LLM Client Pattern

`src/lib/llm-client.ts` exports a unified interface:
```typescript
interface LLMClient {
  generate(prompt: string, systemInstruction: string): Promise<LLMResponse>;
}
```

Factory function `createLLMClient(member)` returns the appropriate client. Models:
- Gemini: `gemini-3.1-pro-preview` — with Google Search grounding (`googleSearch` tool, `as any` cast needed)
- Claude: `claude-sonnet-4-6` — with web search (`web_search_20250305` server tool)
- Grok: `grok-4` — xAI API via `openai` SDK with `baseURL: "https://api.x.ai/v1"`, Responses API with `web_search` tool
- GPT: `gpt-4o` — OpenAI API via `openai` SDK, Responses API with `web_search_preview` tool

All models have real-time web search always enabled. The models decide when to actually search based on the question — no manual toggling needed. Grok and GPT both use the `openai` npm package (xAI's API is OpenAI-compatible).

### Token/Cost Tracking

Each LLM call captures `input_tokens` and `output_tokens` from the SDK response, stored in `council_rounds`. Token extraction per SDK:
- Gemini: `result.response.usageMetadata.promptTokenCount` / `candidatesTokenCount`
- Claude: `message.usage.input_tokens` / `output_tokens`
- Grok/GPT: `response.usage.input_tokens` / `output_tokens` (OpenAI Responses API format)

Cost estimation is client-side only (in `web/session.html`), not stored in DB. Rates:
- Gemini: free (Google AI Studio)
- Claude Sonnet 4.6: $3/M input, $15/M output
- Grok-4: $3/M input, $15/M output
- GPT-4o: $2.50/M input, $10/M output

### Trigger.dev Task Pattern

Each LLM call is a separate task for independent retry and observability. The orchestrator uses `batch.triggerByTaskAndWait()` for parallel calls and `tasks.triggerAndWait()` for sequential calls:
- Round 1: parallel via `batch.triggerByTaskAndWait()`
- Round 2: parallel via `batch.triggerByTaskAndWait()`
- Round 3: single `tasks.triggerAndWait()` call

**Important:** Trigger.dev does NOT support `Promise.all()` around `triggerAndWait()` — it throws "Parallel waits are not supported". Always use `batch.triggerByTaskAndWait()` for parallel task execution.

The Express server uses `tasks.trigger()` (fire-and-forget) to start the orchestrator.

### Discord Integration

Each council member posts as a separate Discord bot. Round 1 creates a thread in `#ai-council`; subsequent rounds post replies to that thread.

All Discord communication uses raw `fetch` against `https://discord.com/api/v10` — no discord.js needed (tasks are short-lived, no WebSocket required).

Messages longer than 1950 chars are split at newline boundaries via `splitMessage()`.

## Environment Variables

**Local `.env`** (Express server):

| Variable | Purpose |
|---|---|
| `PORT` | Express port (default 3001) |
| `TRIGGER_SECRET_KEY` | Trigger.dev project secret key |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `GEMINI_BOT_TOKEN` | Discord bot token for Gemini |
| `CLAUDE_BOT_TOKEN` | Discord bot token for Claude |
| `GROK_BOT_TOKEN` | Discord bot token for Grok |
| `GPT_BOT_TOKEN` | Discord bot token for GPT |
| `COUNCIL_CHANNEL_ID` | Discord channel ID |

**Trigger.dev dashboard** (task runtime):

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Google Gemini API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `XAI_API_KEY` | xAI (Grok) API key |
| `OPENAI_API_KEY` | OpenAI (GPT) API key |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `GEMINI_BOT_TOKEN` | Discord bot token for Gemini |
| `CLAUDE_BOT_TOKEN` | Discord bot token for Claude |
| `GROK_BOT_TOKEN` | Discord bot token for Grok |
| `GPT_BOT_TOKEN` | Discord bot token for GPT |
| `COUNCIL_CHANNEL_ID` | Discord channel ID |

**GitHub Secrets**: `TRIGGER_ACCESS_TOKEN` (PAT for CI deploy — NOT the project secret key).

## Deployment

- **Railway** — auto-deploys Express server on push to master. Runs `npm run build` then `npm start`.
- **Trigger.dev** — GitHub Actions runs `npx trigger.dev@latest deploy` on push to master.
- Trigger.dev project ref: `proj_apzdtbbbzumcfgyqcztp`

## Database Setup

Create these tables in the Supabase SQL editor before first use:

```sql
CREATE TABLE council_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  question text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  members text NOT NULL,
  synthesizer text,
  synthesis text,
  total_duration_ms integer,
  triggered_by text NOT NULL,
  discord_thread_id text,
  error text
);

CREATE TABLE council_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES council_sessions(id),
  round_number integer NOT NULL,
  member text NOT NULL,
  role text NOT NULL,
  prompt text NOT NULL,
  response text NOT NULL,
  model_id text NOT NULL,
  duration_ms integer NOT NULL,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, round_number, member)
);

CREATE INDEX idx_rounds_session ON council_rounds(session_id);
```

## Build

Always use `npm run build` to verify TypeScript compiles — NOT `npx tsc --noEmit` (that ignores `skipLibCheck` and fails on .d.ts files).

## Triggering Debates

| Method | How |
|---|---|
| Claude Code (any project) | `/user:council <question>` — global command at `~/.claude/commands/council.md` |
| Discord | `!council <question>` via ChemAI bot |
| Web UI | Form at `https://aicouncil-production-2677.up.railway.app` |
| curl / API | `POST /council` with `{"question":"..."}` |

The `/user:council` command is a global Claude Code slash command — it works from any project, not just this one. It calls the production Railway API directly.

### Member Selection

By default all 4 members run. To run specific members only:

| Method | Syntax |
|---|---|
| Claude Code | `/user:council @gemini @claude Is AI overhyped?` |
| Web UI | Uncheck members in the form before starting |
| curl / API | `POST /council` with `{"question":"...", "members": ["gemini", "claude"]}` |
| Discord | Not yet implemented |

The backend already supports the `members` array in `POST /council`. The slash command parses `@member` tags and strips them from the question. The web UI uses checkboxes (all checked by default).

## Gotchas

- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must be set in BOTH `.env` (Express/Railway) AND Trigger.dev dashboard — both environments need database access
- Discord threads have a 100-char name limit — `createThread()` truncates automatically
- The orchestrator writes to Supabase after each round, but if a DB write fails the debate continues — the database is for history, not orchestration state
- Synthesizer rotation uses `Date.now() % members.length` — simple but non-deterministic. Fine for 2 members.
- All db functions are async — always `await` them
