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

// For the reset-vs-resume ordering test: the tasks PATCH route must run under
// THIS file's config/link mocks so both routes contend for the same claim dir.
jest.mock("@/lib/auth/api-auth", () => ({
  requirePermission: () => (handler: unknown) => handler,
}));

jest.mock("@/lib/middleware", () => ({
  enforceGuestWrites: async () => undefined,
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

let mockGetSecretsEnvVars: () => Record<string, string> = () => ({});
let mockResolveProfileEnvVars: (ns: string, org: string, env: Record<string, string>) => Record<string, string>
  = (_ns, _org, env) => ({ ...env });
jest.mock("@/lib/secrets/secrets-store", () => ({
  getSecretsEnvVars: () => mockGetSecretsEnvVars(),
  resolveProfileEnvVars: (ns: string, org: string, env: Record<string, string>) =>
    mockResolveProfileEnvVars(ns, org, env),
  secretReferenceName: (value: string) => {
    const match = /^\{secret:([^}]+)\}$/.exec(value);
    return match ? match[1] : null;
  },
}));

let mockGetProfile: (nsId: string, orgId: string, id: string) => unknown = () => null;
jest.mock("@/lib/agents/agent-profile-storage", () => ({
  getProfile: (...args: unknown[]) => mockGetProfile(args[0] as string, args[1] as string, args[2] as string),
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

// P2-2 seams (#142 r3): force an unwritten projection + a lost pause write so
// the route's CHECK of the pause result is observable. Default: passthrough.
let mockProjectionResult: { status: "projected"; retries: number } | { status: "unwritten" } | undefined;
let mockPauseResult: boolean | undefined;
jest.mock("@/lib/runs/resume-attempt", () => {
  const actual = jest.requireActual("@/lib/runs/resume-attempt");
  return {
    ...actual,
    projectConfirmedResumeFailure: (...args: unknown[]) => (mockProjectionResult
      ? mockProjectionResult
      : (actual.projectConfirmedResumeFailure as (...a: unknown[]) => unknown)(...args)),
    pauseTaskForUnwrittenResumeProjection: (...args: unknown[]) => (mockPauseResult !== undefined
      ? mockPauseResult
      : (actual.pauseTaskForUnwrittenResumeProjection as (...a: unknown[]) => boolean)(...args)),
  };
});

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
import { PATCH as patchTask } from "@/app/api/tasks/[id]/route";
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

function writeChainSnapshot(runsDir: string, chainOverrides: Record<string, unknown> = {}): void {
  writeFileSync(join(runsDir, "chain.json"), JSON.stringify({
    name: "Release Review",
    agents: [
      { id: "planner", name: "Planner" },
      { id: "reviewer", name: "Reviewer" },
    ],
    ...chainOverrides,
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
function seedTask010(runId: string, metadataOverrides: Record<string, unknown> = {}): string {
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
      ...metadataOverrides,
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
  mockGetSecretsEnvVars = () => ({});
  mockResolveProfileEnvVars = (_ns, _org, env) => ({ ...env });
  mockGetProfile = () => null;
  mockProjectionResult = undefined;
  mockPauseResult = undefined;
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
    // round 4: the acceptance binds its launch job by id in the SAME write, so
    // the dispatch-bound expiry can target exactly this job
    expect(record.resumeAttempt).toMatchObject({
      outcome: "accepted",
      launchJobId: body.data.launchJobId,
    });
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

  it("refuses to accept an automatic resume when the task no longer points at this run", async () => {
    // A run replacement/reassignment re-pointed the task elsewhere: old work
    // must not be accepted onto it. The refusal is visible (409) and leaves
    // the run unaccepted.
    const taskId = seedTask010("run-other");
    const runsDir = writeRun(validRun({ chainId: undefined, taskId }));
    writeChainSnapshot(runsDir);

    const res = await POST(
      makeRequest("run-resume-1", { [RESUME_SOURCE_HEADER]: "auto-run" }) as never,
      { params: Promise.resolve({ id: "run-resume-1" }) } as never,
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.message).toContain("no longer points at run run-resume-1");

    const record = readRecord(runsDir);
    expect(record.status).toBe("failed");
    expect(record.resumeAttempt.outcome).toBe("preparing");
    expect(mockSpawn).not.toHaveBeenCalled();
    const task = taskGet("default", taskId, "default")!;
    expect((task.metadata as Record<string, unknown>).auto_run_retries).toBe(0);
  });

  it("refuses to accept an automatic resume onto a closed task", async () => {
    const taskId = seedTask010("run-resume-1");
    const { taskUpdate } = await import("@/lib/tasks/task-store");
    taskUpdate("default", taskId, { status: "closed" }, "default");
    const runsDir = writeRun(validRun({ chainId: undefined, taskId }));
    writeChainSnapshot(runsDir);

    const res = await POST(
      makeRequest("run-resume-1", { [RESUME_SOURCE_HEADER]: "auto-run" }) as never,
      { params: Promise.resolve({ id: "run-resume-1" }) } as never,
    );
    expect(res.status).toBe(409);
    expect(readRecord(runsDir).status).toBe("failed");
  });

  it("a reset that landed before entry starts a fresh-series attempt; the old attempt's work is never accepted", async () => {
    // The stale preparing attempt belongs to series 0; a Retry-task reset moved
    // the task to series 1. The route must supersede the old attempt with a
    // NEW one bound to the current series, not finish the old one.
    const taskId = seedTask010("run-resume-1", { resume_series: 1 });
    const runsDir = writeRun(validRun({
      chainId: undefined,
      taskId,
      resumeAttempt: {
        id: "attempt-stale-series-0",
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
      id: expect.not.stringMatching(/^attempt-stale-series-0$/),
      series: 1,
      outcome: "accepted",
    });
  });

  // ---- fail-closed credential reconstruction (#142 round 3) ----

  it("a missing referenced agent profile blocks the resume before any PTY effect, with a recorded reason", async () => {
    const taskId = seedTask010("run-resume-1");
    const runsDir = writeRun(validRun({ chainId: undefined, taskId }));
    writeChainSnapshot(runsDir, { default_agent_profile: "prof-gone" });
    mockGetProfile = () => null;

    const res = await POST(
      makeRequest("run-resume-1", { [RESUME_SOURCE_HEADER]: "auto-run" }) as never,
      { params: Promise.resolve({ id: "run-resume-1" }) } as never,
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.message).toContain("profile prof-gone");
    expect(body.error.message).toContain("missing");

    const record = readRecord(runsDir);
    expect(record.status).toBe("failed");
    expect(record.resumeAttempt.outcome).toBe("failed");
    expect(record.resumeAttempt.reason).toContain("profile prof-gone");
    // blocked before any PTY effect: no stale-session cleanup, no launcher
    expect(mockPtyRemove).not.toHaveBeenCalled();
    expect(mockTerminateRunProcess).not.toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
    // a confirmed automatic failure is accounted exactly once
    const task = taskGet("default", taskId, "default")!;
    expect((task.metadata as Record<string, unknown>).auto_run_retries).toBe(1);
  });

  it("an unresolved {secret:NAME} reference blocks the resume with a recorded reason", async () => {
    const taskId = seedTask010("run-resume-1");
    const runsDir = writeRun(validRun({ chainId: undefined, taskId }));
    writeChainSnapshot(runsDir, { default_agent_profile: "prof-release" });
    mockGetProfile = () => ({ id: "prof-release", env: { API_KEY: "{secret:VAULT_MISSING}" } });
    // resolveProfileEnvVars leaves the literal marker for an absent secret
    mockResolveProfileEnvVars = (_ns, _org, env) => ({ ...env });

    const res = await POST(
      makeRequest("run-resume-1", { [RESUME_SOURCE_HEADER]: "auto-run" }) as never,
      { params: Promise.resolve({ id: "run-resume-1" }) } as never,
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.message).toContain("API_KEY");
    expect(body.error.message).toContain("could not be resolved");

    const record = readRecord(runsDir);
    expect(record.resumeAttempt.outcome).toBe("failed");
    expect(record.resumeAttempt.reason).toContain("API_KEY");
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("a secret mapped to an allowlisted env name reaches the launcher env but is never persisted to the job or run record", async () => {
    const taskId = seedTask010("run-resume-1");
    const runsDir = writeRun(validRun({ chainId: undefined, taskId }));
    writeChainSnapshot(runsDir);
    // A vault secret mapped to MENTIKO_DEBUG — an allowlisted, nonsecret name.
    mockGetSecretsEnvVars = () => ({ MENTIKO_DEBUG: "vault-only-debug-value" });

    const res = await POST(
      makeRequest("run-resume-1", { [RESUME_SOURCE_HEADER]: "auto-run" }) as never,
      { params: Promise.resolve({ id: "run-resume-1" }) } as never,
    );
    expect(res.status).toBe(200);

    const spawnEnv = (mockSpawn.mock.calls[0][2] as { env: Record<string, string> }).env;
    // the launcher child still GETS the secret at runtime...
    expect(spawnEnv.MENTIKO_DEBUG).toBe("vault-only-debug-value");
    // ...the provenance marker travels with it...
    expect(spawnEnv.MENTIKO_LAUNCH_SECRET_ENV_KEYS).toBe(JSON.stringify(["MENTIKO_DEBUG"]));

    const record = readRecord(runsDir);
    const raw = JSON.stringify(record);
    // ...but the value is never persisted, whatever its env var name
    expect(raw).not.toContain("vault-only-debug-value");
    const job = Object.values(record.runnerV2.launchJobs)[0] as Record<string, unknown>;
    expect((job.environment as Record<string, string>).MENTIKO_DEBUG).toBeUndefined();
    expect((job.environment as Record<string, string>).MENTIKO_LAUNCH_SECRET_ENV_KEYS).toBeUndefined();

    // the launcher child re-persists from its own process.env using the
    // marker: identical job, still without the secret
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
      excludeEnvKeys: JSON.parse(spawnEnv.MENTIKO_LAUNCH_SECRET_ENV_KEYS) as string[],
    });
    expect(repersisted.id).toBe(job.id);
    expect(JSON.stringify(readRecord(runsDir))).not.toContain("vault-only-debug-value");
  });

  it("an unwritten pause for an unprojected failure is CHECKED and logged, never silently assumed", async () => {
    const taskId = seedTask010("run-resume-1");
    const runsDir = writeRun(validRun({ chainId: undefined, taskId })); // no chain snapshot
    mockProjectionResult = { status: "unwritten" };
    mockPauseResult = false;
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = await POST(
        makeRequest("run-resume-1", { [RESUME_SOURCE_HEADER]: "auto-run" }) as never,
        { params: Promise.resolve({ id: "run-resume-1" }) } as never,
      );
      expect(res.status).toBe(404);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("could not be written"),
      );
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("replays on the next resume entry"),
      );
    } finally {
      mockProjectionResult = undefined;
      mockPauseResult = undefined;
      errorSpy.mockRestore();
    }
  });

  // ---- acceptance fence for every task-linked attempt (#142 round 3) ----

  it("a MANUAL resume of a replaced run (task re-pointed elsewhere) is refused, never accepted", async () => {
    const taskId = seedTask010("run-replacement-2");
    const runsDir = writeRun(validRun({ chainId: undefined, taskId }));
    writeChainSnapshot(runsDir);

    const res = await POST(makeRequest("run-resume-1") as never, { params: Promise.resolve({ id: "run-resume-1" }) } as never);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.message).toContain("no longer points at run run-resume-1");

    const record = readRecord(runsDir);
    expect(record.status).toBe("failed");
    expect(record.resumeAttempt.outcome).toBe("preparing");
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("a MANUAL resume is fenced by the AUTHORITATIVE task_run_scope, not just last_run_id", async () => {
    // The scope is the authoritative claim: when one exists and names another
    // run, a manual resume of the old run is refused even though a stale
    // last_run_id still matches it.
    const taskId = seedTask010("run-resume-1", {
      task_run_scope: { taskId: "TASK-OTHER", runId: "run-replacement-3" },
    });
    const runsDir = writeRun(validRun({ chainId: undefined, taskId }));
    writeChainSnapshot(runsDir);

    const res = await POST(makeRequest("run-resume-1") as never, { params: Promise.resolve({ id: "run-resume-1" }) } as never);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.message).toContain("no longer points at run run-resume-1");
    expect(readRecord(runsDir).resumeAttempt.outcome).toBe("preparing");
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("a reset racing a LIVE resume waits for the claim and lands after acceptance — the resume is never fenced out", async () => {
    const taskId = seedTask010("run-resume-1");
    const runsDir = writeRun(validRun({ chainId: undefined, taskId }));
    writeChainSnapshot(runsDir);

    // Hold the resume between its acceptance write and its dispatch by
    // deferring the session-token mint; the .resume-claim stays held.
    let releaseMint: (token: string) => void = () => {};
    const mintGate = new Promise<string>((resolve) => { releaseMint = resolve; });
    mockMintSessionToken = () => mintGate;

    const resume = POST(
      makeRequest("run-resume-1", { [RESUME_SOURCE_HEADER]: "auto-run" }) as never,
      { params: Promise.resolve({ id: "run-resume-1" }) } as never,
    );
    // Wait until acceptance has LANDED while the claim is still held (the
    // mint gate keeps the route inside its try block past the acceptance).
    for (let i = 0; i < 400; i += 1) {
      const attempt = readRecord(runsDir).resumeAttempt as { outcome?: string } | undefined;
      if (attempt?.outcome === "accepted") break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(readRecord(runsDir).resumeAttempt.outcome).toBe("accepted");

    // Fire the reset while the resume still holds the claim.
    const reset = patchTask(
      new Request(`http://localhost:3200/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: JSON.stringify({ resume_series: 99 }) }),
      }) as never,
      { params: Promise.resolve({ id: taskId }) } as never,
    );

    // Let the resume finish: the reset must WAIT (async), not 409 and not
    // interleave its write between the resume's read and its acceptance.
    releaseMint("test-session-token");
    const [resumeRes, resetRes] = await Promise.all([resume, reset]);
    expect(resumeRes.status).toBe(200);
    expect(resetRes.status).toBe(200);

    // Acceptance recorded at the pre-reset series; the reset then landed its
    // own increment — two distinct series, strictly ordered.
    expect(readRecord(runsDir).resumeAttempt).toMatchObject({ outcome: "accepted", series: 0 });
    const task = taskGet("default", taskId, "default")!;
    expect((task.metadata as Record<string, unknown>).resume_series).toBe(1);
  });
});
