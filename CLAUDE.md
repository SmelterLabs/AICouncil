# AI Council

## What This Is

A structured debate engine where multiple LLMs independently answer a question, critique each other's positions across multiple rounds, and produce a synthesized final answer highlighting agreement and dissent. Built with TypeScript, Express, Trigger.dev v4, Supabase (Postgres), and multiple LLM APIs.

**4 LLMs:** Gemini, Claude, Grok, GPT.

**Core loop:** Question → Round 1 (independent answers) → Round 2 (mutual critique) → Round 3 (synthesis) → Final answer posted to Discord + stored in Supabase.

## Relationship to Other Projects

AI Council is a **standalone project** — a sibling to the [ChemAI Discord Bot](../Discord%20Bot/), not embedded within it.

- **Discord Bot triggers debates** — `!council <question>` in ChemAI's bot.ts calls this project's REST API (~10 lines, thin trigger only). All debate logic lives here.
- **Council bots post results** — This project manages its own Discord bot accounts (one per LLM member) that post debate rounds directly to `#ai-council` as distinct users with separate names/avatars.
- **No shared database** — Supabase project is dedicated to this project. Completely separate from any other project's storage.
- **Same Trigger.dev patterns** — Follows the Discord Bot's task architecture: each LLM call is a Trigger.dev task for observability, retry handling, and logging.

## Architecture

```
Discord (#ai-council)
    ↑ posts results (4 bot accounts)
    │
REST API (Express, Railway)
    ├── POST /council       → starts debate
    ├── GET  /council/:id   → get session
    ├── GET  /council       → list sessions
    └── GET  /health        → uptime check
    │
    ▼
Trigger.dev Tasks (cloud)
    ├── council-orchestrate    → runs full debate flow
    ├── council-call-gemini    → single Gemini API call
    ├── council-call-claude    → single Claude API call
    ├── council-call-grok      → single Grok API call
    ├── council-call-gpt       → single GPT API call
    ├── council-synthesize     → final synthesis round
    └── council-post-discord   → posts round results to Discord
    │
    ▼
Supabase (Postgres)
    ├── council_sessions   → debate metadata + synthesis
    └── council_rounds     → per-round per-member responses
```

## Debate Flow

Fixed 3-round structure. No convergence detection. No streaming.

```
Round 1: Independent Answers
├── All 4 LLMs answer question independently
    (parallel — none see each other's response)

Round 2: Critique
├── Each LLM receives all other LLMs' Round 1 answers → critiques them
    (parallel — each sees only others' prior answers)

Round 3: Synthesis
└── One LLM (rotated) receives ALL prior rounds → produces:
    - Points of agreement
    - Points of disagreement with reasoning from each side
    - Synthesized final answer
    - Confidence assessment
```

**Debate framing (light, no personas):** Each LLM uses its natural reasoning style. The only system prompt framing is:
```
You are participating in a structured debate with another AI.
Critique honestly, concede when the other side is right, and focus on reaching the best answer.
```

No artificial personality overlays. No "you are analytical" or "you are creative." The natural differences between the LLMs are the point.

## Project Structure

```
src/
├── server.ts                              # Express REST API (main entry point)
├── lib/
│   ├── db.ts                              # Supabase database client
│   ├── llm-client.ts                      # Unified LLM interface + factory
│   ├── types.ts                           # Shared TypeScript types
│   └── discord.ts                         # Discord REST API helpers (post as bot)
├── trigger/
│   └── council/
│       ├── orchestrate.ts                 # Full debate orchestrator (3 rounds)
│       ├── call-gemini.ts                 # Single Gemini API call task
│       ├── call-claude.ts                 # Single Claude API call task
│       ├── call-grok.ts                   # Single Grok API call task
│       ├── call-gpt.ts                    # Single GPT API call task
│       ├── synthesize.ts                  # Synthesis round task
│       └── post-discord.ts               # Post round results to #ai-council
web/                                       # Static frontend
├── index.html                             # Start debate + browse history
├── session.html                           # View single debate transcript
└── style.css
trigger.config.ts                          # Trigger.dev project config
.github/workflows/deploy.yml              # Trigger.dev deploy on push to master
```

