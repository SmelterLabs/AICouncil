import express from "express";
import { join } from "path";
import { tasks } from "@trigger.dev/sdk/v3";
import {
  createSession,
  getSession,
  listSessions,
} from "./lib/db";
import { CouncilMember, SessionStatus } from "./lib/types";
import { verifyWebhookSignature } from "./lib/clickup";

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware — verify callback captures raw body for webhook signature verification
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);

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

    const councilMembers: CouncilMember[] = members || ["gemini", "claude", "grok", "gpt"];
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

// ── ClickUp Webhooks ──

app.post("/webhooks/clickup/vantagebp", async (req: any, res) => {
  try {
    const signature = req.headers["x-signature"] as string;
    const secret = process.env.CLICKUP_VANTAGEBP_WEBHOOK_SECRET;

    if (secret && signature) {
      if (!verifyWebhookSignature(secret, req.rawBody, signature)) {
        res.status(401).json({ error: "Invalid signature" });
        return;
      }
    }

    const { event, task_id } = req.body;

    if (event === "taskCreated" && task_id) {
      await tasks.trigger("clickup-mirror-task", {
        vantagebpTaskId: task_id,
      });
      console.log(`Triggered mirror for VBP task ${task_id}`);
    }

    res.status(200).json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("VantageBP webhook error:", message);
    res.status(500).json({ error: message });
  }
});

app.post("/webhooks/clickup/personal", async (req: any, res) => {
  try {
    const signature = req.headers["x-signature"] as string;
    const secret = process.env.CLICKUP_PERSONAL_WEBHOOK_SECRET;

    if (secret && signature) {
      if (!verifyWebhookSignature(secret, req.rawBody, signature)) {
        res.status(401).json({ error: "Invalid signature" });
        return;
      }
    }

    const { event, task_id, history_items } = req.body;

    if (event === "taskStatusUpdated" && task_id && history_items?.length) {
      // Check if status changed to closed (completed)
      const statusChange = history_items.find(
        (item: any) =>
          item.field === "status" &&
          item.after?.type === "closed" &&
          item.before?.status !== null // Ignore initial creation status
      );

      if (statusChange) {
        await tasks.trigger("clickup-complete-sync", {
          personalTaskId: task_id,
        });
        console.log(`Triggered completion sync for personal task ${task_id}`);
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Personal webhook error:", message);
    res.status(500).json({ error: message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`AI Council API running on port ${PORT}`);
});
