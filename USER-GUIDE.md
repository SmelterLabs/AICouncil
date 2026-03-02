# AI Council — User Guide

AI Council is a structured debate engine. Ask a question, and 4 AI models (Gemini, Claude, Grok, GPT) independently answer it, critique each other's positions, and produce a synthesized final answer.

## How to Start a Debate

### From Claude Code (any project)

```
/user:council Will AI replace software engineers?
```

This works from any Claude Code session — you don't need to be in the AI Council project.

### From Discord

Type in any channel where the ChemAI bot is active:

```
!council What's the best programming language for beginners?
```

Results appear in the `#ai-council` channel as a threaded conversation.

### From the Web UI

Visit: https://aicouncil-production-2677.up.railway.app

Type your question in the form and click "Start Debate."

### From the API (curl)

```bash
curl -X POST https://aicouncil-production-2677.up.railway.app/council \
  -H "Content-Type: application/json" \
  -d '{"question": "Your question here"}'
```

## Choosing Specific Members

By default, all 4 AIs participate. You can run a debate with only specific members:

### Claude Code

Tag members with `@` before your question:

```
/user:council @gemini @claude Is AI overhyped?
```

This runs only Gemini and Claude. No `@` tags = all 4 members.

### Web UI

Uncheck the members you don't want before clicking "Start Debate." All 4 are checked by default.

### API

Include a `members` array in the request body:

```bash
curl -X POST https://aicouncil-production-2677.up.railway.app/council \
  -H "Content-Type: application/json" \
  -d '{"question": "Your question", "members": ["gemini", "claude"]}'
```

Valid member names: `gemini`, `claude`, `grok`, `gpt`.

## What Happens During a Debate

Each debate has 3 rounds:

1. **Round 1 — Independent Answers**: All 4 AIs answer the question independently. None of them can see what the others wrote.

2. **Round 2 — Critique**: Each AI reads the other AIs' answers and critiques them. They identify the strongest and weakest claims in each response.

3. **Round 3 — Synthesis**: One AI (rotated each debate) reads everything from Rounds 1 and 2, then writes a final synthesis covering points of agreement, disagreement, and a combined answer.

A full debate typically takes 1-2 minutes.

## Viewing Results

### Discord

Each AI posts as its own bot in `#ai-council`. Round 1 creates a new thread with your question as the title. Rounds 2 and 3 appear as replies in the same thread.

### Web Frontend

After starting a debate, you get a session ID. View the full transcript at:

```
https://aicouncil-production-2677.up.railway.app/session.html?id=<sessionId>
```

The web view shows:
- All responses organized by round
- Model used for each response
- Response time per call
- Token counts (input/output) per response
- Estimated cost per response and total session cost

The page auto-refreshes while the debate is in progress.

### Browse Past Debates

Visit the web UI homepage to see a list of all past debates with their status, date, and question.

## The 4 Council Members

| Member | Model | Strengths |
|---|---|---|
| Gemini | gemini-3.1-pro-preview | Google Search grounding for real-time info |
| Claude | claude-sonnet-4-6 | Nuanced reasoning, web search |
| Grok | grok-4 | Direct style, web search |
| GPT | gpt-4o | Broad knowledge, web search |

All 4 models have web search enabled, so they can look up current information when answering.

## Cost

- **Gemini** — Free (Google AI Studio tier)
- **Claude** — ~$3/M input tokens, ~$15/M output tokens
- **Grok** — ~$3/M input tokens, ~$15/M output tokens
- **GPT** — ~$2.50/M input tokens, ~$10/M output tokens

A typical 4-member debate costs roughly $0.10–$0.30 total. Per-round costs are shown on the web frontend.

## Limitations

- **No streaming** — You see complete responses after each round finishes, not token-by-token.
- **No follow-up** — Each debate is a standalone session. You can't ask follow-up questions within the same thread.
- **Fixed 3 rounds** — The debate always runs all 3 rounds. There's no early exit if all AIs agree.
- **Discord thread names** — Truncated to 100 characters if your question is longer.
- **Token costs on web only** — Token counts and cost estimates appear on the web frontend, not in Discord messages.

## Troubleshooting

| Problem | Solution |
|---|---|
| Debate stuck on "pending" | Check `#ai-council` — it may still be running. The web page auto-refreshes every 3 seconds. |
| One AI didn't respond | If one AI fails, the debate may stop at that point. Check the web frontend for error messages. |
| "Session not found" on web | Double-check the session ID in the URL. IDs are UUIDs like `fd972e03-db56-4158-9cac-9384c91e2620`. |
| No Discord posts | The debate still runs and stores results in the database. Check the web frontend instead. |
| `/user:council` not recognized | Make sure `~/.claude/commands/council.md` exists. It's a global Claude Code command. |
