import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { nsPath } from "@/lib/config";
import { drainExternalEffectsOutbox } from "@/lib/runner-v2/external-effects";
import { readRunJson, updateRunJson, type RunRecord } from "@/lib/runner-v2/run-state";
import { runTypedWatchdogScan, type WatchdogTransport } from "@/lib/runner-v2/watchdog";
import { processChainWatcherEvent, type ChainWatcherTrigger } from "@/lib/runner-v2/chain-watcher-service";
import { execFileSync } from "child_process";

jest.mock("@/lib/config", () => {
  const actual = jest.requireActual("@/lib/config");
  return { ...actual, nsPath: jest.fn() };
});

const now = new Date("2026-10-27T12:00:00Z");
const old = "2026-10-27T11:40:00.000Z";
function setup() {
  const root = mkdtempSync(join(tmpdir(), "watchdog-idle-integration-"));
  const id = "run-1793073754169-85d6b7a6";
  const run: RunRecord = { id, chain: "Ping Pong", goal: "test", started: old, status: "running", sessions: [],
    agents: ["step-one", "step-two"].map((id) => ({ id, name: id, session: "", status: "complete", completed: old })),
    runnerV2: { pendingHandoffs: [] } };
  const runDir = join(root, "runs", id);
  mkdirSync(runDir, { recursive: true });
  const path = join(runDir, "run.json");
  writeFileSync(path, JSON.stringify(run));
  (nsPath as jest.Mock).mockReturnValue(join(root, "notifications"));
  const transport: WatchdogTransport = { list: async () => [], remove: async () => { throw new Error("unexpected removal"); } };
  const options = { runsDir: join(root, "runs"), eventsDir: join(root, "events"), stateDir: join(root, "state"),
    namespaceId: "test", orgId: "test", now, reapOrphans: false,
    dependencies: { transport, dispatchHooks: () => {}, processAlive: (_pid: number) => false } };
  return { root, path, run, options, outbox: join(root, "state", "external-effects.jsonl") };
}
function marker(path: string): { id?: string; status?: string; reason?: string } {
  return (readRunJson(path).runnerV2 as { idleIncident: { id?: string; status?: string; reason?: string } }).idleIncident;
}
function notifications(root: string): unknown[] { return JSON.parse(readFileSync(join(root, "notifications", "notifications.json"), "utf8")); }

test("real outbox consumer persists distinct warnings after intervening activity", async () => {
  const x = setup();
  const first = await runTypedWatchdogScan(x.options);
  expect(first.errors).toEqual([]);
  expect(marker(x.path).status).toBe("open");
  const id1 = marker(x.path).id;
  expect((await drainExternalEffectsOutbox({ outboxPath: x.outbox, namespaceId: "test", orgId: "test" })).dispatched).toBe(1);
  expect(notifications(x.root)).toEqual([expect.objectContaining({ type: "warning", title: "Run may be stalled", metadata: expect.objectContaining({ runId: x.run.id }) })]);
  const repeat = await runTypedWatchdogScan(x.options);
  expect(repeat.externalEffectsQueued).toBe(0);
  expect(marker(x.path).id).toBe(id1);
  expect(first.events).toEqual([]);
  updateRunJson(x.path, (run) => ({ ...run!, sessions: ["new-session"] }));
  expect(marker(x.path)).toMatchObject({ id: id1, status: "cleared" });
  updateRunJson(x.path, (run) => ({ ...run!, sessions: [] }));
  const second = await runTypedWatchdogScan(x.options);
  expect(second.errors).toEqual([]);
  expect(marker(x.path).id).not.toBe(id1);
  expect((await drainExternalEffectsOutbox({ outboxPath: x.outbox, namespaceId: "test", orgId: "test" })).dispatched).toBe(1);
  expect(notifications(x.root)).toHaveLength(2);
  expect(readRunJson(x.path).status).toBe("running");
});

