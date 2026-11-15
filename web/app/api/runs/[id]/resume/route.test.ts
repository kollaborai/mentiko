/**
 * @jest-environment node
 */

const mockSpawn = jest.fn((..._args: unknown[]) => ({ pid: 4242, unref: jest.fn() }));
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

jest.mock("@/lib/pty/pty-client", () => ({
  pty: { remove: jest.fn() },
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

jest.mock("@/lib/runner-v2/routing", () => ({
  hasCompletedTrigger: () => true,
  routingContextForEvents: () => ({ completed: new Set() }),
}));

jest.mock("@/lib/runner-v2/events", () => ({
  parseRunnerEvent: (raw: string) => JSON.parse(raw),
}));

jest.mock("@/lib/runs/stale-run-sessions", () => ({
  collectStaleRunSessionNames: () => [],
}));

jest.mock("@/lib/runs/run-process", () => ({
  terminateRunProcess: async () => undefined,
}));

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe("POST /api/runs/[id]/resume", () => {
  it("resumes a run record without chainId through its own chain.json snapshot", async () => {
    const runsDir = writeRun(validRun({ chainId: undefined }));
    writeChainSnapshot(runsDir);

    const res = await POST(makeRequest("run-resume-1") as never, { params: Promise.resolve({ id: "run-resume-1" }) } as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ success: true, runId: "run-resume-1" });
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const command = (mockSpawn.mock.calls[0][1] as string[])[1];
    expect(command).toContain(join(runsDir, "chain.json"));
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
    const command = (mockSpawn.mock.calls[0][1] as string[])[1];
    expect(command).toContain(chainsCopy);
  });

  it("passes the original run's provenance to the child launch env so the child record is complete", async () => {
    const runsDir = writeRun(validRun({
      chainId: "release-review",
      metadata: { generationJobId: "job-9" },
      workspaceId: "ws-1",
      agentProfileId: "profile-1",
      agentProfileSource: "workspace",
      user_id: "user-1",
      org_role: "admin",
    }));
    writeChainSnapshot(runsDir);

    const res = await POST(makeRequest("run-resume-1") as never, { params: Promise.resolve({ id: "run-resume-1" }) } as never);

    expect(res.status).toBe(200);
    const env = (mockSpawn.mock.calls[0][2] as { env: Record<string, string> }).env;
    expect(JSON.parse(env.MENTIKO_RESUME_PROVENANCE)).toEqual({
      resumedFromRunId: "run-resume-1",
      chainId: "release-review",
      metadata: { generationJobId: "job-9" },
      workspaceId: "ws-1",
      agentProfileId: "profile-1",
      agentProfileSource: "workspace",
      user_id: "user-1",
      org_role: "admin",
    });
  });
});
