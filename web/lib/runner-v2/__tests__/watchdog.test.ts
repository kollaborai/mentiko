import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseRunnerEvent } from "@/lib/runner-v2/events";
import {
  assessRunForWatchdog,
  dispatchExecutableWatchdogHooks,
  runTypedWatchdogScan,
  watchdogEventId,
  watchdogExternalEffectId,
  watchdogHookDispatchKey,
  type WatchdogHookInput,
  type WatchdogSession,
  type WatchdogTransport,
} from "@/lib/runner-v2/watchdog";
import { addRunSession, type RunRecord } from "@/lib/runner-v2/run-state";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "runner-v2-watchdog-"));
}

function runRecord(
  now: Date,
  overrides: Partial<RunRecord> = {},
): RunRecord {
  return {
    id: `run-${now.getTime() - 600_000}-fixture`,
    chain: "Build Chain",
    goal: "build it",
    started: new Date(now.getTime() - 600_000).toISOString(),
    status: "running",
    sessions: [],
    agents: [],
    ...overrides,
  };
}

function writeRun(root: string, run: RunRecord): string {
  const dir = join(root, "runs", run.id);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "run.json");
  writeFileSync(path, JSON.stringify(run, null, 2));
  return path;
}

class FakeTransport implements WatchdogTransport {
  private readonly sessions = new Map<string, WatchdogSession>();
  readonly removed: string[] = [];
  listError?: Error;
  listSequence: WatchdogSession[][] = [];

  constructor(sessions: WatchdogSession[] = []) {
    for (const session of sessions) this.sessions.set(session.name, session);
  }

  async list(): Promise<WatchdogSession[]> {
    if (this.listError) throw this.listError;
    if (this.listSequence.length > 0) {
      const next = this.listSequence.shift()!;
      this.sessions.clear();
      for (const session of next) this.sessions.set(session.name, session);
    }
    return [...this.sessions.values()];
  }

  async remove(name: string): Promise<void> {
    this.removed.push(name);
    this.sessions.delete(name);
  }
}

