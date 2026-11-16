/**
 * @jest-environment node
 */

const mockSpawn = jest.fn((..._args: unknown[]) => ({
  pid: 4242,
  unref: jest.fn(),
  on: jest.fn(),
}));
jest.mock("child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

jest.mock("@/lib/config", () => ({
  __esModule: true,
  default: {
    codeRoot: "/tmp/mentiko-resume-route-142-test",
    eventsDir: `/tmp/mentiko-resume-route-142-test/events`,
    globalRoot: `/tmp/mentiko-resume-route-142-test`,
    runsDir: `/tmp/mentiko-resume-route-142-test/runs`,
  },
  nsPath: (nsId: string) => `/tmp/mentiko-resume-route-142-test/namespaces/${nsId}`,
  orgPath: (nsId: string, orgId: string, ...rest: string[]) =>
    `/tmp/mentiko-resume-route-142-test/namespaces/${nsId}/orgs/${orgId}${rest.length ? `/${rest.join("/")}` : ""}`,
}));

jest.mock("@/lib/auth/rbac-auth", () => ({
  requirePermission: async () => null,
}));

const mockPtyRemove = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock("@/lib/pty/pty-client", () => ({
  pty: { remove: (...args: unknown[]) => mockPtyRemove(...args) },
}));

jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: async () => "default",
  getOrgIdFromRequest: async () => "default",
}));

// Identity by default; individual tests switch this to the REAL buildChildEnv
// to prove inherited PTY_DAEMON/capacity settings reach the canonical env.
let mockBuildChildEnv: (env: Record<string, string>) => Record<string, string> = (env) => ({ ...env });
jest.mock("@/lib/runs/child-env", () => ({
  buildChildEnv: (env: Record<string, string>) => mockBuildChildEnv(env),
}));

jest.mock("@/lib/ai-gateway/local-proxy-env", () => ({
  buildLocalAiGatewayProxyEnv: () => ({}),
}));

jest.mock("@/lib/secrets/secrets-store", () => ({
  getSecretsEnvVars: () => ({}),
  resolveProfileEnvVars: () => ({}),
}));

jest.mock("@/lib/agents/agent-profile-storage", () => ({
  getProfile: () => null,
}));

jest.mock("@/lib/auth/run-acl", () => ({
  checkRunAccess: async () => ({ ok: true }),
}));

jest.mock("@/lib/links/link-run-runtime", () => ({
  resolveLinkRunsDir: () => `/tmp/mentiko-resume-route-142-test/runs`,
}));

jest.mock("@/lib/auth/internal-api-auth", () => ({
  resolveInternalAuthSecret: () => "test-secret",
}));

jest.mock("@/lib/auth/auth-bridge", () => ({
  getSessionUser: async () => null,
}));

let mockMintSessionToken: (input: unknown) => Promise<string> = async () => "test-session-token";
jest.mock("@/lib/auth/session-token", () => ({
  mintSessionToken: (input: unknown) => mockMintSessionToken(input),
}));

jest.mock("@/lib/runner-v2/routing", () => ({
  hasCompletedTrigger: () => true,
  routingContextForEvents: () => ({ completed: new Set() }),
}));

jest.mock("@/lib/runner-v2/events", () => ({
  parseRunnerEvent: (raw: string) => JSON.parse(raw),
}));

const mockTerminateRunProcess = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock("@/lib/runs/run-process", () => ({
  terminateRunProcess: (...args: unknown[]) => mockTerminateRunProcess(...args),
}));

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { POST } from "./route";
import { RESUME_SOURCE_HEADER } from "@/lib/runs/resume-attempt";
// REAL sqlite task store, isolated under the mocked config globalRoot.
import { closeAll, taskCreate, taskGet } from "@/lib/tasks/task-store";

const TEST_ROOT = "/tmp/mentiko-resume-route-142-test";

function writeRun(record: Record<string, unknown>): string {
  const runsDir = join(TEST_ROOT, "runs", record.id as string);
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(join(runsDir, "run.json"), JSON.stringify(record, null, 2));
  return runsDir;
}

