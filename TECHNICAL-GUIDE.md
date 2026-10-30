# AI Council — Technical Guide

> ⚠️ **Not actively maintained.** The model IDs below were refreshed in the code on 2026-10-08 (commit 42a2ca0, "Council models to current generation"); the rest of the project is still not actively maintained. That commit is parked on Casey's call about pushing to the public repo, so it is unconfirmed whether the deployed Trigger.dev/Railway runtime uses the new models yet. `src/lib/llm-client.ts` is the source of truth for model IDs; per-model rates are not recorded here.

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
  ├── council-orchestrate   → runs full 4-round debate (premortem → answers → anonymized critique → chairman synthesis)
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
│   ├── lib/
│   │   └── langfuse.ts                 # traceLLM wrapper (Langfuse SDK — trace + generation)
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
trigger.config.ts                         # Trigger.dev config (telemetry, dirs, maxDuration)
```

## Key Implementation Details

### Supabase (Postgres)

Uses Supabase free tier as a shared cloud database. Both the Express server (Railway) and Trigger.dev tasks (cloud) connect to the same Postgres instance via `@supabase/supabase-js`.

Production is the personal Russell organization's project `fkaawrrlhxcmzhhvgdmf` (provider display name: UNICOM Target Qualifier), also consumed by the older qualifier app. Do not confuse it with the separate active UTQ project `djbipzfrrgxerpcvwvoz`. The canonical modern service-role key is BWS AI Keys `SUPABASE_SECRET_KEY_AICOUNCIL`, record `06b3be08-bd55-44c2-b4c5-b4f100228101`; inject it as `SUPABASE_SERVICE_ROLE_KEY` in Railway, Trigger prod and local `.env`. Never substitute a JWT-signing rotation for this modern API key.

A paused free project can lose DNS and report an empty key list. With explicit restoration authority, verify ownership/free plan and supported restore versions before the provider's paused-project resume; never recreate/migrate the database as a recovery shortcut. Verify existing sessions via `GET /council?limit=1` and `GET /council/:id`, not the shallow `/health`. New `POST /council` debates incur model usage and Discord posts, so are not a free smoke test. Recovery evidence and exact deployed commit are in `journal/2026-10-27-database-recovery.md`.

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
- Gemini: `gemini-4-argon` (since 2026-10-30) — uses `@google/genai` SDK (v1.x) with Google Search grounding (`googleSearch` tool). Gemini 4 Argon is Google's flagship stable reasoning model (October 2026), matching the flagship tier of the other members. It is paid-tier only (no free tier): $2/$10 per 1M input/output through 2026-11-30, then $4/$20.
- Claude: `claude-fable-5-1` — `max_tokens` 16000, with web search (`web_search_20260209` server tool)
- Grok: `grok-4.7` — xAI API via `openai` SDK with `baseURL: "https://api.x.ai/v1"`, Responses API with `web_search` tool
- GPT: `gpt-6-astra` — OpenAI API via `openai` SDK, Responses API with `web_search_preview` tool

(These are the IDs in the code as of 2026-10-08, commit 42a2ca0; see the banner at the top for the deployment caveat.)

All models have real-time web search always enabled. The models decide when to actually search based on the question — no manual toggling needed. Grok and GPT both use the `openai` npm package (xAI's API is OpenAI-compatible).

### Token/Cost Tracking

Each LLM call captures `input_tokens` and `output_tokens` from the SDK response, stored in `council_rounds`. Token extraction per SDK:
- Gemini: `result.usageMetadata.promptTokenCount` / `candidatesTokenCount`
- Claude: `message.usage.input_tokens` / `output_tokens`
- Grok/GPT: `response.usage.input_tokens` / `output_tokens` (OpenAI Responses API format)

Cost estimation is client-side only (in `web/session.html`), not stored in DB. Per-model rates are not recorded in this guide (the models changed 2026-10-08); read them from `web/session.html` or the providers' pricing pages.

### Langfuse Observability

LLM calls are traced to Langfuse using the **Langfuse JS SDK directly** (`langfuse` npm package). This creates clean, LLM-focused traces without the noise from Trigger.dev internal spans.

**Previous approach (failed):** Used `@opentelemetry/api` with a custom filtered `OTLPTraceExporter` to pipe spans to Langfuse's OTEL endpoint. This didn't work — the filter relied on `instrumentationLibrary.name` which newer OTEL SDK versions renamed to `instrumentationScope`, causing all Trigger.dev internal spans ("Attempt 1" heartbeats, polling, etc.) to flood Langfuse with 465+ noisy traces.

**Current approach:**
- `src/trigger/lib/langfuse.ts` exports `traceLLM(name, fn, input?)` — creates a Langfuse trace + generation directly via the SDK with model, tokens, input, and output.
- All 5 LLM task files pass the prompt text to `traceLLM()`.
- Each call creates exactly one trace with one generation — no noise.
- `flushAsync()` is called after each generation to ensure data reaches Langfuse before the task returns.
- Input/output are capped at 10,000 chars to avoid oversized payloads.
- `trigger.config.ts` still configures `AnthropicInstrumentation` and `OpenAIInstrumentation` for Trigger.dev's own dashboard — these are independent of Langfuse.

Langfuse is optional — if `LANGFUSE_SECRET_KEY` is not set, `traceLLM()` is a no-op wrapper.

#### Querying AICouncil traces from CC (access reference)

AICouncil is the **only** Casey-owned service whose traces live on Langfuse **Cloud** (`us.cloud.langfuse.com`). Langfuse production (`hb-lf-stage`) now runs on Forge at `http://192.168.1.184:3000` (Tailnet `100.79.242.61:3000`); the former `bigbox:3000` compatibility forward is retired. AICouncil remains on Cloud because Trigger.dev's managed-cloud workers cannot reach the private self-hosted endpoint. (Migration to self-hosted was scoped + rejected 2026-05-26 — it would need a public exposure layer with ongoing TLS/auth upkeep. If AICouncil compute ever moves off Trigger.dev managed cloud, revisit.)