describe("typed runner watchdog", () => {
  const now = new Date("2026-07-15T12:00:00.000Z");

  it("treats live agent and monitor PTYs as authoritative", () => {
    const run = runRecord(now, {
      agents: [{ id: "writer", name: "Writer", status: "running", session: "writer-run" }],
    });

    expect(assessRunForWatchdog(
      run,
      new Map([["writer-run", { name: "writer-run", alive: true }]]),
      now,
    )).toMatchObject({ outcome: "alive" });
    expect(assessRunForWatchdog(
      run,
      new Map([["monitor-writer-run", { name: "monitor-writer-run", alive: true }]]),
      now,
    )).toMatchObject({ outcome: "alive" });
    expect(assessRunForWatchdog(
      run,
      new Map([[`monitor-${run.id}-writer`, { name: `monitor-${run.id}-writer`, alive: true }]]),
      now,
    )).toMatchObject({ outcome: "alive" });
    expect(assessRunForWatchdog(
      run,
      new Map([["complete-writer-run-1784102236", { name: "complete-writer-run-1784102236", alive: true }]]),
      now,
    )).toMatchObject({ outcome: "alive" });
  });

  it("applies startup grace to real millisecond run ids with suffixes", () => {
    const run = runRecord(now, {
      id: `run-${now.getTime() - 5_000}-bb990ff5`,
      started: new Date(now.getTime() - 5_000).toISOString(),
      agents: [{ id: "writer", name: "Writer", status: "running", session: "not-created-yet" }],
    });

    expect(assessRunForWatchdog(run, new Map(), now)).toEqual({
      outcome: "alive",
      reason: "live-session-or-grace",
    });
  });

  it("uses the current active agent start for grace on a long-running chain", () => {
    const run = runRecord(now, {
      id: `run-${now.getTime() - 3_600_000}-bb990ff5`,
      started: new Date(now.getTime() - 3_600_000).toISOString(),
      agents: [{
        id: "reviewer",
        name: "Reviewer",
        status: "running",
        session: "reviewer-not-created-yet",
        started: new Date(now.getTime() - 5_000).toISOString(),
      }],
    });

    expect(assessRunForWatchdog(run, new Map(), now)).toEqual({
      outcome: "alive",
      reason: "live-session-or-grace",
    });
  });

  it("keeps the five-minute exited-session handoff window", () => {
    const run = runRecord(now, {
      id: `run-${now.getTime() - 226_000}-bb990ff5`,
      started: new Date(now.getTime() - 226_000).toISOString(),
      agents: [{ id: "writer", name: "Writer", status: "running", session: "writer-exited" }],
    });
    const exited = new Map([["writer-exited", { name: "writer-exited", alive: false }]]);
    expect(assessRunForWatchdog(run, exited, now)).toMatchObject({ outcome: "alive" });

    const expired = { ...run, id: `run-${now.getTime() - 301_000}-bb990ff5` };
    expect(assessRunForWatchdog(expired, exited, now)).toMatchObject({ outcome: "stalled" });
  });

  it("honors resume, recent-completion, and typed-handoff grace windows", () => {
    const resumed = runRecord(now, {
      resumedAt: new Date(now.getTime() - 30_000).toISOString(),
      agents: [{ id: "writer", name: "Writer", status: "running", session: "gone" }],
    });
    expect(assessRunForWatchdog(resumed, new Map(), now)).toEqual({ outcome: "alive", reason: "resume-grace" });

    const pending = runRecord(now, {
      agents: [
        { id: "writer", name: "Writer", status: "complete", session: "writer", completed: new Date(now.getTime() - 60_000).toISOString() },
        { id: "reviewer", name: "Reviewer", status: "pending", session: "" },
      ],
    });
    expect(assessRunForWatchdog(pending, new Map(), now)).toMatchObject({ outcome: "alive" });

    const handoff = runRecord(now, {
      runnerV2: {
        pendingHandoffs: [{
          pid: 4321,
          targetAgentIds: ["reviewer"],
          startedAt: new Date(now.getTime() - 30 * 60_000).toISOString(),
          heartbeatAt: new Date(now.getTime() - 30_000).toISOString(),
        }],
      },
      agents: [{ id: "reviewer", name: "Reviewer", status: "pending", session: "" }],
    });
    expect(assessRunForWatchdog(handoff, new Map(), now, (pid) => pid === 4321)).toEqual({
      outcome: "alive",
      reason: "typed-handoff",
    });
  });

  it("terminalizes a proven stall and emits canonical durable side effects", async () => {
    const root = tempRoot();
    const run = runRecord(now, {
      taskId: "TASK-43",
      runnerV2: {
        attempts: [{
          id: "attempt-writer",
          runId: `run-${now.getTime() - 600_000}-fixture`,
          agentId: "writer",
          phase: "instructions_submitted",
          observedPhase: "instructions_submitted",
          desiredPhase: "completed",
          capacitySlotAcquiredAt: new Date(now.getTime() - 300_000).toISOString(),
          instructionLedger: [],
          recoveryDecisionCount: 0,
          createdAt: new Date(now.getTime() - 300_000).toISOString(),
          updatedAt: new Date(now.getTime() - 300_000).toISOString(),
          transitions: [],
        }],
      },
      agents: [
        { id: "writer", name: "Writer", status: "running", session: "writer-dead" },
        { id: "reviewer", name: "Reviewer", status: "pending", session: "" },
      ],
    });
    const runPath = writeRun(root, run);
    const transport = new FakeTransport([{ name: "writer-dead", alive: false }]);
    const hookCalls: WatchdogHookInput[] = [];

    const result = await runTypedWatchdogScan({
      runsDir: join(root, "runs"),
      eventsDir: join(root, "events"),
      stateDir: join(root, "state"),
      hooksDir: join(root, "hooks"),
      namespaceId: "tenant-a",
      orgId: "team-a",
      now,
      dependencies: {
        transport,
        dispatchHooks: (input) => { hookCalls.push(input); },
      },
    });

    expect(result).toMatchObject({
      transportAvailable: true,
      scanned: 1,
      stalled: [run.id],
      externalEffectsQueued: 2,
      hookDispatches: 1,
      errors: [],
    });
    const stored = JSON.parse(readFileSync(runPath, "utf8"));
    expect(stored).toMatchObject({
      status: "stopped",
      completed: now.toISOString(),
      status_message: expect.stringContaining("watchdog"),
      agents: [
        expect.objectContaining({ id: "writer", status: "stopped" }),
        expect.objectContaining({ id: "reviewer", status: "cancelled" }),
      ],
      runnerV2: {
        watchdog: expect.objectContaining({
          status: "stalled",
          eventEmittedAt: now.toISOString(),
          externalEffectsQueuedAt: now.toISOString(),
          hooksDispatchedAt: now.toISOString(),
        }),
        attempts: [expect.objectContaining({
          id: "attempt-writer",
          capacitySlotReleasedAt: now.toISOString(),
        })],
      },
    });
    expect(transport.removed).toContain("writer-dead");

    const eventFiles = readdirSync(join(root, "events"));
    expect(eventFiles).toEqual([`${run.id}-watchdog-run-stalled.event`]);
    const event = parseRunnerEvent(readFileSync(join(root, "events", eventFiles[0]), "utf8"));
    expect(event).toMatchObject({ event: "run-stalled", source: "watchdog", runId: run.id, processed: false });
    expect(event.fields.idempotency_key).toBe(watchdogEventId(run.id, now.toISOString()));
    expect(JSON.parse(event.data)).toMatchObject({
      last_agent: "writer",
      last_agent_status: "running",
      pending_agents: ["reviewer"],
    });

    const effects = readFileSync(join(root, "state", "external-effects.jsonl"), "utf8")
      .trim().split("\n").map((line) => JSON.parse(line));
    expect(effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "task-status",
        namespaceId: "tenant-a",
        orgId: "team-a",
        operation: expect.objectContaining({ status: "stopped", taskId: "TASK-43", runId: run.id }),
      }),
      expect.objectContaining({
        type: "notification",
        operation: expect.objectContaining({ event: "chain-stalled", runId: run.id }),
      }),
    ]));
    expect(hookCalls).toEqual([expect.objectContaining({
      event: "run-stalled",
      runId: run.id,
      details: expect.objectContaining({ task_id: "TASK-43", pending_agents: "reviewer" }),
    })]);
  });

  it("does not queue task status when a run-summary generation stalls", async () => {
    const root = tempRoot();
    const run = runRecord(now, {
      taskId: "TASK-SUMMARY",
      metadata: { generationKind: "run_summary", generationJobId: "job-summary-1" },
      agents: [{ id: "summarizer", name: "Summarizer", status: "running", session: "summary-dead" }],
    });
    writeRun(root, run);

    const result = await runTypedWatchdogScan({
      runsDir: join(root, "runs"),
      eventsDir: join(root, "events"),
      stateDir: join(root, "state"),
      hooksDir: join(root, "hooks"),
      now,
      dependencies: {
        transport: new FakeTransport([{ name: "summary-dead", alive: false }]),
        dispatchHooks: () => undefined,
      },
    });

    const effects = readFileSync(join(root, "state", "external-effects.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string });
    expect(result.externalEffectsQueued).toBe(1);
    expect(effects.map((effect) => effect.type)).toEqual(["notification"]);
  });

  it("rechecks PTY state immediately before mutation", async () => {
    const root = tempRoot();
    const run = runRecord(now, {
      agents: [{ id: "writer", name: "Writer", status: "running", session: "writer-race" }],
    });
    const runPath = writeRun(root, run);
    const transport = new FakeTransport();
    transport.listSequence = [
      [],
      [{ name: "writer-race", alive: true }],
      [{ name: "writer-race", alive: true }],
    ];

    const result = await runTypedWatchdogScan({
      runsDir: join(root, "runs"),
      eventsDir: join(root, "events"),
      stateDir: join(root, "state"),
      now,
      dependencies: { transport, dispatchHooks: () => undefined },
    });

    expect(result.stalled).toEqual([]);
    expect(JSON.parse(readFileSync(runPath, "utf8")).status).toBe("running");
    expect(existsSync(join(root, "events"))).toBe(false);
  });

  it("fails closed when PTY state cannot be observed", async () => {
    const root = tempRoot();
    const run = runRecord(now, {
      agents: [{ id: "writer", name: "Writer", status: "running", session: "unknown" }],
    });
    const runPath = writeRun(root, run);
    const transport = new FakeTransport();
    transport.listError = new Error("daemon unavailable");

    const result = await runTypedWatchdogScan({
      runsDir: join(root, "runs"),
      now,
      dependencies: { transport },
    });

    expect(result.transportAvailable).toBe(false);
    expect(result.errors).toContain("pty transport unavailable: daemon unavailable");
    expect(JSON.parse(readFileSync(runPath, "utf8")).status).toBe("running");
  });

  it("reaps live agent and monitor sessions owned exclusively by terminal scoped runs", async () => {
    const root = tempRoot();
    writeRun(root, runRecord(now, {
      id: "run-done",
      status: "completed",
      agents: [{ id: "done", name: "Done", status: "complete", session: "done-agent" }],
    }));
    writeRun(root, runRecord(now, {
      id: "run-future",
      status: "pending",
      agents: [{ id: "active", name: "Active", status: "running", session: "active-agent" }],
    }));
    writeRun(root, runRecord(now, {
      id: "run-terminal-protected",
      status: "failed",
      agents: [{ id: "term", name: "Term", status: "failed", session: "term-user-owned" }],
    }));
    const transport = new FakeTransport([
      { name: "done-agent", alive: true },
      { name: "complete-done-agent-1784102007", alive: false },
      { name: "complete-done-agent-review-1784102007", alive: false },
      { name: "complete-unreferenced-agent-1784102007", alive: false },
      { name: "monitor-done-agent", alive: true },
      { name: "active-agent", alive: true },
      { name: "unreferenced-agent", alive: true },
      { name: "term-user-owned", alive: true },
    ]);

    const result = await runTypedWatchdogScan({
      runsDir: join(root, "runs"),
      now,
      dependencies: { transport },
    });

    expect(result.orphanSessionsRemoved).toEqual([
      "done-agent",
      "monitor-done-agent",
      "complete-done-agent-1784102007",
    ]);
    expect(transport.removed).toContain("done-agent");
    expect(transport.removed).toContain("monitor-done-agent");
    expect(transport.removed).not.toContain("active-agent");
    expect(transport.removed).not.toContain("unreferenced-agent");
    expect(transport.removed).not.toContain("term-user-owned");
    expect(transport.removed).not.toContain("complete-done-agent-review-1784102007");
    expect(transport.removed).not.toContain("complete-unreferenced-agent-1784102007");
  });

  it("preserves an alive session when its terminal run resumes before removal", async () => {
    const root = tempRoot();
    const runPath = writeRun(root, runRecord(now, {
      id: "run-resumed-during-cleanup",
      status: "completed",
      agents: [{ id: "writer", name: "Writer", status: "complete", session: "writer-resumed" }],
    }));
    let listCalls = 0;
    const transport: WatchdogTransport = {
      async list() {
        listCalls += 1;
        if (listCalls === 3) {
          const resumed = JSON.parse(readFileSync(runPath, "utf8"));
          resumed.status = "running";
          resumed.agents[0].status = "running";
          writeFileSync(runPath, JSON.stringify(resumed));
        }
        return [{ name: "writer-resumed", alive: true }];
      },
      async remove() {
        throw new Error("resumed session must not be removed");
      },
    };

    const result = await runTypedWatchdogScan({
      runsDir: join(root, "runs"),
      now,
      dependencies: { transport },
    });

    expect(result.orphanSessionsRemoved).toEqual([]);
    expect(result.sessionRemovalFailures).toEqual(["writer-resumed"]);
    expect(JSON.parse(readFileSync(runPath, "utf8")).status).toBe("running");
  });

  it("reaps a dead prior-agent completion PTY while a mid-chain run stays live", async () => {
    const root = tempRoot();
    const run = runRecord(now, {
      id: "run-mid-chain",
      agents: [
        { id: "writer", name: "Writer", status: "complete", session: "writer-run" },
        { id: "reviewer", name: "Reviewer", status: "running", session: "reviewer-run" },
      ],
    });
    const runPath = writeRun(root, run);
    const transport = new FakeTransport([
      { name: "complete-writer-run-1784102007", alive: false },
      { name: "reviewer-run", alive: true },
    ]);

    const result = await runTypedWatchdogScan({
      runsDir: join(root, "runs"),
      now,
      dependencies: { transport },
    });

    expect(result.stalled).toEqual([]);
    expect(result.orphanSessionsRemoved).toEqual(["complete-writer-run-1784102007"]);
    expect(transport.removed).toEqual(["complete-writer-run-1784102007"]);
    expect(JSON.parse(readFileSync(runPath, "utf8"))).toEqual(run);
  });

  it("preserves a scoped completion PTY that becomes live on the removal recheck", async () => {
    const root = tempRoot();
    writeRun(root, runRecord(now, {
      id: "run-completion-race",
      status: "completed",
      agents: [{ id: "writer", name: "Writer", status: "complete", session: "writer-race" }],
    }));
    const completion = { name: "complete-writer-race-1784102007", alive: false };
    const transport = new FakeTransport([completion]);
    transport.listSequence = [
      [completion],
      [completion],
      [{ ...completion, alive: true }],
    ];

    const result = await runTypedWatchdogScan({
      runsDir: join(root, "runs"),
      now,
      dependencies: { transport },
    });

    expect(result.orphanSessionsRemoved).toEqual([]);
    expect(result.sessionRemovalFailures).toEqual([completion.name]);
    expect(transport.removed).not.toContain(completion.name);
  });

  it("preserves a session that becomes alive on the destructive-action recheck", async () => {
    const root = tempRoot();
    const run = runRecord(now, {
      agents: [{ id: "writer", name: "Writer", status: "running", session: "writer-race" }],
    });
    const runPath = writeRun(root, run);
    const transport = new FakeTransport();
    const hookCalls: WatchdogHookInput[] = [];
    transport.listSequence = [
      [{ name: "writer-race", alive: false }],
      [{ name: "writer-race", alive: false }],
      [{ name: "writer-race", alive: true }],
    ];

    const result = await runTypedWatchdogScan({
      runsDir: join(root, "runs"),
      eventsDir: join(root, "events"),
      stateDir: join(root, "state"),
      now,
      dependencies: {
        transport,
        dispatchHooks: (input) => { hookCalls.push(input); },
      },
    });

    expect(result.stalled).toEqual([]);
    expect(result.sessionsRemoved).toEqual([]);
    expect(transport.removed).not.toContain("writer-race");
    expect(JSON.parse(readFileSync(runPath, "utf8"))).toEqual(run);
    expect(existsSync(join(root, "events"))).toBe(false);
    expect(existsSync(join(root, "state", "external-effects.jsonl"))).toBe(false);
    expect(hookCalls).toEqual([]);
  });

  it("rolls back watchdog fields while preserving a concurrent session registration", async () => {
    const root = tempRoot();
    const run = runRecord(now, {
      agents: [{ id: "writer", name: "Writer", status: "running", session: "writer-old" }],
    });
    const runPath = writeRun(root, run);
    const hookCalls: WatchdogHookInput[] = [];
    let listCall = 0;
    const transport: WatchdogTransport = {
      async list() {
        listCall += 1;
        if (listCall === 3) {
          addRunSession(
            runPath,
            "writer-reborn",
            "writer",
            "Writer",
            new Date(now.getTime() + 1),
          );
          return [{ name: "writer-reborn", alive: true }];
        }
        return [{ name: "writer-old", alive: false }];
      },
      async remove() {
        throw new Error("live session must not be removed");
      },
    };

    const result = await runTypedWatchdogScan({
      runsDir: join(root, "runs"),
      eventsDir: join(root, "events"),
      stateDir: join(root, "state"),
      now,
      dependencies: {
        transport,
        dispatchHooks: (input) => { hookCalls.push(input); },
      },
    });

    const stored = JSON.parse(readFileSync(runPath, "utf8"));
    expect(result.stalled).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(stored).toMatchObject({
      status: "running",
      sessions: ["writer-reborn"],
      agents: [expect.objectContaining({
        id: "writer",
        status: "running",
        session: "writer-reborn",
      })],
    });
    expect(stored.completed).toBeUndefined();
    expect(stored.agents[0].completed).toBeUndefined();
    expect(stored.runnerV2?.watchdog).toBeUndefined();
    expect(existsSync(join(root, "events"))).toBe(false);
    expect(existsSync(join(root, "state", "external-effects.jsonl"))).toBe(false);
    expect(hookCalls).toEqual([]);
  });

  it("keeps a hook dispatch claim until a SIGTERM-ignoring hook is dead", async () => {
    const root = tempRoot();
    const hooksDir = join(root, "watchdog-hooks");
    mkdirSync(hooksDir, { recursive: true });
    const hookPath = join(hooksDir, "ignore-term.sh");
    const pidPath = join(root, "hook.pid");
    const overlapPath = join(root, "overlap.txt");
    const startsPath = join(root, "starts.txt");
    writeFileSync(hookPath, [
      "#!/bin/bash",
      `if [[ -f "${pidPath}" ]] && kill -0 "$(cat "${pidPath}")" 2>/dev/null; then echo overlap >> "${overlapPath}"; fi`,
      `echo "$$" > "${pidPath}"`,
      `echo start >> "${startsPath}"`,
      "trap '' TERM",
      "sleep 5",
    ].join("\n") + "\n");
    chmodSync(hookPath, 0o755);
    const input: WatchdogHookInput = {
      event: "run-stalled",
      runId: "run-hook-timeout",
      idempotencyKey: "watchdog:run-hook-timeout:run-stalled:hooks:v1",
      details: {},
      hooksDir,
      stateDir: join(root, "state"),
      timeoutMs: 75,
      killGraceMs: 75,
    };

    await expect(dispatchExecutableWatchdogHooks(input)).rejects.toThrow("timed out");
    await expect(dispatchExecutableWatchdogHooks(input)).rejects.toThrow("timed out");

    expect(readFileSync(startsPath, "utf8").trim().split("\n")).toHaveLength(2);
    expect(existsSync(overlapPath)).toBe(false);
  });

  it("is idempotent after a run has been terminalized", async () => {
    const root = tempRoot();
    const run = runRecord(now, {
      agents: [{ id: "writer", name: "Writer", status: "running", session: "dead" }],
    });
    writeRun(root, run);
    const firstTransport = new FakeTransport([{ name: "dead", alive: false }]);
    const options = {
      runsDir: join(root, "runs"),
      eventsDir: join(root, "events"),
      stateDir: join(root, "state"),
      now,
      dependencies: { transport: firstTransport, dispatchHooks: () => undefined },
    };

    const first = await runTypedWatchdogScan(options);
    const second = await runTypedWatchdogScan({
      ...options,
      dependencies: { transport: new FakeTransport(), dispatchHooks: () => undefined },
    });

    expect(first.stalled).toEqual([run.id]);
    expect(second.stalled).toEqual([]);
    expect(readdirSync(join(root, "events"))).toHaveLength(1);
    expect(readFileSync(join(root, "state", "external-effects.jsonl"), "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("recovers an archived stall occurrence after emit-before-marker crash without duplicating it", async () => {
    const root = tempRoot();
    const run = runRecord(now, {
      id: "run-event-replay",
      status: "stopped",
      completed: now.toISOString(),
      runnerV2: {
        watchdog: {
          status: "stalled",
          detectedAt: now.toISOString(),
          runId: "run-event-replay",
          reason: "no live session",
          lastAgent: "writer",
          lastAgentStatus: "running",
          pendingAgents: [],
          externalEffectsQueuedAt: now.toISOString(),
          hooksDispatchedAt: now.toISOString(),
        },
      },
      agents: [{ id: "writer", name: "Writer", status: "stopped", session: "" }],
    });
    const runPath = writeRun(root, run);
    const eventsDir = join(root, "events");
    mkdirSync(eventsDir, { recursive: true });
    const canonicalPath = join(eventsDir, `${run.id}-watchdog-run-stalled.event`);
    const existingBytes = [
      "event: unrelated-event",
      "source: existing-producer",
      `run_id: ${run.id}`,
      `timestamp: ${now.toISOString()}`,
      "processed: false",
      "data: existing bytes",
      "",
    ].join("\n");
    writeFileSync(canonicalPath, existingBytes);

    const options = {
      runsDir: join(root, "runs"),
      eventsDir,
      stateDir: join(root, "state"),
      now: new Date(now.getTime() + 60_000),
      dependencies: { transport: new FakeTransport(), dispatchHooks: () => undefined },
    };
    const first = await runTypedWatchdogScan(options);
    const archiveDir = join(eventsDir, "archive");
    mkdirSync(archiveDir);
    const archivedPath = join(archiveDir, first.events[0].split("/").at(-1)!);
    renameSync(first.events[0], archivedPath);
    const storedAfterFirst = JSON.parse(readFileSync(runPath, "utf8"));
    delete storedAfterFirst.runnerV2.watchdog.eventEmittedAt;
    writeFileSync(runPath, JSON.stringify(storedAfterFirst));
    const replay = await runTypedWatchdogScan({ ...options, now: new Date(now.getTime() + 120_000) });

    expect(readFileSync(canonicalPath, "utf8")).toBe(existingBytes);
    expect(first.events).toHaveLength(1);
    expect(replay.events).toEqual([archivedPath]);
    expect(readdirSync(eventsDir).filter((name) => name.endsWith(".event"))).toEqual([
      `${run.id}-watchdog-run-stalled.event`,
    ]);
    expect(readdirSync(archiveDir).filter((name) => name.endsWith(".event"))).toHaveLength(1);
    const emitted = parseRunnerEvent(readFileSync(archivedPath, "utf8"));
    expect(emitted).toMatchObject({
      event: "run-stalled",
      source: "watchdog",
      runId: run.id,
      processed: false,
    });
    expect(emitted.fields.idempotency_key).toBe(watchdogEventId(run.id, now.toISOString()));

    const laterDetectedAt = new Date(now.getTime() + 180_000).toISOString();
    const storedForLaterOccurrence = JSON.parse(readFileSync(runPath, "utf8"));
    storedForLaterOccurrence.runnerV2.watchdog.detectedAt = laterDetectedAt;
    delete storedForLaterOccurrence.runnerV2.watchdog.eventEmittedAt;
    writeFileSync(runPath, JSON.stringify(storedForLaterOccurrence));
    const later = await runTypedWatchdogScan({
      ...options,
      now: new Date(now.getTime() + 240_000),
    });

    expect(later.events).toHaveLength(1);
    expect(later.events[0]).not.toBe(archivedPath);
    expect(readdirSync(eventsDir).filter((name) => name.endsWith(".event"))).toHaveLength(2);
    expect(parseRunnerEvent(readFileSync(later.events[0], "utf8")).fields.idempotency_key)
      .toBe(watchdogEventId(run.id, laterDetectedAt));
  });

  it("recovers event, outbox, and hooks after a post-terminalization worker crash", async () => {
    const root = tempRoot();
    const run = runRecord(now, {
      status: "stopped",
      completed: now.toISOString(),
      taskId: "TASK-99",
      runnerV2: {
        watchdog: {
          status: "stalled",
          detectedAt: now.toISOString(),
          runId: "run-recovery",
          reason: "no live session",
          lastAgent: "writer",
          lastAgentStatus: "running",
          pendingAgents: [],
        },
      },
      id: "run-recovery",
      agents: [{ id: "writer", name: "Writer", status: "stopped", session: "" }],
    });
    const runPath = writeRun(root, run);
    const hooks: WatchdogHookInput[] = [];

    const result = await runTypedWatchdogScan({
      runsDir: join(root, "runs"),
      eventsDir: join(root, "events"),
      stateDir: join(root, "state"),
      now: new Date(now.getTime() + 60_000),
      dependencies: {
        transport: new FakeTransport(),
        dispatchHooks: (input) => { hooks.push(input); },
      },
    });

    expect(result.stalled).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.externalEffectsQueued).toBe(2);
    expect(result.hookDispatches).toBe(1);
    expect(hooks).toHaveLength(1);
    expect(JSON.parse(readFileSync(runPath, "utf8")).runnerV2.watchdog).toEqual(expect.objectContaining({
      eventEmittedAt: new Date(now.getTime() + 60_000).toISOString(),
      externalEffectsQueuedAt: new Date(now.getTime() + 60_000).toISOString(),
      hooksDispatchedAt: new Date(now.getTime() + 60_000).toISOString(),
    }));
  });

  it("dedupes watchdog outbox enqueue after append-before-marker recovery", async () => {
    const root = tempRoot();
    const run = runRecord(now, {
      id: "run-outbox-recovery",
      status: "stopped",
      completed: now.toISOString(),
      taskId: "TASK-OUTBOX",
      runnerV2: {
        watchdog: {
          status: "stalled",
          detectedAt: now.toISOString(),
          runId: "run-outbox-recovery",
          reason: "no live session",
          lastAgent: "writer",
          lastAgentStatus: "running",
          pendingAgents: [],
          eventEmittedAt: now.toISOString(),
          hooksDispatchedAt: now.toISOString(),
        },
      },
    });
    const runPath = writeRun(root, run);
    const stateDir = join(root, "state");
    mkdirSync(stateDir, { recursive: true });
    const ids = [
      watchdogExternalEffectId(run.id, "task-status"),
      watchdogExternalEffectId(run.id, "notification"),
    ];
    writeFileSync(join(stateDir, "external-effects.jsonl"), ids.map((id) => JSON.stringify({
      idempotencyKey: id,
      operation: { type: id.includes("task-status") ? "task-status" : "notification", idempotencyKey: id },
    })).join("\n") + "\n");

    const result = await runTypedWatchdogScan({
      runsDir: join(root, "runs"),
      eventsDir: join(root, "events"),
      stateDir,
      now: new Date(now.getTime() + 60_000),
      dependencies: { transport: new FakeTransport(), dispatchHooks: () => undefined },
    });

    expect(result.externalEffectsQueued).toBe(0);
    expect(readFileSync(join(stateDir, "external-effects.jsonl"), "utf8").trim().split("\n")).toHaveLength(2);
    expect(JSON.parse(readFileSync(runPath, "utf8")).runnerV2.watchdog.externalEffectsQueuedAt)
      .toBe(new Date(now.getTime() + 60_000).toISOString());
  });

  it("retries failed hooks at least once and suppresses relaunch after durable acknowledgement", async () => {
    const root = tempRoot();
    const run = runRecord(now, {
      id: "run-hook-recovery",
      status: "stopped",
      completed: now.toISOString(),
      runnerV2: {
        watchdog: {
          status: "stalled",
          detectedAt: now.toISOString(),
          runId: "run-hook-recovery",
          reason: "no live session",
          lastAgent: "writer",
          lastAgentStatus: "running",
          pendingAgents: [],
          eventEmittedAt: now.toISOString(),
          externalEffectsQueuedAt: now.toISOString(),
        },
      },
    });
    const runPath = writeRun(root, run);
    const hooksDir = join(root, "watchdog-hooks");
    mkdirSync(hooksDir, { recursive: true });
    const hookPath = join(hooksDir, "retry-once.sh");
    const invocationPath = join(root, "hook-invocations.txt");
    const firstAttemptPath = join(root, "hook-first-attempt");
    writeFileSync(hookPath, `#!/bin/bash\necho "$MENTIKO_WATCHDOG_DISPATCH_KEY" >> "${invocationPath}"\nif [[ ! -f "${firstAttemptPath}" ]]; then touch "${firstAttemptPath}"; exit 1; fi\nexit 0\n`);
    chmodSync(hookPath, 0o755);
    const base = {
      runsDir: join(root, "runs"),
      eventsDir: join(root, "events"),
      stateDir: join(root, "state"),
      hooksDir,
      dependencies: { transport: new FakeTransport() },
    };

    const failed = await runTypedWatchdogScan({ ...base, now });
    expect(failed.hookDispatches).toBe(0);
    expect(failed.errors).toEqual(expect.arrayContaining([expect.stringContaining("hook dispatch failed")]));
    expect(JSON.parse(readFileSync(runPath, "utf8")).runnerV2.watchdog.hooksDispatchedAt).toBeUndefined();

    const succeeded = await runTypedWatchdogScan({ ...base, now: new Date(now.getTime() + 60_000) });
    expect(succeeded.hookDispatches).toBe(1);
    expect(readFileSync(invocationPath, "utf8").trim().split("\n"))
      .toEqual([watchdogHookDispatchKey(run.id), watchdogHookDispatchKey(run.id)]);

    const stored = JSON.parse(readFileSync(runPath, "utf8"));
    delete stored.runnerV2.watchdog.hooksDispatchedAt;
    writeFileSync(runPath, JSON.stringify(stored));
    const acknowledgedRecovery = await runTypedWatchdogScan({
      ...base,
      now: new Date(now.getTime() + 120_000),
    });
    expect(acknowledgedRecovery.hookDispatches).toBe(1);
    expect(readFileSync(invocationPath, "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("holds terminal attempt capacity until the recorded OS process session is quiescent", async () => {
    const root = tempRoot();
    const run = runRecord(now, {
      id: "run-process-session-cleanup",
      status: "failed",
      completed: now.toISOString(),
      runnerV2: {
        attempts: [{
          id: "attempt-writer",
          runId: "run-process-session-cleanup",
          agentId: "writer",
          phase: "completion_failed",
          observedPhase: "completion_failed",
          desiredPhase: "completion_failed",
          capacitySlotAcquiredAt: new Date(now.getTime() - 60_000).toISOString(),
          processEvidence: {
            processPid: 4100,
            processSpawnedAt: new Date(now.getTime() - 60_000).toISOString(),
            ptySessionId: "writer-run",
          },
          instructionLedger: [],
          recoveryDecisionCount: 0,
          createdAt: new Date(now.getTime() - 60_000).toISOString(),
          updatedAt: now.toISOString(),
          transitions: [],
        }],
      },
      agents: [{ id: "writer", name: "Writer", status: "failed", session: "writer-run" }],
    });
    const runPath = writeRun(root, run);
    const base = {
      runsDir: join(root, "runs"),
      eventsDir: join(root, "events"),
      stateDir: join(root, "state"),
      reapOrphans: false,
      dependencies: {
        transport: new FakeTransport(),
        dispatchHooks: () => undefined,
      },
    };

    const held = await runTypedWatchdogScan({
      ...base,
      dependencies: { ...base.dependencies, processSessionQuiescent: () => false },
      now,
    });
    expect(held.capacitySlotsReleased).toBe(0);
    expect(JSON.parse(readFileSync(runPath, "utf8")).runnerV2.attempts[0].capacitySlotReleasedAt)
      .toBeUndefined();

    const released = await runTypedWatchdogScan({
      ...base,
      dependencies: { ...base.dependencies, processSessionQuiescent: () => true },
      now: new Date(now.getTime() + 1_000),
    });
    expect(released.capacitySlotsReleased).toBe(1);
    expect(JSON.parse(readFileSync(runPath, "utf8")).runnerV2.attempts[0].capacitySlotReleasedAt)
      .toBe(new Date(now.getTime() + 1_000).toISOString());
  });
});
