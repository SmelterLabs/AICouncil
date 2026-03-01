import express from "express";
import { join } from "path";
import { tasks } from "@trigger.dev/sdk/v3";
import {
  createSession,
  getSession,
  listSessions,
} from "./lib/db";
import { CouncilMember, SessionStatus } from "./lib/types";

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());

// CORS for web frontend
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  next();
});

// Serve static web frontend
app.use(express.static(join(__dirname, "..", "web")));

// ── Health Check ──
app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// ── Start a Council Debate ──
app.post("/council", async (req, res) => {
  try {
    const { question, members, triggeredBy } = req.body;

    if (!question || typeof question !== "string" || !question.trim()) {
      res.status(400).json({ error: "question is required" });
      return;
    }

    const councilMembers: CouncilMember[] = members || ["gemini", "claude"];
    const source = triggeredBy || "api";

    const sessionId = await createSession(question.trim(), councilMembers, source);

    // Fire and forget — trigger the orchestrator
    await tasks.trigger("council-orchestrate", {
      sessionId,
      question: question.trim(),
      members: councilMembers,
    });

    res.status(201).json({ sessionId, status: "pending" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to start council debate:", message);
    res.status(500).json({ error: message });
  }
});

// ── Get a Session ──
app.get("/council/:id", async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json(session);
});

// ── List Sessions ──
app.get("/council", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const offset = parseInt(req.query.offset as string) || 0;
  const status = req.query.status as SessionStatus | undefined;

  const result = await listSessions(limit, offset, status);
  res.json(result);
});

// Start server
app.listen(PORT, () => {
  console.log(`AI Council API running on port ${PORT}`);
});