CC-side query keys live in **Bitwarden Secrets Manager** (separate from the Trigger.dev-dashboard runtime keys above): `LANGFUSE_PUBLIC_KEY_AICOUNCIL` (`pk-lf-...`) + `LANGFUSE_SECRET_KEY_AICOUNCIL` (`sk-lf-...`), added 2026-05-26 by pulling via `npx trigger.dev@latest env get`. Host is hardcoded `https://us.cloud.langfuse.com`.

```powershell
$env:BWS_ACCESS_TOKEN = (Get-Content C:\Users\casey\.bws_pc_token -Raw).Trim()
$HELPER = "C:\Users\casey\.claude\skills\bitwarden-api-keys\scripts\get-id-by-name.ps1"
$PUB = (& bws secret get (& $HELPER -KeyName LANGFUSE_PUBLIC_KEY_AICOUNCIL) --output json | ConvertFrom-Json).value
$SEC = (& bws secret get (& $HELPER -KeyName LANGFUSE_SECRET_KEY_AICOUNCIL) --output json | ConvertFrom-Json).value
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${PUB}:${SEC}"))
$headers = @{ Authorization = "Basic $b64" }
Invoke-RestMethod -Uri "https://us.cloud.langfuse.com/api/public/traces?limit=50" -Headers $headers
```

(`jq` isn't on PC bash — use PowerShell for JSON.)

**Trace naming:** each LLM call is its own trace, `sessionId` is null. Names: `council-gemini` / `council-claude` / `council-grok` / `council-gpt` (premortem / R1 / R2 — round inferred by timestamp order) and `council-synthesize-<member>` (R3 synthesis; member = chairman). A standard 4-member debate = 10 traces (3 premortem + 3 R1 + 3 R2 + 1 synthesis; chairman recused from premortem/R1/R2). To map a debate → chairman + status, query the `council_sessions` row: `GET https://aicouncil-production-2677.up.railway.app/council/<sessionId>` (more reliable than parsing trace names). Note: no Langfuse MCP is configured on this machine — query through the `langfuse` skill (CLI) or the REST call above. AICouncil is on **Langfuse Cloud**; Langfuse production (`hb-lf-stage`) runs on Forge at `:3000`; the former `bigbox:3000` compatibility forward was retired 2026-10-17 and is not a fallback endpoint.

### Trigger.dev Task Pattern

Each LLM call is a separate task for independent retry and observability. The orchestrator uses `batch.triggerByTaskAndWait()` for parallel calls and `tasks.triggerAndWait()` for sequential calls:
- Round 0 (private premortem): parallel via `batch.triggerByTaskAndWait()`
- Round 1 (independent answers): parallel via `batch.triggerByTaskAndWait()`
- Round 2 (anonymized critique): parallel via `batch.triggerByTaskAndWait()`
- Round 3 (chairman synthesis — chairman recused from Rounds 0–2 in ≥3-member councils): single `tasks.triggerAndWait()` call

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

**Langfuse vars** (Trigger.dev dashboard only — only tasks use Langfuse):

| Variable | Purpose |
|---|---|
| `LANGFUSE_PUBLIC_KEY` | Langfuse project public key |
| `LANGFUSE_SECRET_KEY` | Langfuse project secret key |
| `LANGFUSE_BASEURL` | `https://us.cloud.langfuse.com` (also accepts `LANGFUSE_BASE_URL`) |

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
  confidence integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, round_number, member)
);

