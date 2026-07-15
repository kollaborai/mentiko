import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseRunnerEvent } from "@/lib/runner-v2/events";
import {
  assessRunForWatchdog,
  dispatchExecutableWatchdogHooks,
  runTypedWatchdogScan,
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
          startedAt: new Date(now.getTime() - 30_000).toISOString(),
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
      },
    });
    expect(transport.removed).toContain("writer-dead");

    const eventFiles = readdirSync(join(root, "events"));
    expect(eventFiles).toHaveLength(1);
    const event = parseRunnerEvent(readFileSync(join(root, "events", eventFiles[0]), "utf8"));
    expect(event).toMatchObject({ event: "run-stalled", source: "watchdog", runId: run.id, processed: false });
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

  it("reaps only dead sessions proven to belong exclusively to terminal scoped runs", async () => {
    const root = tempRoot();
    writeRun(root, runRecord(now, {
      id: "run-done",
      status: "completed",
      agents: [{ id: "done", name: "Done", status: "complete", session: "done-agent" }],
    }));
    writeRun(root, runRecord(now, {
      id: "run-future",
      status: "paused",
      agents: [{ id: "active", name: "Active", status: "running", session: "active-agent" }],
    }));
    writeRun(root, runRecord(now, {
      id: "run-terminal-protected",
      status: "failed",
      agents: [{ id: "term", name: "Term", status: "failed", session: "term-user-owned" }],
    }));
    const transport = new FakeTransport([
      { name: "done-agent", alive: false },
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

    expect(result.orphanSessionsRemoved).toEqual(["done-agent"]);
    expect(result.sessionRemovalFailures).toContain("monitor-done-agent");
    expect(transport.removed).toContain("done-agent");
    expect(transport.removed).not.toContain("monitor-done-agent");
    expect(transport.removed).not.toContain("active-agent");
    expect(transport.removed).not.toContain("unreferenced-agent");
    expect(transport.removed).not.toContain("term-user-owned");
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
});
