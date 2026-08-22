/** @jest-environment node */

const mockGetSessionUser = jest.fn();
const mockGetNamespaceConfig = jest.fn();
const mockGetNamespaceIdFromRequest = jest.fn();
const mockGetOrgIdFromRequest = jest.fn();

jest.mock("@/lib/auth/auth-bridge", () => ({
  getSessionUser: (...args: unknown[]) => mockGetSessionUser(...args),
}));
jest.mock("@/lib/namespace-config", () => ({
  getNamespaceConfig: (...args: unknown[]) => mockGetNamespaceConfig(...args),
  getNamespaceIdFromRequest: (...args: unknown[]) => mockGetNamespaceIdFromRequest(...args),
  getOrgIdFromRequest: (...args: unknown[]) => mockGetOrgIdFromRequest(...args),
}));
jest.mock("@/lib/workspaces/workspace-storage", () => ({
  getWorkspace: () => null,
  listWorkspaces: () => [],
  checkWorkspaceAccess: () => true,
}));
jest.mock("@/lib/links/link-run-runtime", () => ({
  resolveLinkRunsDir: () => globalThis.__MENTIKO_RUN_DETAIL_ROUTE_TEST_DIR__,
}));
jest.mock("@/lib/tasks/task-store", () => ({ taskMergeMeta: jest.fn() }));
jest.mock("@/lib/system/system-logger", () => ({ writeLog: jest.fn() }));
jest.mock("@/lib/pty/pty-client", () => ({ pty: { remove: jest.fn() } }));

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET } from "./route";

declare global {
  var __MENTIKO_RUN_DETAIL_ROUTE_TEST_DIR__: string;
}

function writeRun(record: Record<string, unknown> | string): void {
  const runDir = join(globalThis.__MENTIKO_RUN_DETAIL_ROUTE_TEST_DIR__, "run-123");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, "run.json"),
    typeof record === "string" ? record : JSON.stringify(record),
  );
}

async function getRun(): Promise<Response> {
  return GET(new Request("http://localhost/api/runs/run-123") as never, {
    params: Promise.resolve({ id: "run-123" }),
  });
}

describe("GET /api/runs/[id] canonical record reads", () => {
  let root: string;

  beforeEach(() => {
    jest.clearAllMocks();
    root = mkdtempSync(join(tmpdir(), "mentiko-run-detail-route-"));
    globalThis.__MENTIKO_RUN_DETAIL_ROUTE_TEST_DIR__ = join(root, "runs");
    mkdirSync(globalThis.__MENTIKO_RUN_DETAIL_ROUTE_TEST_DIR__);
    mockGetSessionUser.mockResolvedValue({ id: "user-1" });
    mockGetNamespaceConfig.mockResolvedValue({ stateDir: join(globalThis.__MENTIKO_RUN_DETAIL_ROUTE_TEST_DIR__, "state") });
    mockGetNamespaceIdFromRequest.mockResolvedValue("default");
    mockGetOrgIdFromRequest.mockResolvedValue("default");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("does not synthesize a missing persisted id from the directory name", async () => {
    writeRun({
      chain: "invalid-detail",
      goal: "do not repair persisted identity",
      started: "2026-07-15T12:00:00.000Z",
      status: "running",
      agents: [],
    });

    const response = await getRun();
    const body = await response.json() as { error: { code: string } };

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("rejects a directory/record identity mismatch through the shared ACL reader", async () => {
    writeRun({
      id: "run-other",
      chain: "invalid-detail",
      goal: "preserve directory identity",
      started: "2026-07-15T12:00:00.000Z",
      status: "running",
      agents: [],
    });

    const response = await getRun();

    expect(response.status).toBe(404);
  });

  it("projects durable agent output into the canonical run detail response", async () => {
    writeRun({
      id: "run-123",
      chain: "durable-output",
      goal: "show completed output",
      started: "2026-07-15T12:00:00.000Z",
      status: "completed",
      agents: [{
        id: "readiness_probe",
        name: "Readiness Probe",
        status: "complete",
        session: "session-123",
      }],
    });
    mkdirSync(
      join(globalThis.__MENTIKO_RUN_DETAIL_ROUTE_TEST_DIR__, "run-123", "artifacts"),
      { recursive: true },
    );
    writeFileSync(
      join(
        globalThis.__MENTIKO_RUN_DETAIL_ROUTE_TEST_DIR__,
        "run-123",
        "artifacts",
        "readiness_probe-summary.md",
      ),
      "# Readiness Probe\n\nCompleted successfully.",
    );

    const response = await getRun();
    const body = await response.json() as {
      data: { run: { agents: Array<{ durableOutput?: string | null }> } };
    };

    expect(response.status).toBe(200);
    expect(body.data.run.agents[0].durableOutput).toBe(
      "# Readiness Probe\n\nCompleted successfully.",
    );
  });
});