## Development

```bash
npm run dev          # Run Express API locally (tsx, loads .env)
npm run trigger:dev  # Run Trigger.dev dev server (separate terminal)
npm run build        # TypeScript compile check (tsc)
```

Both `npm run dev` AND `npm run trigger:dev` must run simultaneously during local development. The API server handles HTTP requests; the Trigger.dev worker executes LLM tasks.

Always run `npm run build` to verify — NOT `npx tsc --noEmit` (that ignores `skipLibCheck` and fails on .d.ts files).

## Deployment

Everything deploys on `git push` to `master`:
- **Railway** — auto-deploys Express server (watches master branch). Runs `npm run build` then `npm start`.
- **Trigger.dev** — GitHub Actions runs `npx trigger.dev@latest deploy` (uses `TRIGGER_ACCESS_TOKEN` secret, NOT `TRIGGER_SECRET_KEY`)

## Environment Variables

**Local `.env`** (API server process):

| Variable | Purpose |
|---|---|
| `PORT` | Express server port (default: 3001) |
| `TRIGGER_SECRET_KEY` | Trigger.dev project secret key (runtime task triggering) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side only) |
| `GEMINI_BOT_TOKEN` | Discord bot token for Gemini council member |
| `CLAUDE_BOT_TOKEN` | Discord bot token for Claude council member |
| `GROK_BOT_TOKEN` | Discord bot token for Grok council member |
| `GPT_BOT_TOKEN` | Discord bot token for GPT council member |
| `COUNCIL_CHANNEL_ID` | Discord #ai-council channel ID |

**Trigger.dev dashboard** (task runtime):

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Google Gemini API key |
| `ANTHROPIC_API_KEY` | Anthropic Claude API key |
| `XAI_API_KEY` | xAI (Grok) API key |
| `OPENAI_API_KEY` | OpenAI (GPT) API key |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `GEMINI_BOT_TOKEN` | Discord bot token for Gemini member |
| `CLAUDE_BOT_TOKEN` | Discord bot token for Claude member |
| `GROK_BOT_TOKEN` | Discord bot token for Grok member |
| `GPT_BOT_TOKEN` | Discord bot token for GPT member |
| `COUNCIL_CHANNEL_ID` | Discord #ai-council channel ID |

**GitHub Actions secret**: `TRIGGER_ACCESS_TOKEN` (PAT for deploy CLI)

**Two distinct Trigger.dev credentials (same pattern as Discord Bot):**
- `TRIGGER_SECRET_KEY` — project secret key. Goes in `.env` + Railway. Used at runtime to trigger tasks.
- `TRIGGER_ACCESS_TOKEN` — Personal Access Token. Goes in GitHub Secrets only. Used by CI deploy. Never needed at runtime.

## Database (Supabase)

Cloud Postgres via Supabase free tier. Both the Express server (Railway) and Trigger.dev tasks (cloud) connect to the same database — no filesystem sharing needed.

**Why Supabase over SQLite:** The Express server and Trigger.dev worker run in separate cloud environments (Railway vs Trigger.dev cloud). Local SQLite would only be accessible from one environment. Supabase provides a shared Postgres database both can reach.

### Tables

**`council_sessions`** — One row per debate.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid (PK) | Session ID |
| `created_at` | timestamptz | When debate started (default: now()) |
| `question` | text NOT NULL | The original question |
| `status` | text NOT NULL | `pending`, `in_progress`, `completed`, `failed` |
| `members` | text NOT NULL | JSON array of participants, e.g. `["gemini","claude"]` |
| `synthesizer` | text | Which LLM produced the synthesis (rotated) |
| `synthesis` | text | Final synthesized answer (Round 3) |
| `total_duration_ms` | integer | Wall-clock time for entire debate |
| `triggered_by` | text NOT NULL | Source: `discord`, `api`, `web` |
| `discord_thread_id` | text | Discord thread ID if results were posted |
| `error` | text | Error message if status = `failed` |

**`council_rounds`** — One row per member per round.