test("consumer skips an incident cleared before delivery", async () => {
  const x = setup();
  await runTypedWatchdogScan(x.options);
  updateRunJson(x.path, (run) => ({ ...run!, sessions: ["new-session"] }));
  const result = await drainExternalEffectsOutbox({ outboxPath: x.outbox, namespaceId: "test", orgId: "test" });
  expect(result).toMatchObject({ dispatched: 0, skipped: 1 });
  expect(existsSync(join(x.root, "notifications", "notifications.json"))).toBe(false);
});

test("per-agent relaunch authorization clears an idle warning before delivery", async () => {
  const x = setup();
  await runTypedWatchdogScan(x.options);
  updateRunJson(x.path, (run) => ({ ...run!, relaunchAuthorizations: { "step-one": { authorizedAt: now.toISOString(), launchJobId: "job-1" } } }));
  expect(marker(x.path).status).toBe("cleared");
  const result = await drainExternalEffectsOutbox({ outboxPath: x.outbox, namespaceId: "test", orgId: "test" });
  expect(result).toMatchObject({ dispatched: 0, skipped: 1 });
  expect(existsSync(join(x.root, "notifications", "notifications.json"))).toBe(false);
});

test("run-state activity during daemon recheck clears provisional incident before event or alert", async () => {
  const x = setup();
  let calls = 0;
  x.options.dependencies.transport.list = async () => {
    if (++calls === 2) updateRunJson(x.path, (run) => ({ ...run!, sessions: ["launching"] }));
    return [];
  };
  const result = await runTypedWatchdogScan(x.options);
  expect(result.errors).toEqual([]);
  expect(result.stalled).toEqual([]);
  expect(marker(x.path).status).toBe("cleared");
  expect(existsSync(x.outbox)).toBe(false);
  expect(existsSync(x.options.eventsDir)).toBe(false);
});

test("live session appearing on daemon recheck clears the provisional incident", async () => {
  const x = setup();
  updateRunJson(x.path, (run) => ({ ...run!, sessions: ["session-1"] }));
  let calls = 0;
  x.options.dependencies.transport.list = async () => (++calls === 1 ? [] : [{ name: "session-1", alive: true }]);
  const result = await runTypedWatchdogScan(x.options);
  expect(result.stalled).toEqual([]);
  expect(marker(x.path).status).toBe("cleared");
  expect(existsSync(x.outbox)).toBe(false);
});

test("classifies blocked, stale queued and expired jobs while preserving live or ambiguous jobs", async () => {
  const cases = [
    { status: "blocked", blockedAt: old, expected: "blocked" },
    { status: "queued", expected: "queued" },
    { status: "leased", lease: { ownerId: "worker", pid: 99, acquiredAt: old, heartbeatAt: old, expiresAt: old }, expected: "expired" },
    { status: "leased", lease: { ownerId: "worker", pid: 99, acquiredAt: old, heartbeatAt: old, expiresAt: old }, expected: "alive", liveOwner: true },
    { status: "leased", lease: { ownerId: "worker", acquiredAt: old, heartbeatAt: old, expiresAt: old }, expected: "unknown" },
    { status: "leased", lease: { ownerId: "worker", pid: 99, acquiredAt: old, heartbeatAt: old, expiresAt: "2026-10-27T12:10:00.000Z" }, expected: "" },
  ];
  for (const entry of cases) {
    const x = setup();
    const { expected, liveOwner, ...jobStatus } = entry;
    if (liveOwner) x.options.dependencies.processAlive = (pid) => pid === 99;
    updateRunJson(x.path, (run) => ({ ...run!, runnerV2: { ...(run!.runnerV2 as object), launchJobs: { job: {
      version: 1, id: "job", occurrenceId: "occ", runId: x.run.id, runDir: "/tmp/run", chainPath: "/tmp/chain",
      targets: [{ agentId: "step-one" }], environment: {}, attemptCount: 1, createdAt: old, updatedAt: old, ...jobStatus,
    } } } }));
    const result = await runTypedWatchdogScan(x.options);
    expect(result.errors).toEqual([]);
    if (expected) {
      expect(marker(x.path).reason).toContain(expected);
      expect(result.stalled).toEqual([x.run.id]);
    } else expect(result.stalled).toEqual([]);
    expect(readRunJson(x.path).status).toBe("running");
  }
});