CREATE INDEX idx_rounds_session ON council_rounds(session_id);
```

### Migration for existing databases (added 2026-05-26)

If `council_rounds` pre-dates 2026-05-26, run:

```sql
-- Adds the confidence column used by Round 1, Round 2, and Round 3 (synthesis)
-- to store member-reported calibrated confidence (0–10) per row. Nullable
-- because older rows pre-date the column and because parsing can fail.
ALTER TABLE council_rounds ADD COLUMN IF NOT EXISTS confidence integer;
```

Applied to production (a 2026-06-05 session stores confidence values). Only relevant when restoring a database created before 2026-05-26; non-destructive, existing rows keep NULL.

## Build

Always use `npm run build` to verify TypeScript compiles — NOT `npx tsc --noEmit` (that ignores `skipLibCheck` and fails on .d.ts files).

## Triggering Debates

| Method | How |
|---|---|
| Claude Code (any project) | `/council <question>` — global command at `~/.claude/commands/council.md` |
| Discord | ~~`!council <question>` via ChemAI bot~~ — **retired 2026-08-22** (the bot and its Discord application were deleted) |
| Web UI | Form at `https://aicouncil-production-2677.up.railway.app` |
| curl / API | `POST /council` with `{"question":"..."}` |

The `/council` command is a global Claude Code slash command — it works from any project, not just this one. It calls the production Railway API directly.

### Member Selection

By default all 4 members run. To run specific members only:

| Method | Syntax |
|---|---|
| Claude Code | `/council @gemini @claude Is AI overhyped?` |
| Web UI | Uncheck members in the form before starting |
| curl / API | `POST /council` with `{"question":"...", "members": ["gemini", "claude"]}` |
| Discord | Retired 2026-08-22 — no Discord trigger exists |

The backend already supports the `members` array in `POST /council`. The slash command parses `@member` tags and strips them from the question. The web UI uses checkboxes (all checked by default).

## Gotchas

- **Gemini SDK**: Uses `@google/genai` (v1.x), NOT the legacy `@google/generative-ai` (v0.x). New SDK API: `ai.models.generateContent({ model, contents, config: { systemInstruction, tools } })`, response text via `result.text` (property, not method). **Important:** The new SDK defaults to 5 retry attempts with exponential backoff on 503s — configure `httpOptions: { timeout, retryOptions: { attempts: 2 } }` to avoid burning through the Trigger.dev maxDuration on transient 503 errors.
- **Gemini model**: The code uses `gemini-3.1-pro-preview` again (since 2026-10-08, commit 42a2ca0). It was earlier switched to `gemini-2.5-pro` (GA) because the 3.1 preview had extended 503 outages (24+ hours) in March 2026. Preview models can be unreliable for production, so the retry-limit setting above (`retryOptions: { attempts: 2 }`) still matters; if 503s return, fall back to a GA model.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must be set in BOTH `.env` (Express/Railway) AND Trigger.dev dashboard — both environments need database access
- Discord threads have a 100-char name limit — `createThread()` truncates automatically
- The orchestrator writes to Supabase after each round, but if a DB write fails the debate continues — the database is for history, not orchestration state
- Synthesizer rotation (pre-2026-05-26): the original implementation used `Date.now() % members.length` — effectively random. Replaced 2026-05-26 by rotation-with-recusal (lowest past synthesizer count wins; chairman recused from debating in ≥3-member councils). See CLAUDE.md → Key Patterns.
- All db functions are async — always `await` them
