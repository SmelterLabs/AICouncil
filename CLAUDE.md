# AI Council

## What This Is

A structured debate engine where multiple LLMs independently answer a question, critique each other's positions across multiple rounds, and produce a synthesized final answer highlighting agreement and dissent. Built with TypeScript, Express, Trigger.dev v4, Supabase (Postgres), and multiple LLM APIs.

**4 LLMs:** Gemini, Claude, Grok, GPT.

**Core loop:** Question → Premortem → Round 1 (independent answers) → Round 2 (mutual critique) → Round 3 (synthesis) → Final answer posted to Discord + stored in Supabase.

## Relationship to Other Projects

AI Council is a **standalone project** — it was a sibling to the ChemAI Discord Bot (**retired 2026-08-22** — the ChemAI Discord bot, its Discord application, Railway service, Trigger.dev project, and GitHub repo were all deleted; the `Discord Bot/` folder now holds only the unrelated ChemAI Web Clipper record), never embedded within it.

- **Discord trigger is RETIRED (2026-08-22)** — `!council <question>` used to live in ChemAI's bot.ts as a ~10-line thin trigger calling this project's REST API; the bot no longer exists. Slash command, web UI, and direct `curl` remain the live triggers. All debate logic lives here.
- **Council bots post results** — This project manages its own Discord bot accounts (one per LLM member) that post debate rounds directly to `#ai-council` as distinct users with separate names/avatars.
- **Shared Supabase project** — production uses `fkaawrrlhxcmzhhvgdmf`, which the older qualifier app also reads (TECHNICAL-GUIDE → Supabase). Recovery or key rotation there affects both apps.
- **Trigger.dev task per LLM call** — each LLM call is a Trigger.dev task for observability, retry handling, and logging. (This pattern was inherited from the ChemAI Discord Bot, which no longer exists to compare against.)

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

Four-round structure (premortem + 3 debate rounds). Chairman is recused from the debate. Round 2 peer review is anonymized. All members are required to web-search before answering. Each round captures self-reported calibrated confidence (0–10). After synthesis, a confidence dispersion diagnostic flags healthy debate vs groupthink.

```
Setup (synchronous, fast):
├── Pick chairman via rotation-with-recusal
│   ├── Query council_sessions for past synthesizer counts
│   ├── Pick member with lowest count (random tie-break)
│   └── For ≥3 members: chairman is recused from debate
│       For 2 members: both debate, one synthesizes (no recusal)
│       For 1 member: degenerate — that member answers and synthesizes
└── debaters = members \ {chairman}  (for ≥3-member councils)

Round 0: Premortem (parallel, private)
├── Each debater independently imagines their eventual answer is wrong
│   and lists 3 specific ways it could be wrong
├── Output is NOT shared with peers
└── Each debater's premortem folds back into THEIR OWN Round 1 prompt only

Round 1: Independent Answers (parallel)
├── Debaters answer the question independently
├── Each is required to search the web for factual claims
├── Output format is structured:
│   ANSWER: <text>
│   CONFIDENCE: <integer 0-10>
│   EVIDENCE THAT WOULD CHANGE MY ANSWER: <one item>
└── Confidence is parsed and stored per row

Round 2: Anonymized Critique (parallel, skipped if <2 debaters)
├── Each debater receives the others' Round 1 answers labeled
│   as "Response A / B / C" with a per-reviewer-randomized mapping
├── Structured critique: strongest claim, weakest claim, position update
├── Closes with: UPDATED CONFIDENCE: <integer 0-10> on Round 1 answer
└── Mappings are kept in orchestrator memory and annotated onto each
    critique when passed to the chairman, so the chairman can decode
    "Response A" references

Round 3: Chairman Synthesis (single call)
├── Chairman receives full transcript (Round 1 + Round 2)
├── Round 2 critiques include "(Note for synthesizer: <member> saw
│   peers as A=<x>, B=<y>...)" annotations so letter references resolve
├── Structured synthesis output:
│   1. What the council agrees on (high-confidence signals)
│   2. Where the council clashes (genuine disagreement, both sides)
│   3. Weakly evidenced claims (confident hallucinations flagged)
│   4. Recommendation OR explicit non-convergence flag
│   5. Confidence (0-10)
└── Chairman is explicitly told a flagged non-resolution is more useful
    than a confident wrong verdict.

Post-synthesis: Confidence Dispersion Diagnostic
├── Aggregate Round 1 and Round 2 confidences across debaters
├── Compute mean + stddev (dispersion) for each round
├── Flag:
│   🟢 Healthy: mean dropped + dispersion held/widened (doubt surfaced)
│   🔴 Groupthink: mean rose + dispersion narrowed (false convergence)
│   🟡 Mixed: one signal moved, one didn't
│   ⚪ Insufficient: <2 confidences parsed per round
└── Posted to Discord as a footer message after the synthesis.
```

**Debate framing (no personas, anti-hallucination):** Each LLM uses its natural reasoning style — cross-vendor diversity is the point, not persona overlays. The system prompt focuses on assertion discipline:

