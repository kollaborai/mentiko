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
    globalRoot: "/tmp/mentiko-resume-route-142-test",
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

jest.mock("@/lib/runs/child-env", () => ({
  buildChildEnv: (env: Record<string, string>) => env,
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

function makeRequest(runId: string): Request {
  return new Request(`http://localhost:3200/api/runs/${runId}/resume`, { method: "POST" });
}

beforeEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(TEST_ROOT, { recursive: true });
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
});

describe("POST /api/runs/[id]/resume", () => {
  it("resumes under the original run id through the typed launch-agent CLI and creates no new run directory", async () => {
    const runsDir = writeRun(validRun({ chainId: undefined }));
    writeChainSnapshot(runsDir);

    const res = await POST(makeRequest("run-resume-1") as never, { params: Promise.resolve({ id: "run-resume-1" }) } as never);
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
    expect(env.RUN_ID).toBe("run-resume-1");
    expect(env.MENTIKO_RUN_DIR).toBe(runsDir);
    expect(env.MENTIKO_COMPLETION_OCCURRENCE_ID).toMatch(/^resume:run-resume-1:\d+$/);
    expect(env.MENTIKO_SESSION_TOKEN).toBe("test-session-token");
    // no second run directory: the runs root still holds exactly this run
    const runDirs = readdirSync(join(TEST_ROOT, "runs"));
    expect(runDirs).toEqual(["run-resume-1"]);
  });

  it("keeps chainId, metadata, workspaceId and task scope on the resumed run record", async () => {
    const runsDir = writeRun(validRun({
      chainId: "release-review",
      metadata: { generationJobId: "job-9", task_run_scope: { runId: "run-resume-1", taskId: "TASK-010" } },
      workspaceId: "ws-1",
      taskId: "TASK-010",
      workspacePath: "/tmp/some-workspace",
    }));
    writeChainSnapshot(runsDir);

    const res = await POST(makeRequest("run-resume-1") as never, { params: Promise.resolve({ id: "run-resume-1" }) } as never);

    expect(res.status).toBe(200);
    const env = (mockSpawn.mock.calls[0][2] as { env: Record<string, string> }).env;
    expect(env.MENTIKO_TASK_ID).toBe("TASK-010");
    expect(env.MENTIKO_WORKSPACE_PATH).toBe("/tmp/some-workspace");
    const record = JSON.parse(readFileSync(join(runsDir, "run.json"), "utf8"));
    expect(record.id).toBe("run-resume-1");
    expect(record.chainId).toBe("release-review");
    expect(record.metadata).toEqual({ generationJobId: "job-9", task_run_scope: { runId: "run-resume-1", taskId: "TASK-010" } });
    expect(record.workspaceId).toBe("ws-1");
    expect(record.taskId).toBe("TASK-010");
    expect(record.status).toBe("running");
    expect(record.resumedAt).toBeTruthy();
  });

  it("returns a clean 404, not a TypeError 500, when chainId is missing and no snapshot exists", async () => {
    writeRun(validRun({ chainId: undefined, id: "run-resume-2" }));

    const res = await POST(makeRequest("run-resume-2") as never, { params: Promise.resolve({ id: "run-resume-2" }) } as never);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.details).toMatchObject({
      id: expect.stringContaining("no chainId and no chain.json"),
    });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("falls back to the chains-dir copy when the run dir has no snapshot", async () => {
    writeRun(validRun({ id: "run-resume-3", chainId: "release-review" }));
    const chainsDir = join(TEST_ROOT, "namespaces/default/orgs/default/chains/release-review");
    mkdirSync(chainsDir, { recursive: true });
    const chainsCopy = join(chainsDir, "chain.json");
    writeFileSync(chainsCopy, JSON.stringify({
      name: "Release Review",
      agents: [
        { id: "planner", name: "Planner" },
        { id: "reviewer", name: "Reviewer" },
      ],
    }));

    const res = await POST(makeRequest("run-resume-3") as never, { params: Promise.resolve({ id: "run-resume-3" }) } as never);

    expect(res.status).toBe(200);
    const args = (mockSpawn.mock.calls[0] as unknown[])[1] as string[];
    expect(args[1]).toBe(chainsCopy);
  });

  it("persists the queued routed launch job in the same atomic write that marks the run running", async () => {
    const runsDir = writeRun(validRun({ chainId: undefined }));
    writeChainSnapshot(runsDir);

    const res = await POST(makeRequest("run-resume-1") as never, { params: Promise.resolve({ id: "run-resume-1" }) } as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.launchJobId).toMatch(/^routed-launch:/);
    const record = JSON.parse(readFileSync(join(runsDir, "run.json"), "utf8"));
    expect(record.status).toBe("running");
    const jobs = Object.values(record.runnerV2?.launchJobs || {}) as Array<Record<string, unknown>>;
    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    expect(job.id).toBe(body.data.launchJobId);
    expect(job.status).toBe("queued");
    expect(job.occurrenceId).toMatch(/^resume:run-resume-1:\d+$/);
    expect(job.targets).toEqual([{ agentId: "reviewer" }]);
    expect(job.chainPath).toBe(join(runsDir, "chain.json"));
    // the spawned launcher recomputes the identical job identity
    const env = (mockSpawn.mock.calls[0][2] as { env: Record<string, string> }).env;
    expect(job.occurrenceId).toBe(env.MENTIKO_COMPLETION_OCCURRENCE_ID);
  });

  it("lets exactly one of two overlapping resumes proceed; the loser 409s and never touches sessions or processes", async () => {
    const runsDir = writeRun(validRun({ chainId: undefined }));
    writeChainSnapshot(runsDir);

    // Track the run status observed at every PTY removal: a loser that removes
    // sessions after the winner's transition would read status "running".
    const removeStatuses: Array<[string, string | undefined]> = [];
    mockPtyRemove.mockImplementation(async (...args: unknown[]) => {
      removeStatuses.push([String(args[0]), readStatus(runsDir)]);
      return undefined;
    });

    // Hold the winner between its atomic transition and its dispatch by
    // deferring the session-token mint.
    let releaseMint: (token: string) => void = () => {};
    const mintGate = new Promise<string>((resolve) => { releaseMint = resolve; });
    mockMintSessionToken = () => mintGate;

    const winner = POST(makeRequest("run-resume-1") as never, { params: Promise.resolve({ id: "run-resume-1" }) } as never);
    for (let i = 0; i < 200 && readStatus(runsDir) !== "running"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(readStatus(runsDir)).toBe("running");
    expect(mockSpawn).not.toHaveBeenCalled();

    const winnerRemoveCalls = mockPtyRemove.mock.calls.length;
    const winnerTerminateCalls = mockTerminateRunProcess.mock.calls.length;

    const loser = await POST(makeRequest("run-resume-1") as never, { params: Promise.resolve({ id: "run-resume-1" }) } as never);
    const loserBody = await loser.json();

    expect(loser.status).toBe(409);
    expect(loserBody.error.message).toContain("resume is already in progress");
    // the loser did nothing: no cleanup, no transition, no launch
    expect(mockPtyRemove.mock.calls.length).toBe(winnerRemoveCalls);
    expect(mockTerminateRunProcess.mock.calls.length).toBe(winnerTerminateCalls);

    releaseMint("test-session-token");
    const winnerResponse = await winner;
    expect(winnerResponse.status).toBe(200);

    // exactly one launch; every session removal happened while the run was
    // still terminal, so the fresh occurrence's sessions were never removed
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(removeStatuses.length).toBeGreaterThan(0);
    for (const entry of removeStatuses) {
      expect(entry[1]).toBe("failed");
    }
  });

  it("rolls the run back to its prior terminal state with a reason and errors when the dispatch fails after the status write", async () => {
    const runsDir = writeRun(validRun({ chainId: undefined }));
    writeChainSnapshot(runsDir);
    mockSpawn.mockImplementation(() => {
      throw new Error("spawn exploded");
    });

    const res = await POST(makeRequest("run-resume-1") as never, { params: Promise.resolve({ id: "run-resume-1" }) } as never);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.message).toContain("resume dispatch failed");
    expect(body.error.message).toContain("spawn exploded");
    const record = JSON.parse(readFileSync(join(runsDir, "run.json"), "utf8"));
    expect(record.status).toBe("failed");
    expect(record.statusReason).toMatchObject({ actor: "system" });
    expect(record.statusReason.reason).toContain("resume dispatch failed");
    // prior agent evidence restored, not left pending
    expect(record.agents).toEqual([
      { id: "planner", name: "Planner", status: "complete", session: "done-1" },
      { id: "reviewer", name: "Reviewer", status: "stopped", session: "dead-1" },
    ]);
    // the never-dispatched launch job is gone; nothing may reclaim it
    expect(Object.values(record.runnerV2?.launchJobs || {})).toEqual([]);
  });
});

function readStatus(runsDir: string): string | undefined {
  try {
    return (JSON.parse(readFileSync(join(runsDir, "run.json"), "utf8")) as { status?: string }).status;
  } catch {
    return undefined;
  }
}