function writeChainSnapshot(runsDir: string): void {
  writeFileSync(join(runsDir, "chain.json"), JSON.stringify({
    name: "Release Review",
    agents: [
      { id: "planner", name: "Planner" },
      { id: "reviewer", name: "Reviewer" },
    ],
  }));
}

function validRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "run-resume-1",
    chain: "Release Review",
    goal: "resume the chain",
    started: "2026-11-15T20:00:00.000Z",
    status: "failed",
    agents: [
      { id: "planner", name: "Planner", status: "complete", session: "done-1" },
      { id: "reviewer", name: "Reviewer", status: "stopped", session: "dead-1" },
    ],
    ...overrides,
  };
}

function makeRequest(runId: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost:3200/api/runs/${runId}/resume`, {
    method: "POST",
    headers,
  });
}

function readRecord(runsDir: string): Record<string, any> {
  return JSON.parse(readFileSync(join(runsDir, "run.json"), "utf8"));
}

/** Real task row shaped like TASK-010: assigned chain, retained accepted analysis pointer, failed run. */
function seedTask010(runId: string): string {
  const task = taskCreate("default", {
    title: "Resume loop",
    issue_type: "task",
    metadata: {
      auto_run: true,
      chain_id: "release-review",
      chain_name: "Release Review",
      analysis_job_id: "job-1794746071590-ekcfgc3",
      analysis_status: "accepted",
      last_run_id: runId,
      last_run_status: "failed",
      auto_run_retries: 0,
    },
  });
  return task.id;
}

beforeEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(TEST_ROOT, { recursive: true });
  closeAll();
  mockBuildChildEnv = (env) => ({ ...env });
  mockSpawn.mockClear();
  mockSpawn.mockImplementation((..._args: unknown[]) => ({
    pid: 4242,
    unref: jest.fn(),
    on: jest.fn(),
  }));
  mockPtyRemove.mockClear();
  mockTerminateRunProcess.mockClear();
  mockMintSessionToken = async () => "test-session-token";
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  closeAll();
});

describe("POST /api/runs/[id]/resume (route-owned attempts)", () => {
  it("resumes the TASK-010 shape under the original run id via its own chain.json snapshot", async () => {
    const taskId = seedTask010("run-resume-1");
    const runsDir = writeRun(validRun({ chainId: undefined, taskId }));
    writeChainSnapshot(runsDir);

    const res = await POST(
      makeRequest("run-resume-1", { [RESUME_SOURCE_HEADER]: "auto-run" }) as never,
      { params: Promise.resolve({ id: "run-resume-1" }) } as never,
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ success: true, runId: "run-resume-1", resumeFrom: "reviewer" });
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [executable, args] = mockSpawn.mock.calls[0] as [string, string[]];
    expect(executable).toBe(process.execPath);
    expect(args[0]).toMatch(/runner-v2-launch-agent\.(js|cjs)$/);
    expect(args[1]).toBe(join(runsDir, "chain.json"));
    expect(args[2]).toBe("reviewer");
    const env = (mockSpawn.mock.calls[0][2] as { env: Record<string, string> }).env;
    expect(env.MENTIKO_RUN_ID).toBe("run-resume-1");
    expect(env.MENTIKO_RUN_DIR).toBe(runsDir);
    expect(env.MENTIKO_TASK_ID).toBe(taskId);
    // no second run directory: the runs root still holds exactly this run
    expect(readdirSync(join(TEST_ROOT, "runs"))).toEqual(["run-resume-1"]);

    const record = readRecord(runsDir);
    expect(record.status).toBe("running");
    expect(record.resumeAttempt).toMatchObject({
      outcome: "accepted",
      series: 0,
      taskId,
      automatic: true,
    });
    expect(typeof record.resumeAttempt.id).toBe("string");
  });

  it("records a confirmed failure durably and projects it once per attempt when no chain exists", async () => {
    const taskId = seedTask010("run-resume-1");
    const runsDir = writeRun(validRun({ chainId: undefined, taskId }));

    const attemptIds: string[] = [];
    for (let scan = 1; scan <= 3; scan += 1) {
      const res = await POST(
        makeRequest("run-resume-1", { [RESUME_SOURCE_HEADER]: "auto-run" }) as never,
        { params: Promise.resolve({ id: "run-resume-1" }) } as never,
      );
      expect(res.status).toBe(404);

      const record = readRecord(runsDir);
      expect(record.resumeAttempt.outcome).toBe("failed");
      expect(record.resumeAttempt.reason).toContain("no chain.json");
      expect(record.status).toBe("failed");
      attemptIds.push(record.resumeAttempt.id);

      const task = taskGet("default", taskId, "default");
      expect((task!.metadata as Record<string, unknown>).auto_run_retries).toBe(scan);
      expect((task!.metadata as Record<string, unknown>).resume_accounted_attempt_id)
        .toBe(record.resumeAttempt.id);
      expect((task!.metadata as Record<string, unknown>).resume_last_error)
        .toBe(record.resumeAttempt.reason);
    }
    expect(new Set(attemptIds).size).toBe(3);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("replays an unprojected failed outcome on route entry exactly once, without double-charging", async () => {
    const taskId = seedTask010("run-resume-1");
    const runsDir = writeRun(validRun({ chainId: undefined, taskId }));

    await POST(
      makeRequest("run-resume-1", { [RESUME_SOURCE_HEADER]: "auto-run" }) as never,
      { params: Promise.resolve({ id: "run-resume-1" }) } as never,
    );
    const record = readRecord(runsDir);

    // Simulate the crash between the failed-outcome write and the task CAS:
    // the attempt is recorded but never accounted on the task.
    const task = taskGet("default", taskId, "default")!;
    const metadata = task.metadata as Record<string, unknown>;
    delete metadata.resume_accounted_attempt_id;
    delete metadata.auto_run_retries;
    delete metadata.resume_last_error;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { taskUpdate } = await import("@/lib/tasks/task-store");
    taskUpdate("default", taskId, { metadata }, "default");

    const res = await POST(
      makeRequest("run-resume-1", { [RESUME_SOURCE_HEADER]: "auto-run" }) as never,
      { params: Promise.resolve({ id: "run-resume-1" }) } as never,
    );
    expect(res.status).toBe(404); // still no chain: a NEW attempt also fails

    const after = taskGet("default", taskId, "default")!;
    const afterMeta = after.metadata as Record<string, unknown>;
    // the replayed old attempt AND the new attempt each projected once
    expect(afterMeta.auto_run_retries).toBe(2);
    expect(afterMeta.resume_accounted_attempt_id).toBe(readRecord(runsDir).resumeAttempt.id);
  });

  it("a manual attempt records the outcome but never debits task retries", async () => {
    const taskId = seedTask010("run-resume-1");
    const runsDir = writeRun(validRun({ chainId: undefined, taskId }));

    const res = await POST(makeRequest("run-resume-1") as never, { params: Promise.resolve({ id: "run-resume-1" }) } as never);
    expect(res.status).toBe(404);

    const record = readRecord(runsDir);
    expect(record.resumeAttempt.outcome).toBe("failed");
    expect(record.resumeAttempt.automatic).toBeUndefined();
    const task = taskGet("default", taskId, "default")!;
    const metadata = task.metadata as Record<string, unknown>;
    expect(metadata.auto_run_retries).toBe(0);
    expect(metadata.resume_accounted_attempt_id).toBeUndefined();
  });

  it("finishes a crashed preparing attempt under the SAME attempt id instead of inventing a failure", async () => {
    const taskId = seedTask010("run-resume-1");
    const runsDir = writeRun(validRun({
      chainId: undefined,
      taskId,
      resumeAttempt: {
        id: "attempt-crashed-mid-preparation",
        series: 0,
        taskId,
        outcome: "preparing",
        automatic: true,
        updatedAt: "2026-11-16T01:00:00.000Z",
      },
    }));
    writeChainSnapshot(runsDir);

    const res = await POST(
      makeRequest("run-resume-1", { [RESUME_SOURCE_HEADER]: "auto-run" }) as never,
      { params: Promise.resolve({ id: "run-resume-1" }) } as never,
    );
    expect(res.status).toBe(200);

    const record = readRecord(runsDir);
    expect(record.resumeAttempt).toMatchObject({
      id: "attempt-crashed-mid-preparation",
      outcome: "accepted",
    });
    // the crash debited nothing
    const task = taskGet("default", taskId, "default")!;
    expect((task.metadata as Record<string, unknown>).auto_run_retries).toBe(0);
  });

  it("keeps the accepted transition (running + accepted + queued job) when dispatch fails — no rollback", async () => {
    const runsDir = writeRun(validRun({ chainId: undefined }));
    writeChainSnapshot(runsDir);
    mockSpawn.mockImplementation(() => {
      throw new Error("spawn exploded");
    });

    const res = await POST(makeRequest("run-resume-1") as never, { params: Promise.resolve({ id: "run-resume-1" }) } as never);
    const body = await res.json();

    // Acceptance is durable; the route-side spawn is only acceleration of the
    // queued job, so its failure is reported, not acted on.
    expect(res.status).toBe(200);
    expect(body.data.dispatchError).toContain("spawn exploded");
    const record = readRecord(runsDir);
    expect(record.status).toBe("running");
    expect(record.resumeAttempt.outcome).toBe("accepted");
    const jobs = Object.values(record.runnerV2?.launchJobs || {}) as Array<Record<string, unknown>>;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("queued");
  });

  it("lets exactly one of two overlapping resumes proceed; the loser 409s, records no outcome, and never touches sessions", async () => {
    const runsDir = writeRun(validRun({ chainId: undefined }));
    writeChainSnapshot(runsDir);

    const removeStatuses: Array<[string, string | undefined]> = [];
    mockPtyRemove.mockImplementation(async (...args: unknown[]) => {
      removeStatuses.push([String(args[0]), readRecord(runsDir).status]);
      return undefined;
    });

    // Hold the winner between its acceptance write and its dispatch by
    // deferring the session-token mint.
    let releaseMint: (token: string) => void = () => {};
    const mintGate = new Promise<string>((resolve) => { releaseMint = resolve; });
    mockMintSessionToken = () => mintGate;

    const winner = POST(makeRequest("run-resume-1") as never, { params: Promise.resolve({ id: "run-resume-1" }) } as never);
    for (let i = 0; i < 200 && readRecord(runsDir).status !== "running"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(readRecord(runsDir).status).toBe("running");
    expect(mockSpawn).not.toHaveBeenCalled();

    const winnerRemoveCalls = mockPtyRemove.mock.calls.length;
    const winnerTerminateCalls = mockTerminateRunProcess.mock.calls.length;

    const loser = await POST(makeRequest("run-resume-1") as never, { params: Promise.resolve({ id: "run-resume-1" }) } as never);
    const loserBody = await loser.json();

    expect(loser.status).toBe(409);
    expect(loserBody.error.message).toContain("resume is already in progress");
    expect(mockPtyRemove.mock.calls.length).toBe(winnerRemoveCalls);
    expect(mockTerminateRunProcess.mock.calls.length).toBe(winnerTerminateCalls);

    releaseMint("test-session-token");
    const winnerResponse = await winner;
    expect(winnerResponse.status).toBe(200);

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(removeStatuses.length).toBeGreaterThan(0);
    for (const entry of removeStatuses) {
      expect(entry[1]).toBe("failed");
    }
  });

  it("folds the queued routed launch job into the same atomic accepted write and preserves the prior terminal cause as history", async () => {
    const runsDir = writeRun(validRun({
      chainId: undefined,
      status_message: "agent crashed",
      statusReason: { actor: "system", reason: "agent exited nonzero" },
    }));
    writeChainSnapshot(runsDir);

    const res = await POST(makeRequest("run-resume-1") as never, { params: Promise.resolve({ id: "run-resume-1" }) } as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.launchJobId).toMatch(/^routed-launch:/);
    const record = readRecord(runsDir);
    expect(record.status).toBe("running");
    const jobs = Object.values(record.runnerV2?.launchJobs || {}) as Array<Record<string, unknown>>;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe(body.data.launchJobId);
    expect(jobs[0].status).toBe("queued");
    expect(jobs[0].occurrenceId).toMatch(/^resume:run-resume-1:\d+$/);
    expect(jobs[0].targets).toEqual([{ agentId: "reviewer" }]);
    expect(jobs[0].chainPath).toBe(join(runsDir, "chain.json"));
    // the old terminal cause survived as history, not erased
    expect(record.resumeHistory).toHaveLength(1);
    expect(record.resumeHistory[0].statusReason).toEqual({ actor: "system", reason: "agent exited nonzero" });
    expect(record.resumeHistory[0].statusMessage).toBe("agent crashed");
  });

  it("persists ONE canonical child env (inherited PTY daemon and capacity settings included) and the launcher re-persist does not conflict", async () => {
    // The REAL buildChildEnv: the inherited allowlist (PTY_DAEMON, runner
    // capacity settings) must land in both the spawned env and the persisted
    // job environment, byte-for-byte, so the launcher child re-persisting its
    // own process.env computes the identical accepted job.
    const actual = jest.requireActual("@/lib/runs/child-env") as {
      buildChildEnv: (env: Record<string, string>) => Record<string, string>;
    };
    mockBuildChildEnv = actual.buildChildEnv;
    process.env.PTY_DAEMON = "/tmp/mentiko-142-test-pty.sock";
    process.env.MENTIKO_CAP_POLL_SECS = "7";
    process.env.CLAUDECODE = "1";
    try {
      const taskId = seedTask010("run-resume-1");
      const runsDir = writeRun(validRun({ chainId: undefined, taskId }));
      writeChainSnapshot(runsDir);

      const res = await POST(
        makeRequest("run-resume-1", { [RESUME_SOURCE_HEADER]: "auto-run" }) as never,
        { params: Promise.resolve({ id: "run-resume-1" }) } as never,
      );
      expect(res.status).toBe(200);

      const spawnEnv = (mockSpawn.mock.calls[0][2] as { env: Record<string, string> }).env;
      expect(spawnEnv.PTY_DAEMON).toBe("/tmp/mentiko-142-test-pty.sock");
      expect(spawnEnv.MENTIKO_CAP_POLL_SECS).toBe("7");
      expect(spawnEnv.CLAUDECODE).toBeUndefined();

      const record = readRecord(runsDir);
      const job = Object.values(record.runnerV2.launchJobs)[0] as Record<string, unknown>;
      const jobEnv = job.environment as Record<string, string>;
      // the persisted subset carries the inherited settings the launcher will
      // re-derive from its own process.env — no conflicting second identity
      expect(jobEnv.PTY_DAEMON).toBe("/tmp/mentiko-142-test-pty.sock");
      expect(jobEnv.MENTIKO_CAP_POLL_SECS).toBe("7");
      expect(jobEnv.BETTER_AUTH_SECRET).toBeUndefined();

      // The launcher child re-persists its WHOLE environment idempotently
      // (launch-agent-cli persistRoutedLaunchJob with process.env). Its env is
      // the spawn env above, so this must return the SAME job, not conflict.
      const { persistRoutedLaunchJob } = await import("@/lib/runner-v2/launch-job");
      const repersisted = persistRoutedLaunchJob({
        runJsonPath: join(runsDir, "run.json"),
        jobId: job.id as string,
        occurrenceId: job.occurrenceId as string,
        runId: "run-resume-1",
        runDir: runsDir,
        chainPath: join(runsDir, "chain.json"),
        targetAgentIds: ["reviewer"],
        environment: spawnEnv,
      });
      expect(repersisted.id).toBe(job.id);
      expect(repersisted.status).toBe("queued");
      expect(readRecord(runsDir).status).toBe("running");
    } finally {
      delete process.env.PTY_DAEMON;
      delete process.env.MENTIKO_CAP_POLL_SECS;
      delete process.env.CLAUDECODE;
    }
  });
});