- Distinguish what you know from what you're guessing
- Mark uncertain claims as uncertain rather than inventing specifics
- Cite sources for factual claims when possible
- Say "based on my training data" rather than asserting as fact
- Be useful, not "win" — concede when peers are right

The current full system prompt is in `src/trigger/council/orchestrate.ts` as `DEBATE_SYSTEM`. The synthesizer's system prompt is separate (in `src/trigger/council/synthesize.ts` as `SYNTHESIS_SYSTEM`) and instructs the chairman to treat assertions skeptically and prefer flagging non-resolution over forcing a verdict.

**Research backing:** The premortem, anonymization, chairman recusal, structured synthesis rubric, and dispersion diagnostic come from a research review documented at `c:/Users/casey/OneDrive/AI/Obsidian/Archive/council-improvements/findings.md`. Key citations: arxiv 2510.07517 (anonymization, 96% identity-bias reduction), arxiv 2508.01545 (Big-Muddy, 99.2% peer escalation without premortem), arxiv 2505.19184 (confidence escalates 72.9% → 83% across rounds), arxiv 2410.04663 (D3 chairman pattern), Karpathy's llm-council (anonymization + designated chairman pattern).

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
│   ├── lib/
│   │   └── langfuse.ts                    # traceLLM wrapper (Langfuse SDK; no-op if LANGFUSE_SECRET_KEY unset)
│   └── council/
│       ├── orchestrate.ts                 # Full debate orchestrator (4 rounds: premortem + 3)
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
docs/
└── eval-scoring-layer.md                  # Proposal (2026-04-04, status: Idea) — debate evaluation
                                           #   scoring layer. Not built; nothing else references it.
dist/                                      # tsc build output — generated, not source
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

Optional Langfuse vars (`LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` / `LANGFUSE_BASEURL`) — see TECHNICAL-GUIDE → Langfuse Observability.

**GitHub Actions secret**: `TRIGGER_ACCESS_TOKEN` (PAT for deploy CLI)

**Two distinct Trigger.dev credentials:**
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
| `round_number` | integer NOT NULL | 0 = premortem, 1 = independent answer, 2 = critique, 3 = synthesis |
| `member` | text NOT NULL | `gemini`, `claude`, etc. |
| `role` | text NOT NULL | `premortem`, `answer`, `critique`, `synthesize` |
| `prompt` | text NOT NULL | Full prompt sent to LLM (for reproducibility) |
| `response` | text NOT NULL | The LLM's response |
| `model_id` | text NOT NULL | Exact model ID used |
| `duration_ms` | integer NOT NULL | Time for this LLM call |
| `input_tokens` | integer | Input tokens used (nullable for old rows) |
| `output_tokens` | integer | Output tokens used (nullable for old rows) |
| `confidence` | integer | Member's self-reported calibrated confidence 0–10 (added 2026-05-26; nullable if parsing failed or role doesn't request confidence) |
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

## Key Patterns

- **LLM client interface** — `llm-client.ts` exports a unified interface: `generate(prompt, systemInstruction) → response`. Each LLM has a factory function. Adding Phase 2 LLMs = adding a new case.
- **One task per LLM call** — Each invocation is a separate Trigger.dev task (`call-gemini`, `call-claude`, `call-grok`, `call-gpt`). Per-call observability, independent retry, isolated failure.
- **Orchestrator pattern** — `council-orchestrate` coordinates the full debate using `batch.triggerByTaskAndWait()` for parallel rounds (premortem, Round 1, Round 2) and `tasks.triggerAndWait()` for the single synthesis call. Sequential by round, parallel within each round.
- **No personas** — LLMs use their natural reasoning style. The system prompt focuses on assertion discipline (admit uncertainty, cite sources, mark guesses as guesses), not character overlays. Cross-vendor diversity is the diversity source.
- **Batch responses only** — No streaming. Each LLM call returns a complete response. Discord posts happen after each round completes.
- **Message splitting** — Discord caps at 2000 chars. Split long responses at newline boundaries.
- **DB writes after each round** — The orchestrator writes to Supabase after each round. If a write fails, the debate continues. The database is for history, not orchestration state.
- **Chairman selection — rotation with recusal** — At the start of each debate, the orchestrator queries past completed sessions and picks the member with the lowest synthesizer count as chairman (random tie-break). For ≥3-member councils the chairman is **recused from the debate** — they only see the debate at synthesis time. The synthesizer field is written to `council_sessions` immediately at chairman selection (not at end), so rotation counts stay clean even if synthesis fails.
- **Anonymized peer review** — Round 2 prompts label peer answers as "Response A / B / C" with a per-reviewer-randomized mapping. Mappings are kept in orchestrator memory and annotated onto each critique when passed to the chairman so the chairman can decode the letter references. Identity anonymization is from arxiv 2510.07517 (96% identity-bias reduction).
- **Premortem round** — Before Round 1, each debater independently writes 3 specific ways their eventual answer could be wrong. Output is private (not shared with peers) and folds back into that debater's own Round 1 prompt. Stored as round 0 in the DB for inspection. Klein's premortem research: doubles risks identified.
- **Forced web search on Round 1** — Round 1 prompt explicitly instructs each debater to search the web for factual claims before answering. Closes the asymmetric-grounding gap where some models would search heavily and others would answer from training data alone.
- **Calibrated confidence + dispersion diagnostic** — Round 1 and Round 2 prompts require a `CONFIDENCE: <0-10>` line. The orchestrator parses these and stores them in `council_rounds.confidence`. After synthesis, the orchestrator computes mean + stddev across debaters for both rounds and posts a 🟢/🔴/🟡/⚪ flag to Discord (healthy / groupthink / mixed / insufficient data). Confidence levels themselves are noisy (LLM-stated confidence escalates 72.9% → 83% per arxiv 2505.19184); the diagnostic watches change in mean and dispersion, not absolute levels.
- **Token/cost tracking** — Each LLM call captures `input_tokens` and `output_tokens` from the SDK response, stored in `council_rounds`. Cost estimation is client-side in the web frontend (not stored in DB).
- **Structured critique** — Round 2 prompts force each LLM to identify the single strongest and weakest claim in each opponent's anonymized answer, plus state position update + updated confidence — not vague agreement/disagreement.
- **Structured synthesis** — The chairman is prompted for a 5-section structured output: (1) what the council agrees on, (2) where the council clashes, (3) weakly evidenced claims, (4) recommendation OR explicit non-convergence flag, (5) confidence. The chairman is explicitly permitted to flag non-resolution over producing a forced verdict.