test("empty and terminal-agent records need old, known age; active attempts cannot be terminalized", async () => {
  const empty = setup();
  updateRunJson(empty.path, (run) => ({ ...run!, agents: [] }));
  expect((await runTypedWatchdogScan(empty.options)).stalled).toEqual([empty.run.id]);
  const failed = setup();
  updateRunJson(failed.path, (run) => ({ ...run!, agents: [{ id: "a", name: "A", session: "", status: "failed", completed: old }] }));
  expect((await runTypedWatchdogScan(failed.options)).stalled).toEqual([failed.run.id]);
  const active = setup();
  updateRunJson(active.path, (run) => ({ ...run!, agents: [{ id: "a", name: "A", session: "gone", status: "running", started: old }],
    runnerV2: { attempts: [{ id: "attempt", runId: run!.id, agentId: "a", phase: "instructions_submitted", instructionLedger: [], recoveryDecisionCount: 0, createdAt: old, updatedAt: old, transitions: [] }] } }));
  expect((await runTypedWatchdogScan(active.options)).stalled).toEqual([active.run.id]);
  expect(marker(active.path).reason).toContain("owner is unknown");
  expect(readRunJson(active.path).status).toBe("running");
  updateRunJson(active.path, (run) => ({ ...run!, agents: run!.agents.map((agent) => ({ ...agent, lastHeartbeat: now.toISOString() })) }));
  expect(marker(active.path).status).toBe("cleared");
  expect((await runTypedWatchdogScan(active.options)).stalled).toEqual([]);
});

test("a stuck attempt with an undiscovered live owner is diagnosed without terminalization", async () => {
  const x = setup();
  updateRunJson(x.path, (run) => ({ ...run!, agents: [{ id: "a", name: "A", session: "missing", status: "running", started: old }],
    runnerV2: { attempts: [{ id: "attempt", runId: run!.id, agentId: "a", phase: "stuck", instructionLedger: [], recoveryDecisionCount: 0,
      createdAt: old, updatedAt: old, transitions: [], capacitySlotAcquiredAt: old, processEvidence: { processPid: 99 } }] } }));
  x.options.dependencies.processAlive = (pid) => pid === 99;
  Object.assign(x.options.dependencies, { processSessionQuiescent: () => false });
  const result = await runTypedWatchdogScan(x.options);
  expect(result.errors).toEqual([]);
  expect(result.stalled).toEqual([x.run.id]);
  expect(marker(x.path).reason).toContain("process is alive");
  expect(readRunJson(x.path)).toMatchObject({ status: "running", agents: [{ status: "running" }],
    runnerV2: { attempts: [{ phase: "stuck" }] } });
  const attempts = (readRunJson(x.path).runnerV2 as { attempts: Array<{ capacitySlotReleasedAt?: string }> }).attempts;
  expect(attempts[0].capacitySlotReleasedAt).toBeUndefined();
});

