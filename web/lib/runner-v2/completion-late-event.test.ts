import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { spawn } from "child_process";
import {
  acknowledgeLateCompletionDelivery,
  claimLateCompletionDelivery,
  recoverLateCompletionEvents,
} from "@/lib/runner-v2/completion-recovery";
import { parseRunnerEvent } from "@/lib/runner-v2/events";
import { createRunRecord, readRunJson, updateRunJson } from "@/lib/runner-v2/run-state";
import { createAgentAttempt, transitionAgentAttempt, type AgentAttemptPhase } from "@/lib/runner-v2/agent-attempt";
import { runnerEventFixture } from "@/lib/runner-v2/test-support/runner-event-fixture";

function runPath() {
  return join(mkdtempSync(join(tmpdir(), "runner-v2-late-event-")), "run.json");
}

// Seeds a run in the falsely-terminalized state that completeAgent's exhausted
// path leaves behind: run stopped, agent failed. This is the TASK-093 shape —
// the no-event retry budget exhausted before the slow agent's valid event
// landed.
function seedFailedRun(file: string) {
  const run = createRunRecord({ chainName: "chain", goal: "goal" });
  updateRunJson(file, () => ({
    ...run,
    id: "run-123",
    status: "stopped",
    status_message: "agent writer completed without declared event; retries exhausted",
    agents: [{ id: "writer", name: "Writer", session: "writer-run-123", status: "failed" }],
    sessions: ["writer-run-123"],
  }));
}

function seedFailedAttempt(file: string, agentId = "writer") {
  const attempt = createAgentAttempt({ runJsonPath: file, runId: "run-123", agentId });
  const path: AgentAttemptPhase[] = [
    "lease_acquired",
    "pty_allocated",
    "process_spawned",
    "ready_for_instructions",
    "instructions_submitted",
  ];
  for (const to of path) {
    transitionAgentAttempt({ runJsonPath: file, attemptId: attempt.id, to });
  }
  transitionAgentAttempt({
    runJsonPath: file,
    attemptId: attempt.id,
    to: "completion_failed",
    reason: "retries_exhausted",
    detail: "declared completion event missing; retries exhausted",
  });
  return attempt;
}

function attempts(file: string) {
  return (readRunJson(file).runnerV2 as { attempts?: Array<Record<string, unknown>> } | undefined)?.attempts || [];
}

const CHAIN_WITH_DOWNSTREAM = {
  name: "Build Chain",
  agents: [
    { id: "writer", emits: "draft-ready" },
    { id: "reviewer", triggers: ["draft-ready"] },
  ],
};

const LATE_EVENT = runnerEventFixture({ event: "draft-ready", source: "writer-run-123", runId: "run-123" });

function writeLateEvent(
  file: string,
  content: string = LATE_EVENT,
  filename = "run-123-writer-draft-ready.event",
) {
  const path = join(dirname(file), filename);
  writeFileSync(path, content);
  return { ...parseRunnerEvent(readFileSync(path, "utf8")), path };
}

const CHILD_RECOVERY_SCRIPT = String.raw`
const fs = require("fs");
const { recoverLateCompletionEvents } = require("./lib/runner-v2/completion-recovery");
const { parseRunnerEvent } = require("./lib/runner-v2/events");

const runJsonPath = process.argv[1];
const eventPath = process.argv[2];
const mode = process.argv[3];
const holdMs = Number(process.argv[4] || "0");
const commitMarkerPath = process.argv[5];
const event = { ...parseRunnerEvent(fs.readFileSync(eventPath, "utf8")), path: eventPath };
const testHooks = {};
if (mode === "hold") {
  testHooks.afterLockAcquired = () => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, holdMs);
  };
} else if (mode === "crash-before-commit") {
  testHooks.afterLockAcquired = () => process.exit(86);
} else if (mode === "crash-after-commit") {
  testHooks.afterRunCommitted = () => process.exit(87);
}
if (commitMarkerPath) {
  const afterRunCommitted = testHooks.afterRunCommitted;
  testHooks.afterRunCommitted = () => {
    fs.appendFileSync(commitMarkerPath, String(process.pid) + "\n");
    if (afterRunCommitted) afterRunCommitted();
  };
}

const result = recoverLateCompletionEvents({
  runJsonPath,
  runId: "run-123",
  chain: {
    name: "Build Chain",
    agents: [
      { id: "writer", emits: "draft-ready" },
      { id: "reviewer", triggers: ["draft-ready"] },
    ],
  },
  events: [event],
  now: new Date("2026-06-25T10:05:00.000Z"),
  testHooks,
});
process.stdout.write(JSON.stringify({ recovered: result.recovered.length, status: result.run.status }));
`;