## Models

> ⚠️ **Not actively maintained.** The model IDs below were refreshed in the code on 2026-10-08 (commit 42a2ca0, "Council models to current generation"); the rest of the project is still not actively maintained. That commit is parked on Casey's call about pushing to the public repo, so it is unconfirmed whether the deployed Trigger.dev/Railway runtime uses the new models yet. `src/lib/llm-client.ts` is the source of truth for model IDs; if reviving, check the provider docs linked below.

| Member | Model ID (in the code, `src/lib/llm-client.ts`) | Notes |
|---|---|---|
| Gemini | `gemini-3.8-flash` | Google AI SDK. Google Search grounding. |
| Claude | `claude-fable-5-1` | Anthropic SDK. Web search server tool (`web_search_20260209`), `max_tokens` 16000. |
| Grok | `grok-4.7` | xAI API via `openai` SDK (`baseURL: "https://api.x.ai/v1"`). Responses API web search. |
| GPT | `gpt-6-astra` | OpenAI SDK. Responses API web search. |

All models have real-time web search enabled. Grok and GPT both use the `openai` npm package — xAI's API is OpenAI-compatible.

**If a model stops working:** Check [Google AI Studio](https://aistudio.google.com), [Anthropic docs](https://docs.anthropic.com), [xAI docs](https://docs.x.ai), or [OpenAI docs](https://platform.openai.com/docs) for current model IDs.

## Cost

- Per-model rates are not recorded here: the models changed 2026-10-08, so the old per-token rates and the ~$0.10-0.30 per-debate figure no longer apply. Check each provider's pricing page for current rates.
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

There are 3 ways to start a debate:

| Method | How |
|---|---|
| **Claude Code (any project)** | `/council <question>` — global slash command at `~/.claude/commands/council.md` |
| **Web UI** | Visit `https://aicouncil-production-2677.up.railway.app` and use the form |
| **curl / API** | `curl -X POST .../council -d '{"question":"..."}'` |

All methods hit the same `POST /council` REST endpoint. Results post to `#ai-council` on Discord and are viewable on the web frontend.

### Member Selection

By default all 4 members run. To select specific members:
- **Claude Code:** `/council @gemini @claude Is AI overhyped?` — `@member` tags are parsed and stripped from the question
- **Web UI:** Uncheck members in the form checkboxes
- **API:** Include `"members": ["gemini", "claude"]` in POST body
- **Discord:** retired 2026-08-22 — there is no Discord trigger to select members from

## Current State

- 4 LLMs: Gemini, Claude, Grok, GPT
- 4 rounds: premortem → independent → anonymized critique → chairman synthesis
- 4 Discord bot accounts in `#ai-council`
- REST API on Railway
- Supabase (Postgres) for session history
- Static web app (start debate + browse history)
- All models have web search enabled
- Token/cost tracking per round (displayed on web frontend)
- Structured critique prompt (strongest/weakest claim format)
- Default `POST /council` uses all 4 members; `members` array can override
- Member selection: `@member` syntax in slash command, checkboxes in web UI
- Global Claude Code slash command: `/council` (works from any project)

## Future Ideas

- Cost controls — per-session and daily budget limits
- Richer web app — side-by-side comparison, round navigation, cost dashboard
- Streaming for web app (not Discord)

## Known IDs

| Item | ID |
|---|---|
| #ai-council Channel | `1477745064745762928` |
| Owner (Casey) User ID | `330051108083073026` |
| Trigger.dev Project | `proj_apzdtbbbzumcfgyqcztp` |
