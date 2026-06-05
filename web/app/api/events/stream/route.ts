import { NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { watch, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import config from "@/lib/config";
import { checkAuth } from "@/lib/auth/api-auth";

export const dynamic = "force-dynamic";

export const runtime = "nodejs";

interface StreamEvent {
  type: "session_status" | "event" | "run_status" | "connected" | "keepalive"
       | "agent_complete" | "chain_complete" | "job_status";
  data?: unknown;
  timestamp: string;
}

interface StreamConnection {
  id: string;
  runId: string;
  controller: ReadableStreamDefaultController;
  lastStates: Map<string, AgentState>;
  lastEvents: Set<string>;
  chainStatus: Map<string, string>;
  lastJobStatus: Map<string, string>;
}

interface AgentState {
  status: string;
  session: string;
  agent_id: string;
  emits?: string;
  started?: string;
  completed?: string;
}

const activeStreams = new Map<string, StreamConnection>();

function parseStateFile(content: string, filename: string): AgentState {
  const lines = content.split("\n").reduce((acc, line) => {
    const [key, ...rest] = line.split(":");
    if (key && rest.length > 0) {
      acc[key.trim()] = rest.join(":").trim();
    }
    return acc;
  }, {} as Record<string, string>);

  return {
    status: lines.status || "unknown",
    session: lines.session || "",
    agent_id: lines.agent_id || filename.replace(".state", ""),
    emits: lines.emits,
    started: lines.started,
    completed: lines.completed,
  };
}

function sendEvent(controller: ReadableStreamDefaultController, event: StreamEvent) {
  try {
    const data = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    controller.enqueue(new TextEncoder().encode(data));
  } catch {}
}

function setupWatchers(streamId: string): () => void {
  const stream = activeStreams.get(streamId);
  if (!stream) return () => {};

  const stateDir = config.stateDir;
  const eventsDir = config.eventsDir;
  const jobsDir = config.jobsDir;
  const runJsonPath = join(config.runsDir, stream.runId, "run.json");

  if (!existsSync(stateDir)) {
    return () => {};
  }

  // poll run.json for status changes (completed/failed)
  let lastRunStatus = "running";
  const runPollInterval = setInterval(() => {
    const current = activeStreams.get(streamId);
    if (!current) { clearInterval(runPollInterval); return; }

    try {
      if (existsSync(runJsonPath)) {
        const content = readFileSync(runJsonPath, "utf-8");
        const run = JSON.parse(content);
        if (run.status && run.status !== lastRunStatus) {
          lastRunStatus = run.status;
          sendEvent(current.controller, {
            type: run.status === "completed" || run.status === "failed" ? "chain_complete" : "run_status",
            data: { status: run.status, completed: run.completed },
            timestamp: new Date().toISOString(),
          });
        }
      }
    } catch {}
  }, 2000);

  const stateWatcher = watch(stateDir, { persistent: false }, (_eventType, filename) => {
    if (!filename || !filename.endsWith(".state")) return;

    setTimeout(() => {
      const current = activeStreams.get(streamId);
      if (!current) return;

      const filePath = join(stateDir, filename);
      if (!existsSync(filePath)) return;

      try {
        const content = readFileSync(filePath, "utf-8");
        const newState = parseStateFile(content, filename);
        const oldState = current.lastStates.get(filename);

        if (!oldState ||
            oldState.status !== newState.status ||
            oldState.session !== newState.session ||
            oldState.completed !== newState.completed) {
          current.lastStates.set(filename, newState);

          const eventType = newState.completed === "true" ? "agent_complete" : "session_status";
          sendEvent(current.controller, {
            type: eventType,
            data: { ...newState, filename },
            timestamp: new Date().toISOString(),
          });
        }
      } catch {}
    }, 100);
  });

  const eventsWatcher = watch(eventsDir, { persistent: false }, (_eventType, filename) => {
    if (!filename) return;
    if (!filename.endsWith(".event") && !filename.endsWith(".md")) return;

    setTimeout(() => {
      const current = activeStreams.get(streamId);
      if (!current) return;

      if (current.lastEvents.has(filename)) return;

interface EventFile {
  filename: string;
  event?: string;
  source?: string;
  timestamp?: string;
  processed?: boolean;
  data?: string;
}

      try {
        const filePath = join(eventsDir, filename);
        if (!existsSync(filePath)) return;

        const content = readFileSync(filePath, "utf-8");
        const lines = content.split("\n");

        const event: EventFile = { filename };
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("event:")) {
            event.event = trimmed.slice(6).trim();
          } else if (trimmed.startsWith("source:")) {
            event.source = trimmed.slice(7).trim();
          } else if (trimmed.startsWith("timestamp:")) {
            event.timestamp = trimmed.slice(10).trim();
          } else if (trimmed.startsWith("processed:")) {
            event.processed = trimmed.slice(10).trim().toLowerCase() === "true";
          } else if (trimmed.startsWith("data:")) {
            event.data = trimmed.slice(5).trim();
          }
        }

        current.lastEvents.add(filename);

        if (event.event === "chain_complete") {
          sendEvent(current.controller, {
            type: "chain_complete",
            data: event,
            timestamp: new Date().toISOString(),
          });
        }

        sendEvent(current.controller, {
          type: "event",
          data: event,
          timestamp: new Date().toISOString(),
        });
      } catch {}
    }, 100);
  });

  // watch jobs directory for status changes
  if (existsSync(jobsDir)) {
    const jobsWatcher = watch(jobsDir, { persistent: false }, (_eventType, filename) => {
      if (!filename || !filename.endsWith(".json")) return;

      setTimeout(() => {
        const current = activeStreams.get(streamId);
        if (!current) return;

        const jobId = filename.replace(".json", "");
        const jobPath = join(jobsDir, filename);
        if (!existsSync(jobPath)) return;

        try {
          const content = readFileSync(jobPath, "utf-8");
          const job = JSON.parse(content);
          const lastStatus = current.lastJobStatus.get(jobId);

          if (!lastStatus || job.status !== lastStatus) {
            current.lastJobStatus.set(jobId, job.status);
            sendEvent(current.controller, {
              type: "job_status",
              data: job,
              timestamp: new Date().toISOString(),
            });
          }
        } catch {}
      }, 100);
    });

    // extend cleanup to close jobs watcher
    return () => {
      clearInterval(runPollInterval);
      stateWatcher.close();
      eventsWatcher.close();
      jobsWatcher.close();
    };
  }

  return () => {
    clearInterval(runPollInterval);
    stateWatcher.close();
    eventsWatcher.close();
  };
}

export async function GET(request: NextRequest) {
  if (!(await checkAuth(request))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const runId = url.searchParams.get("run-id") || url.searchParams.get("job-id") || "";

  if (!runId) {
    return new Response("run-id or job-id required", { status: 400 });
  }

  const streamId = randomBytes(16).toString("hex");

  const stream = new ReadableStream({
    start(controller) {
      activeStreams.set(streamId, {
        id: streamId,
        runId,
        controller,
        lastStates: new Map(),
        lastEvents: new Set(),
        chainStatus: new Map(),
        lastJobStatus: new Map(),
      });

      const cleanup = setupWatchers(streamId);

      sendEvent(controller, {
        type: "connected",
        data: { streamId, runId },
        timestamp: new Date().toISOString(),
      });

      const keepaliveInterval = setInterval(() => {
        const current = activeStreams.get(streamId);
        if (current) {
          sendEvent(current.controller, {
            type: "keepalive",
            timestamp: new Date().toISOString(),
          });
        } else {
          clearInterval(keepaliveInterval);
        }
      }, 30000);

      request.signal.addEventListener("abort", () => {
        clearInterval(keepaliveInterval);
        cleanup();
        activeStreams.delete(streamId);
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      activeStreams.delete(streamId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