test("actual bundled run-record child clears an incident and terminal event still routes", async () => {
  const x = setup();
  await runTypedWatchdogScan(x.options);
  const launch = jest.fn(async () => ({ pid: 7 }));
  const trigger = (event: string): ChainWatcherTrigger => ({ event, key: event, chainName: event, chainPath: join(x.root, "chain.json") });
  const input = { namespaceId: "test", orgId: "test", stateDir: x.options.stateDir, launch };
  execFileSync("node", [join(process.cwd(), "../lib/runner-run-record.js"), "add-session", "--runs-dir", x.options.runsDir, "--run-id", x.run.id, "--session", "child-session", "--agent-id", "child", "--agent-name", "Child"], { env: process.env });
  expect(marker(x.path).status).toBe("cleared");
  const oldIncident = marker(x.path).id;
  updateRunJson(x.path, (run) => ({ ...run!, sessions: [], agents: run!.agents.filter((agent) => agent.id !== "child") }));
  await runTypedWatchdogScan(x.options);
  expect(marker(x.path)).toMatchObject({ status: "open" });
  expect(marker(x.path).id).not.toBe(oldIncident);
  const terminal = join(x.root, "terminal.event");
  writeFileSync(terminal, `event: run-stalled\nsource: watchdog\nrun_id: ${x.run.id}\ntimestamp: ${now.toISOString()}\nprocessed: false\ndata: {}\n`);
  expect((await processChainWatcherEvent(terminal, [trigger("run-stalled")], input)).launchesStarted).toBe(1);
  expect(launch).toHaveBeenCalledTimes(1);
});

test("old handoff owners and attempts are diagnosed without mutating them; fresh handoff and live PTY remain protected", async () => {
  for (const pid of [99, 100]) {
    const x = setup();
    x.options.dependencies.processAlive = (candidate) => candidate === 99;
    const handoff = { pid, targetAgentIds: ["step-one"], startedAt: old, heartbeatAt: old };
    updateRunJson(x.path, (run) => ({ ...run!, runnerV2: { pendingHandoffs: [handoff] } }));
    const result = await runTypedWatchdogScan(x.options);
    expect(result.errors).toEqual([]);
    expect(marker(x.path).reason).toContain(pid === 99 ? "alive" : "absent");
    expect(readRunJson(x.path)).toMatchObject({ status: "running", runnerV2: { pendingHandoffs: [handoff] } });
  }
  const fresh = setup();
  updateRunJson(fresh.path, (run) => ({ ...run!, runnerV2: { pendingHandoffs: [{ pid: 99, targetAgentIds: ["step-one"], startedAt: now.toISOString() }] } }));
  expect((await runTypedWatchdogScan(fresh.options)).stalled).toEqual([]);
  const live = setup();
  updateRunJson(live.path, (run) => ({ ...run!, sessions: ["live"] }));
  live.options.dependencies.transport.list = async () => [{ name: "live", alive: true }];
  expect((await runTypedWatchdogScan(live.options)).stalled).toEqual([]);
  const active = setup();
  updateRunJson(active.path, (run) => ({ ...run!, agents: [{ id: "a", name: "A", session: "gone", status: "running", started: old }], runnerV2: { pendingHandoffs: [{ pid: 100, targetAgentIds: ["a"], startedAt: old }] } }));
  expect((await runTypedWatchdogScan(active.options)).stalled).toEqual([active.run.id]);
  expect(marker(active.path).reason).toContain("absent");
  expect(readRunJson(active.path).status).toBe("running");
});

test("terminal stop is rolled back if a launch job appears during the post-write check", async () => {
  const x = setup();
  updateRunJson(x.path, (run) => ({ ...run!, agents: [{ id: "a", name: "A", session: "gone", status: "running", started: old }] }));
  let calls = 0;
  x.options.dependencies.transport.list = async () => {
    if (++calls === 3) updateRunJson(x.path, (run) => ({ ...run!, runnerV2: { ...(run!.runnerV2 as object), launchJobs: { job: {
      version: 1, id: "job", occurrenceId: "occ", runId: x.run.id, runDir: "/tmp/run", chainPath: "/tmp/chain",
      targets: [{ agentId: "a" }], environment: {}, status: "queued", attemptCount: 0, createdAt: old, updatedAt: old,
    } } } }));
    return [];
  };
  const result = await runTypedWatchdogScan(x.options);
  expect(result.errors).toEqual([]);
  expect(result.stalled).toEqual([]);
  expect(readRunJson(x.path)).toMatchObject({ status: "running", runnerV2: { launchJobs: { job: { status: "queued" } } } });
  expect(existsSync(x.outbox)).toBe(false);
});