const CHILD_DELIVERY_SCRIPT = String.raw`
const fs = require("fs");
const {
  acknowledgeLateCompletionDelivery,
  claimLateCompletionDelivery,
} = require("./lib/runner-v2/completion-recovery");

const runJsonPath = process.argv[1];
const deliveryId = process.argv[2];
const markerPath = process.argv[3];
const mode = process.argv[4];
const holdMs = Number(process.argv[5] || "0");
const deadClaimGraceMs = process.argv[6] === undefined ? undefined : Number(process.argv[6]);
const claimId = "child:" + process.pid;
const claimed = claimLateCompletionDelivery({ runJsonPath, deliveryId, claimId, deadClaimGraceMs });
if (claimed && mode === "crash-before-apply") process.exit(88);
if (claimed) {
  fs.appendFileSync(markerPath, claimId + "\n");
  if (holdMs > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, holdMs);
  acknowledgeLateCompletionDelivery({
    runJsonPath,
    deliveryId,
    claimId,
    evidence: "plan-applied",
  });
}
process.stdout.write(JSON.stringify({ claimed }));
`;

interface RecoveryChildResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runRecoveryChild(
  runJsonPath: string,
  eventPath: string,
  mode: "normal" | "hold" | "crash-before-commit" | "crash-after-commit",
  holdMs = 0,
  commitMarkerPath = "",
): Promise<RecoveryChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      "-r", "ts-node/register/transpile-only",
      "-r", "tsconfig-paths/register",
      "-e", CHILD_RECOVERY_SCRIPT,
      runJsonPath,
      eventPath,
      mode,
      String(holdMs),
      commitMarkerPath,
    ], {
      cwd: join(__dirname, "../.."),
      env: {
        ...process.env,
        TS_NODE_BASEURL: ".",
        TS_NODE_COMPILER_OPTIONS: JSON.stringify({
          module: "commonjs",
          moduleResolution: "node",
          baseUrl: ".",
          paths: { "@/*": ["./*"] },
        }),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function runDeliveryChild(
  runJsonPath: string,
  deliveryId: string,
  markerPath: string,
  mode: "apply" | "crash-before-apply" = "apply",
  holdMs = 0,
  deadClaimGraceMs?: number,
): Promise<RecoveryChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      "-r", "ts-node/register/transpile-only",
      "-r", "tsconfig-paths/register",
      "-e", CHILD_DELIVERY_SCRIPT,
      runJsonPath,
      deliveryId,
      markerPath,
      mode,
      String(holdMs),
      ...(deadClaimGraceMs === undefined ? [] : [String(deadClaimGraceMs)]),
    ], {
      cwd: join(__dirname, "../.."),
      env: {
        ...process.env,
        TS_NODE_BASEURL: ".",
        TS_NODE_COMPILER_OPTIONS: JSON.stringify({
          module: "commonjs",
          moduleResolution: "node",
          baseUrl: ".",
          paths: { "@/*": ["./*"] },
        }),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function readEvent(path: string) {
  return { ...parseRunnerEvent(readFileSync(path, "utf8")), path };
}

describe("recoverLateCompletionEvents", () => {
  it("adopts a late completion event for a completion_failed attempt, completes the agent, and routes downstream", () => {
    const file = runPath();
    seedFailedRun(file);
    seedFailedAttempt(file);

    const result = recoverLateCompletionEvents({
      runJsonPath: file,
      runId: "run-123",
      chain: CHAIN_WITH_DOWNSTREAM,
      events: [writeLateEvent(file)],
      now: new Date("2026-06-25T10:05:00.000Z"),
    });

    expect(result.recovered).toHaveLength(1);
    expect(result.deliveries).toHaveLength(1);
    expect(result.recovered[0]).toMatchObject({
      deliveryId: expect.stringMatching(/^late-/),
      agentId: "writer",
      route: { action: "launch", agentIds: ["reviewer"] },
    });
    expect(result.recovered[0].event).toMatchObject({ event: "draft-ready", source: "writer-run-123" });

    // run reopened, agent flipped from failed -> complete
    expect(result.run.status).toBe("running");
    expect(result.run.agents[0]).toMatchObject({ id: "writer", status: "complete" });

    // the completion_failed attempt stays in history; a fresh adopted attempt
    // records the real completion evidence (bash parity: "process gone but
    // completion event exists; completing normally")
    const list = attempts(file);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ phase: "completion_failed", terminalReason: "retries_exhausted" });
    expect(list[list.length - 1]).toMatchObject({
      agentId: "writer",
      phase: "completed",
      terminalReason: "completed_from_event",
      origin: "routed-completion-adoption",
    });
  });

  it("completes the run when the recovered agent is the terminal agent (no downstream)", () => {
    const file = runPath();
    seedFailedRun(file);
    seedFailedAttempt(file);

    const result = recoverLateCompletionEvents({
      runJsonPath: file,
      runId: "run-123",
      chain: { name: "Build Chain", agents: [{ id: "writer", emits: "draft-ready" }] },
      events: [writeLateEvent(file)],
      now: new Date("2026-06-25T10:05:00.000Z"),
    });

    expect(result.recovered).toHaveLength(1);
    expect(result.recovered[0].route.action).not.toBe("launch");
    expect(result.run.status).toBe("completed");
    expect(result.run.agents[0]).toMatchObject({ id: "writer", status: "complete" });
  });

  it("keeps route delivery pending after event consumption until the caller acknowledges it", () => {
    const file = runPath();
    seedFailedRun(file);
    seedFailedAttempt(file);
    const event = writeLateEvent(file);

    const first = recoverLateCompletionEvents({
      runJsonPath: file,
      runId: "run-123",
      chain: CHAIN_WITH_DOWNSTREAM,
      events: [event],
      now: new Date("2026-06-25T10:05:00.000Z"),
    });
    expect(first.recovered).toHaveLength(1);
    expect(first.deliveries).toHaveLength(1);
    expect(first.recovered[0].event).toMatchObject({ processed: true, fields: { processed: "true" } });
    expect(readFileSync(event.path!, "utf8")).toContain("processed: true");
    expect(readRunJson(file)).toMatchObject({
      status: "running",
      agents: [{ id: "writer", status: "complete" }],
    });

    const second = recoverLateCompletionEvents({
      runJsonPath: file,
      runId: "run-123",
      chain: CHAIN_WITH_DOWNSTREAM,
      events: [{ ...parseRunnerEvent(readFileSync(event.path!, "utf8")), path: event.path }],
      now: new Date("2026-06-25T10:06:00.000Z"),
    });
    expect(second.recovered).toHaveLength(0);
    expect(second.deliveries).toHaveLength(1);
    expect(second.deliveries[0].deliveryId).toBe(first.deliveries[0].deliveryId);
    // No third attempt: durable event consumption and the recovered run/agent
    // state survive, while the unapplied route remains available to reconcile.
    expect(attempts(file)).toHaveLength(2);
    expect(attempts(file)[1]).toMatchObject({
      phase: "completed",
      terminalReason: "completed_from_event",
    });
    expect(second.run).toMatchObject({
      status: "running",
      agents: [{ id: "writer", status: "complete" }],
    });

    const claimId = "test-reconcile-claim";
    expect(claimLateCompletionDelivery({
      runJsonPath: file,
      deliveryId: second.deliveries[0].deliveryId,
      claimId,
    })).toBe(true);
    expect(acknowledgeLateCompletionDelivery({
      runJsonPath: file,
      deliveryId: second.deliveries[0].deliveryId,
      claimId,
      evidence: "plan-applied",
    })).toBe(true);

    const third = recoverLateCompletionEvents({
      runJsonPath: file,
      runId: "run-123",
      chain: CHAIN_WITH_DOWNSTREAM,
      events: [readEvent(event.path!)],
      now: new Date("2026-06-25T10:07:00.000Z"),
    });
    expect(third.recovered).toHaveLength(0);
    expect(third.deliveries).toHaveLength(0);
    expect(readRunJson(file)).toMatchObject({
      runnerV2: {
        lateCompletionRecoveries: [expect.objectContaining({
          deliveryStatus: "applied",
          appliedAt: expect.any(String),
        })],
      },
    });
  });

  it("serializes two concurrent recovery processes so only one mutates run.json", async () => {
    const file = runPath();
    seedFailedRun(file);
    seedFailedAttempt(file);
    const event = writeLateEvent(file);
    const commitMarkerPath = join(dirname(file), "recovery-commits.log");

    const results = await Promise.all([
      runRecoveryChild(file, event.path!, "hold", 250, commitMarkerPath),
      runRecoveryChild(file, event.path!, "hold", 250, commitMarkerPath),
    ]);

    expect(results.map((result) => result.code)).toEqual([0, 0]);
    expect(results.map((result) => result.stderr)).toEqual(["", ""]);
    expect(results
      .map((result) => JSON.parse(result.stdout) as { recovered: number })
      .map((result) => result.recovered)
      .sort()).toEqual([0, 1]);
    expect(readFileSync(commitMarkerPath, "utf8").trim().split("\n")).toHaveLength(1);
    expect(attempts(file)).toHaveLength(2);
    expect(attempts(file)[1]).toMatchObject({ phase: "completed", terminalReason: "completed_from_event" });
    expect(readEvent(event.path!)).toMatchObject({ processed: true });
    expect(readRunJson(file)).toMatchObject({
      status: "running",
      agents: [{ id: "writer", status: "complete" }],
      runnerV2: { lateCompletionRecoveries: [expect.objectContaining({ agentId: "writer", eventPath: event.path })] },
    });
  });

  it("lets only one of two processes apply and acknowledge the same pending route", async () => {
    const file = runPath();
    seedFailedRun(file);
    seedFailedAttempt(file);
    const event = writeLateEvent(file);
    const recovery = recoverLateCompletionEvents({
      runJsonPath: file,
      runId: "run-123",
      chain: CHAIN_WITH_DOWNSTREAM,
      events: [event],
    });
    const markerPath = join(dirname(file), "delivery-applications.log");

    const results = await Promise.all([
      runDeliveryChild(file, recovery.deliveries[0].deliveryId, markerPath, "apply", 250),
      runDeliveryChild(file, recovery.deliveries[0].deliveryId, markerPath, "apply", 250),
    ]);

    expect(results.map((result) => result.code)).toEqual([0, 0]);
    expect(results.map((result) => result.stderr)).toEqual(["", ""]);
    expect(results
      .map((result) => JSON.parse(result.stdout) as { claimed: boolean })
      .map((result) => result.claimed)
      .sort()).toEqual([false, true]);
    expect(readFileSync(markerPath, "utf8").trim().split("\n")).toHaveLength(1);
    expect(readRunJson(file)).toMatchObject({
      runnerV2: {
        lateCompletionRecoveries: [expect.objectContaining({ deliveryStatus: "applied" })],
      },
    });
    expect(recoverLateCompletionEvents({
      runJsonPath: file,
      runId: "run-123",
      chain: CHAIN_WITH_DOWNSTREAM,
      events: [readEvent(event.path!)],
    }).deliveries).toHaveLength(0);
  });

  it("reclaims a dead process claim that crashed before applying the pending route", async () => {
    const file = runPath();
    seedFailedRun(file);
    seedFailedAttempt(file);
    const event = writeLateEvent(file);
    const recovery = recoverLateCompletionEvents({
      runJsonPath: file,
      runId: "run-123",
      chain: CHAIN_WITH_DOWNSTREAM,
      events: [event],
    });
    const markerPath = join(dirname(file), "reclaimed-delivery.log");
    const deliveryId = recovery.deliveries[0].deliveryId;

    const crashed = await runDeliveryChild(file, deliveryId, markerPath, "crash-before-apply");
    expect(crashed.code).toBe(88);
    expect(readRunJson(file)).toMatchObject({
      runnerV2: {
        lateCompletionRecoveries: [expect.objectContaining({ deliveryStatus: "applying" })],
      },
    });

    const resumed = await runDeliveryChild(file, deliveryId, markerPath, "apply", 0, 0);
    expect(resumed.code).toBe(0);
    expect(JSON.parse(resumed.stdout)).toEqual({ claimed: true });
    expect(readFileSync(markerPath, "utf8").trim().split("\n")).toHaveLength(1);
    expect(readRunJson(file)).toMatchObject({
      runnerV2: {
        lateCompletionRecoveries: [expect.objectContaining({ deliveryStatus: "applied" })],
      },
    });
  });

  it("breaks a crashed pre-commit holder and recovers because the event stayed unprocessed", async () => {
    const file = runPath();
    seedFailedRun(file);
    seedFailedAttempt(file);
    const event = writeLateEvent(file);

    const crashed = await runRecoveryChild(file, event.path!, "crash-before-commit");
    expect(crashed.code).toBe(86);
    expect(readEvent(event.path!)).toMatchObject({ processed: false });
    expect(readRunJson(file)).toMatchObject({
      status: "stopped",
      agents: [{ id: "writer", status: "failed" }],
    });
    expect(attempts(file)).toHaveLength(1);

    const recovered = recoverLateCompletionEvents({
      runJsonPath: file,
      runId: "run-123",
      chain: CHAIN_WITH_DOWNSTREAM,
      events: [readEvent(event.path!)],
      now: new Date("2026-06-25T10:06:00.000Z"),
    });

    expect(recovered.recovered).toHaveLength(1);
    expect(readEvent(event.path!)).toMatchObject({ processed: true });
    expect(attempts(file)).toHaveLength(2);
  });

  it("converges an unprocessed event after a post-commit crash without mutating run.json twice", async () => {
    const file = runPath();
    seedFailedRun(file);
    seedFailedAttempt(file);
    const event = writeLateEvent(file);

    const crashed = await runRecoveryChild(file, event.path!, "crash-after-commit");
    expect(crashed.code).toBe(87);
    const committedRun = readFileSync(file, "utf8");
    expect(JSON.parse(committedRun)).toMatchObject({
      status: "running",
      agents: [{ id: "writer", status: "complete" }],
      runnerV2: {
        attempts: expect.arrayContaining([expect.objectContaining({ phase: "completed" })]),
        lateCompletionRecoveries: [expect.objectContaining({ agentId: "writer", eventPath: event.path })],
      },
    });
    expect(readEvent(event.path!)).toMatchObject({ processed: false });

    const converged = recoverLateCompletionEvents({
      runJsonPath: file,
      runId: "run-123",
      chain: CHAIN_WITH_DOWNSTREAM,
      events: [readEvent(event.path!)],
      now: new Date("2026-06-25T10:06:00.000Z"),
    });

    expect(converged.recovered).toHaveLength(1);
    expect(converged.deliveries).toHaveLength(1);
    expect(converged.recovered[0]).toMatchObject({
      agentId: "writer",
      event: { processed: true },
      route: { action: "launch", agentIds: ["reviewer"] },
    });
    expect(readFileSync(file, "utf8")).toBe(committedRun);
    expect(readEvent(event.path!)).toMatchObject({ processed: true });

    const second = recoverLateCompletionEvents({
      runJsonPath: file,
      runId: "run-123",
      chain: CHAIN_WITH_DOWNSTREAM,
      events: [readEvent(event.path!)],
      now: new Date("2026-06-25T10:07:00.000Z"),
    });
    expect(second.recovered).toHaveLength(0);
    expect(second.deliveries).toHaveLength(1);
    expect(readFileSync(file, "utf8")).toBe(committedRun);

    const claimId = "post-commit-delivery";
    expect(claimLateCompletionDelivery({
      runJsonPath: file,
      deliveryId: second.deliveries[0].deliveryId,
      claimId,
    })).toBe(true);
    expect(acknowledgeLateCompletionDelivery({
      runJsonPath: file,
      deliveryId: second.deliveries[0].deliveryId,
      claimId,
      evidence: "plan-applied",
    })).toBe(true);
    const settled = recoverLateCompletionEvents({
      runJsonPath: file,
      runId: "run-123",
      chain: CHAIN_WITH_DOWNSTREAM,
      events: [readEvent(event.path!)],
      now: new Date("2026-06-25T10:08:00.000Z"),
    });
    expect(settled.deliveries).toHaveLength(0);
  });

  it("replays every pending route when a later event mark fails after an earlier event was consumed", () => {
    const file = runPath();
    seedFailedRun(file);
    updateRunJson(file, (run) => {
      if (!run) throw new Error("seed run missing");
      return {
        ...run,
        agents: [
          { id: "writer", name: "Writer", session: "writer-run-123", status: "failed" },
          { id: "tester", name: "Tester", session: "tester-run-123", status: "failed" },
          { id: "reviewer", name: "Reviewer", session: "", status: "pending" },
          { id: "deployer", name: "Deployer", session: "", status: "pending" },
        ],
        sessions: ["writer-run-123", "tester-run-123"],
      };
    });
    seedFailedAttempt(file, "writer");
    seedFailedAttempt(file, "tester");
    const writerEvent = writeLateEvent(file);
    const testerEvent = writeLateEvent(
      file,
      runnerEventFixture({ event: "tests-ready", source: "tester-run-123", runId: "run-123" }),
      "run-123-tester-tests-ready.event",
    );
    const chain = {
      name: "Build Chain",
      agents: [
        { id: "writer", emits: "draft-ready" },
        { id: "tester", emits: "tests-ready" },
        { id: "reviewer", triggers: ["draft-ready"] },
        { id: "deployer", triggers: ["tests-ready"] },
      ],
    };

    expect(() => recoverLateCompletionEvents({
      runJsonPath: file,
      runId: "run-123",
      chain,
      events: [writerEvent, testerEvent],
      now: new Date("2026-06-25T10:05:00.000Z"),
      testHooks: {
        beforeEventProcessed: (_event, index) => {
          if (index === 1) throw new Error("injected second event mark failure");
        },
      },
    })).toThrow("injected second event mark failure");

    expect(readEvent(writerEvent.path!)).toMatchObject({ processed: true });
    expect(readEvent(testerEvent.path!)).toMatchObject({ processed: false });
    expect(readRunJson(file)).toMatchObject({
      runnerV2: {
        lateCompletionRecoveries: [
          expect.objectContaining({ agentId: "writer", deliveryStatus: "pending" }),
          expect.objectContaining({ agentId: "tester", deliveryStatus: "pending" }),
        ],
      },
    });

    const resumed = recoverLateCompletionEvents({
      runJsonPath: file,
      runId: "run-123",
      chain,
      events: [readEvent(writerEvent.path!), readEvent(testerEvent.path!)],
      now: new Date("2026-06-25T10:06:00.000Z"),
    });
    expect(resumed.deliveries).toHaveLength(2);
    expect(resumed.deliveries).toEqual(expect.arrayContaining([
      expect.objectContaining({ agentId: "writer", route: expect.objectContaining({ action: "launch", agentIds: ["reviewer"] }) }),
      expect.objectContaining({ agentId: "tester", route: expect.objectContaining({ action: "launch", agentIds: ["deployer"] }) }),
    ]));
    expect(readEvent(testerEvent.path!)).toMatchObject({ processed: true });
    expect(attempts(file)).toHaveLength(4);
  });

  it("does not recover when no matching unprocessed event exists (run stays terminal)", () => {
    const file = runPath();
    seedFailedRun(file);
    seedFailedAttempt(file);

    const result = recoverLateCompletionEvents({
      runJsonPath: file,
      runId: "run-123",
      chain: CHAIN_WITH_DOWNSTREAM,
      events: [],
      now: new Date("2026-06-25T10:05:00.000Z"),
    });

    expect(result.recovered).toHaveLength(0);
    expect(result.run.status).toBe("stopped");
    expect(result.run.agents[0]).toMatchObject({ id: "writer", status: "failed" });
    expect(attempts(file)).toHaveLength(1);
  });

  it("fails closed for a pathless matching event because it cannot be durably consumed", () => {
    const file = runPath();
    seedFailedRun(file);
    seedFailedAttempt(file);

    const result = recoverLateCompletionEvents({
      runJsonPath: file,
      runId: "run-123",
      chain: CHAIN_WITH_DOWNSTREAM,
      events: [LATE_EVENT],
      now: new Date("2026-06-25T10:05:00.000Z"),
    });

    expect(result.recovered).toHaveLength(0);
    expect(result.run).toMatchObject({
      status: "stopped",
      agents: [{ id: "writer", status: "failed" }],
    });
  });

  it("does not adopt an already-processed event", () => {
    const file = runPath();
    seedFailedRun(file);
    seedFailedAttempt(file);

    const result = recoverLateCompletionEvents({
      runJsonPath: file,
      runId: "run-123",
      chain: CHAIN_WITH_DOWNSTREAM,
      events: [writeLateEvent(file, runnerEventFixture({ event: "draft-ready", source: "writer-run-123", runId: "run-123", processed: true }))],
      now: new Date("2026-06-25T10:05:00.000Z"),
    });

    expect(result.recovered).toHaveLength(0);
    expect(result.run.status).toBe("stopped");
  });

  it("does not adopt an event whose run_id does not match", () => {
    const file = runPath();
    seedFailedRun(file);
    seedFailedAttempt(file);

    const result = recoverLateCompletionEvents({
      runJsonPath: file,
      runId: "run-123",
      chain: CHAIN_WITH_DOWNSTREAM,
      events: [writeLateEvent(file, runnerEventFixture({ event: "draft-ready", source: "writer-run-123", runId: "run-999" }))],
      now: new Date("2026-06-25T10:05:00.000Z"),
    });

    expect(result.recovered).toHaveLength(0);
    expect(result.run.status).toBe("stopped");
  });

  it("recovers nothing when there are no completion_failed attempts", () => {
    const file = runPath();
    const run = createRunRecord({ chainName: "chain", goal: "goal" });
    updateRunJson(file, () => ({
      ...run,
      id: "run-123",
      status: "running",
      agents: [{ id: "writer", name: "Writer", session: "writer-run-123", status: "running" }],
      sessions: ["writer-run-123"],
    }));

    const result = recoverLateCompletionEvents({
      runJsonPath: file,
      runId: "run-123",
      chain: CHAIN_WITH_DOWNSTREAM,
      events: [writeLateEvent(file)],
      now: new Date("2026-06-25T10:05:00.000Z"),
    });

    expect(result.recovered).toHaveLength(0);
    expect(result.run.status).toBe("running");
    expect(attempts(file)).toHaveLength(0);
  });
});