| Column | Type | Purpose |
|---|---|---|
| `id` | uuid (PK) | Round entry ID |
| `session_id` | uuid NOT NULL (FK) | Parent session |
| `round_number` | integer NOT NULL | 1 = independent, 2 = critique, 3 = synthesis |
| `member` | text NOT NULL | `gemini`, `claude`, etc. |
| `role` | text NOT NULL | `answer`, `critique`, `synthesize` |
| `prompt` | text NOT NULL | Full prompt sent to LLM (for reproducibility) |
| `response` | text NOT NULL | The LLM's response |
| `model_id` | text NOT NULL | Exact model ID used |
| `duration_ms` | integer NOT NULL | Time for this LLM call |
| `input_tokens` | integer | Input tokens used (nullable for old rows) |
| `output_tokens` | integer | Output tokens used (nullable for old rows) |
| `created_at` | timestamptz | When this round completed (default: now()) |

**UNIQUE constraint:** `(session_id, round_number, member)` — one response per member per round per session.

## REST API

```
POST /council
  Body: { question: string, members?: string[] }
  Returns: { sessionId: string, status: "pending" }
  Triggers the orchestrate task. Returns immediately.

GET /council/:id
  Returns: Full session with all rounds, ordered by round_number + member.

GET /council
  Query: ?limit=20&offset=0&status=completed
  Returns: Paginated session list (metadata only, no rounds).

GET /health
  Returns: { status: "ok", uptime: number }
```

## Discord Integration

### Four Bot Accounts

Each LLM council member is a separate Discord bot with its own token, username, and avatar. They post in `#ai-council` as distinct users.

| Member | Bot Name | Token Env Var |
|---|---|---|
| Gemini | Gemini (Council) | `GEMINI_BOT_TOKEN` |
| Claude | Claude (Council) | `CLAUDE_BOT_TOKEN` |
| Grok | Grok (Council) | `GROK_BOT_TOKEN` |
| GPT | GPT (Council) | `GPT_BOT_TOKEN` |

**How posting works:** The `council-post-discord` Trigger.dev task uses Discord REST API (fetch + bot token) to post as the appropriate bot. No discord.js needed — tasks are short-lived, no WebSocket required.

**Thread pattern:** Round 1 answers create a new thread in `#ai-council` with the question as title. Round 2 and synthesis post as replies in that thread.

### !council Command (in ChemAI Discord Bot)

The `!council` command lives in the existing Discord Bot's bot.ts as a thin trigger:
1. User types: `!council What's the best auth strategy?`
2. ChemAI calls `POST http://<council-api>/council` with the question
3. ChemAI replies: "Council debate started — watch #ai-council for results."
4. Council bots post the debate directly. ChemAI does not relay results.

This is ~10 lines in bot.ts. All debate logic, bot management, and posting lives in this project.

## Key Patterns

