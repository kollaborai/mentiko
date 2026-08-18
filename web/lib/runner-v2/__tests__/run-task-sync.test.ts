/** @jest-environment node */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunRecordFile, readRunRecordAt, type RunRecord } from "@/lib/runs/run-record";
import { syncLinkedTaskFromRun } from "@/lib/runner-v2/run-task-sync";

describe("typed linked-task synchronization", () => {
  it("reads the canonical Run Record, writes summary metadata, reopens, comments, and emits", async () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-run-task-sync-"));
    const runsDir = join(root, "runs");
    const eventsDir = join(root, "events");
    mkdirSync(eventsDir, { recursive: true });
    const record: RunRecord = {
      id: "run-1",
      chain: "typed-chain",
      chainId: "chain-1",
      goal: "sync the linked task",
      started: "2026-07-15T00:00:00Z",
      completed: "2026-07-15T00:01:00Z",
      status: "completed",
      taskId: "TASK-1",
      agents: [{ id: "writer", name: "Writer", session: "writer-1", status: "complete" }],
      artifacts: [{ type: "legacy", path: "/tmp/legacy" }],
    };
    const runJsonPath = createRunRecordFile(runsDir, record).runJsonPath;
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = jest.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      calls.push({ url: String(input), init });
      if (!init.method || init.method === "GET") {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            data: { issue: { status: "in_progress", metadata: { auto_run: true } } },
          }),
        } as Response;
      }
      return { ok: true, status: 200, text: async () => "{}" } as Response;
    }) as typeof fetch;

    const result = await syncLinkedTaskFromRun(runJsonPath, "completed", {
      apiBase: "http://localhost:3200",
      namespaceId: "default",
      orgId: "default",
      eventsDir,
      fetchImpl,
    });

    expect(result).toMatchObject({ status: "updated", taskReopened: true, commentWritten: true });
    expect(calls.map((call) => call.init.method || "GET")).toEqual(["GET", "PATCH", "POST"]);
    expect(JSON.parse(String(calls[1].init.body))).toMatchObject({
      status: "open",
      metadata: {
        auto_run: true,
        last_run_id: "run-1",
        last_run_status: "completed",
        last_run_outcome: "needs_review",
      },
    });
    expect(String(calls[2].init.body)).toContain("Chain run run-1 completed");
    expect(readRunRecordAt(runsDir, "run-1")).toMatchObject({
      summary: { outcome: "needs_review" },
    });
    expect(JSON.parse(readFileSync(join(runsDir, "run-1", "artifacts", "run-summary.json"), "utf8")));
    expect(result.eventPath).toContain(eventsDir);
  });

  it("skips HTTP entirely when the canonical record has no linked task", async () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-run-task-sync-unlinked-"));
    const runJsonPath = createRunRecordFile(root, {
      id: "run-1",
      chain: "typed-chain",
      goal: "unlinked",
      started: "2026-07-15T00:00:00Z",
      status: "running",
      agents: [],
    }).runJsonPath;
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    await expect(syncLinkedTaskFromRun(runJsonPath, "running", {
      apiBase: "http://localhost:3200",
      namespaceId: "default",
      orgId: "default",
      fetchImpl,
    })).resolves.toMatchObject({ status: "skipped", reason: "run has no linked task" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    {
      generationKind: "chain_recommendation",
      status: "completed",
      expected: {
        analysis_status: "complete",
        recommendation_run_id: "run-generation",
        recommendation_chain_id: "chain-generated",
      },
    },
    {
      generationKind: "chain_generation",
      status: "stopped",
      expected: {
        generation_status: "failed",
        generated_chain_run_id: "run-generation",
        generated_chain_source_chain_id: "chain-generated",
      },
    },
  ])("preserves the legacy $generationKind audit binding", async ({ generationKind, status, expected }) => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-run-task-generation-"));
    const runJsonPath = createRunRecordFile(root, {
      id: "run-generation",
      chain: "generation-chain",
      chainId: "chain-generated",
      goal: "audit generation",
      started: "2026-07-15T00:00:00Z",
      status: "running",
      taskId: "TASK-GENERATION",
      agents: [],
      metadata: { generationKind },
    }).runJsonPath;
    const calls: Array<{ method: string; body?: string }> = [];
    const fetchImpl = jest.fn(async (_input: string | URL | Request, init: RequestInit = {}) => {
      calls.push({ method: init.method || "GET", body: init.body ? String(init.body) : undefined });
      if (!init.method || init.method === "GET") {
        return jsonResponse({ data: { issue: { status: "in_progress", metadata: { retained: true } } } });
      }
      return jsonResponse({});
    }) as typeof fetch;

    await expect(syncLinkedTaskFromRun(runJsonPath, status, taskContext(fetchImpl))).resolves.toMatchObject({
      status: "updated",
      taskId: "TASK-GENERATION",
    });
    expect(calls.map((call) => call.method)).toEqual(["GET", "PATCH"]);
    expect(JSON.parse(calls[1].body || "{}")).toEqual({
      metadata: { retained: true, ...expected },
    });
  });

  it("persists a runner-v2 blocked reason, writes a terminal receipt, and never treats it as running", async () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-run-task-blocked-"));
    const runJsonPath = createRunRecordFile(root, {
      id: "run-blocked",
      chain: "typed-chain",
      goal: "surface readiness failure",
      started: "2026-07-15T00:00:00Z",
      status: "blocked",
      blockedReason: "startup_recovery:blocked: authentication required",
      taskId: "TASK-BLOCKED",
      agents: [{ id: "writer", name: "Writer", session: "writer-run-blocked", status: "blocked", lastMessage: "authentication required" }],
    }).runJsonPath;
    const calls: Array<{ method: string; body?: string }> = [];
    const fetchImpl = jest.fn(async (_input: string | URL | Request, init: RequestInit = {}) => {
      calls.push({ method: init.method || "GET", body: init.body ? String(init.body) : undefined });
      if (!init.method || init.method === "GET") {
        return jsonResponse({ data: { issue: { status: "open", metadata: { auto_run: true } } } });
      }
      return jsonResponse({});
    }) as typeof fetch;

    const result = await syncLinkedTaskFromRun(runJsonPath, "blocked", taskContext(fetchImpl));

    expect(result).toMatchObject({ status: "updated", commentWritten: true });
    expect(calls.map((call) => call.method)).toEqual(["GET", "PATCH", "POST"]);
    expect(JSON.parse(calls[1].body || "{}")).toMatchObject({
      metadata: {
        last_run_id: "run-blocked",
        last_run_status: "blocked",
        last_run_error: "startup_recovery:blocked: authentication required",
        last_run_blocked_reason: "startup_recovery:blocked: authentication required",
      },
    });
    expect(calls[2].body).toContain("Blocked reason: startup_recovery:blocked: authentication required");
  });

  it("rejects an unsupported generation kind without mutating the task", async () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-run-task-unsupported-"));
    const runJsonPath = createRunRecordFile(root, {
      id: "run-unsupported",
      chain: "generation-chain",
      goal: "do not guess an audit contract",
      started: "2026-07-15T00:00:00Z",
      status: "running",
      taskId: "TASK-UNSUPPORTED",
      agents: [],
      metadata: { generationKind: "unknown_generation" },
    }).runJsonPath;
    const fetchImpl = jest.fn(async () => jsonResponse({
      data: { issue: { status: "open", metadata: {} } },
    })) as typeof fetch;

    await expect(syncLinkedTaskFromRun(runJsonPath, "running", taskContext(fetchImpl))).resolves.toMatchObject({
      status: "skipped",
      reason: "unsupported generation kind: unknown_generation",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps a successful task update when event emission fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-run-task-event-error-"));
    const eventsDir = join(root, "events-is-a-file");
    writeFileSync(eventsDir, "not a directory");
    const runJsonPath = createRunRecordFile(join(root, "runs"), {
      id: "run-event-error",
      chain: "typed-chain",
      goal: "preserve task update",
      started: "2026-07-15T00:00:00Z",
      status: "running",
      taskId: "TASK-EVENT-ERROR",
      agents: [],
    }).runJsonPath;
    const fetchImpl = jest.fn(async (_input: string | URL | Request, init: RequestInit = {}) => {
      if (!init.method || init.method === "GET") {
        return jsonResponse({ data: { issue: { status: "open", metadata: {} } } });
      }
      return jsonResponse({});
    }) as typeof fetch;

    const result = await syncLinkedTaskFromRun(runJsonPath, "running", {
      ...taskContext(fetchImpl),
      eventsDir,
    });

    expect(result).toMatchObject({ status: "updated", eventError: expect.any(String) });
    expect(result.eventPath).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("documents terminal comment delivery as at-least-once across replay", async () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-run-task-comment-replay-"));
    const eventsDir = join(root, "events");
    mkdirSync(eventsDir, { recursive: true });
    const runJsonPath = createRunRecordFile(join(root, "runs"), {
      id: "run-comment-replay",
      chain: "typed-chain",
      goal: "replay terminal synchronization",
      started: "2026-07-15T00:00:00Z",
      completed: "2026-07-15T00:01:00Z",
      status: "completed",
      taskId: "TASK-REPLAY",
      agents: [],
    }).runJsonPath;
    const methods: string[] = [];
    const fetchImpl = jest.fn(async (_input: string | URL | Request, init: RequestInit = {}) => {
      methods.push(init.method || "GET");
      if (!init.method || init.method === "GET") {
        return jsonResponse({ data: { issue: { status: "open", metadata: {} } } });
      }
      return jsonResponse({});
    }) as typeof fetch;
    const context = { ...taskContext(fetchImpl), eventsDir };

    await syncLinkedTaskFromRun(runJsonPath, "completed", context);
    await syncLinkedTaskFromRun(runJsonPath, "completed", context);

    expect(methods).toEqual(["GET", "PATCH", "POST", "GET", "PATCH", "POST"]);
  });
});

function taskContext(fetchImpl: typeof fetch) {
  return {
    apiBase: "http://localhost:3200",
    namespaceId: "default",
    orgId: "default",
    fetchImpl,
  };
}

function jsonResponse(value: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(value),
  } as Response;
}