- **LLM client interface** — `llm-client.ts` exports a unified interface: `generate(prompt, systemInstruction) → response`. Each LLM has a factory function. Adding Phase 2 LLMs = adding a new case.
- **One task per LLM call** — Each invocation is a separate Trigger.dev task (`call-gemini`, `call-claude`, `call-grok`, `call-gpt`). Per-call observability, independent retry, isolated failure.
- **Orchestrator pattern** — `council-orchestrate` coordinates the full debate using `tasks.triggerAndWait()` for child tasks. Sequential by round, parallel within each round.
- **No personas** — LLMs use their natural reasoning style. Only light debate framing is injected. No character assignments.
- **Batch responses only** — No streaming. Each LLM call returns a complete response. Discord posts happen after each round completes.
- **Message splitting** — Discord caps at 2000 chars. Split long responses at newline boundaries (same pattern as Discord Bot's `splitMessage()`).
- **DB writes after each round** — The orchestrator writes to Supabase after each round. If a write fails, the debate continues. The database is for history, not orchestration state.
- **Synthesizer rotation** — Round 3 synthesizer alternates between members. Tracked in `council_sessions.synthesizer`.
- **Token/cost tracking** — Each LLM call captures `input_tokens` and `output_tokens` from the SDK response, stored in `council_rounds`. Cost estimation is client-side in the web frontend (not stored in DB).
- **Structured critique** — Round 2 prompts force each LLM to identify the single strongest and weakest claim in each opponent's answer, rather than vague agreement/disagreement.

## Models

| Member | Model ID | Notes |
|---|---|---|
| Gemini | `gemini-3.1-pro-preview` | Google AI SDK. Google Search grounding. |
| Claude | `claude-sonnet-4-6` | Anthropic SDK. Web search server tool. |
| Grok | `grok-4` | xAI API via `openai` SDK (`baseURL: "https://api.x.ai/v1"`). Responses API web search. |
| GPT | `gpt-4o` | OpenAI SDK. Responses API web search. |

All models have real-time web search enabled. Grok and GPT both use the `openai` npm package — xAI's API is OpenAI-compatible.

**If a model stops working:** Check [Google AI Studio](https://aistudio.google.com), [Anthropic docs](https://docs.anthropic.com), [xAI docs](https://docs.x.ai), or [OpenAI docs](https://platform.openai.com/docs) for current model IDs.

## Cost

- **Gemini** — Covered by Gemini Pro subscription.
- **Claude** — Anthropic API rates. Sonnet 4.6: ~$3/M input, ~$15/M output.
- **Grok** — xAI API rates. Grok 4: ~$3/M input, ~$15/M output.
- **GPT** — OpenAI API rates. GPT-4o: ~$2.50/M input, ~$10/M output.
- A typical 4-member 3-round debate costs ~$0.10-0.30 total.
- Token usage tracked per round in `council_rounds.input_tokens` / `output_tokens`. Cost estimated client-side in the web frontend.

## Conventions

- Never add `Co-Authored-By` lines to git commits
- Check before running commands that consume paid API credits
- Prefer editing existing files over creating new ones
- Always run `npm run build` to verify TypeScript compiles
- Technical docs are a blocking dependency — after every bug fix, config change, or gotcha, update `TECHNICAL-GUIDE.md` BEFORE moving to the next code task
- Keep USER-GUIDE.md current when user-facing behavior changes
- All LLM API keys go in Trigger.dev dashboard env vars, not in Railway or `.env`
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` must be set in both `.env` (local/Railway) and Trigger.dev dashboard

## Triggering Debates

There are 4 ways to start a debate:

| Method | How |
|---|---|
| **Claude Code (any project)** | `/user:council <question>` — global slash command at `~/.claude/commands/council.md` |
| **Discord** | `!council <question>` in ChemAI bot |
| **Web UI** | Visit `https://aicouncil-production-2677.up.railway.app` and use the form |
| **curl / API** | `curl -X POST .../council -d '{"question":"..."}'` |

All methods hit the same `POST /council` REST endpoint. Results post to `#ai-council` on Discord and are viewable on the web frontend.

### Member Selection

By default all 4 members run. To select specific members:
- **Claude Code:** `/user:council @gemini @claude Is AI overhyped?` — `@member` tags are parsed and stripped from the question
- **Web UI:** Uncheck members in the form checkboxes
- **API:** Include `"members": ["gemini", "claude"]` in POST body
- **Discord:** Not yet implemented

## Current State

- 4 LLMs: Gemini, Claude, Grok, GPT
- 3 rounds: independent → critique → synthesis
- 4 Discord bot accounts in `#ai-council`
- REST API on Railway
- Supabase (Postgres) for session history
- Static web app (start debate + browse history)
- All models have web search enabled
- Token/cost tracking per round (displayed on web frontend)
- Structured critique prompt (strongest/weakest claim format)
- Default `POST /council` uses all 4 members; `members` array can override
- Member selection: `@member` syntax in slash command, checkboxes in web UI
- Global Claude Code slash command: `/user:council` (works from any project)

## Future Ideas

- Cost controls — per-session and daily budget limits
- Richer web app — side-by-side comparison, round navigation, cost dashboard
- Streaming for web app (not Discord)

## Known IDs

| Item | ID |
|---|---|
| #ai-council Channel | `1477745064745762928` |
| Gemini Council Bot ID | TBD — create bot first |
| Claude Council Bot ID | TBD — create bot first |
| Owner (Casey) User ID | `330051108083073026` |
| Trigger.dev Project | `proj_apzdtbbbzumcfgyqcztp` |
| ChemAI Bot (triggers !council) | `1474788137065779241` |
