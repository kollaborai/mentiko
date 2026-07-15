/** @jest-environment node */

const mockCheckAuth = jest.fn();
const mockGetSessionUser = jest.fn();
const mockGetNamespaceIdFromRequest = jest.fn();
const mockGetOrgIdFromRequest = jest.fn();
const mockListWorkspaces = jest.fn();
const mockCheckWorkspaceAccess = jest.fn();
const mockGetRunTokenUsage = jest.fn();

jest.mock("@/lib/auth/api-auth", () => ({
  checkAuth: (...args: unknown[]) => mockCheckAuth(...args),
}));
jest.mock("@/lib/auth/auth-bridge", () => ({
  getSessionUser: (...args: unknown[]) => mockGetSessionUser(...args),
}));
jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: (...args: unknown[]) => mockGetNamespaceIdFromRequest(...args),
  getOrgIdFromRequest: (...args: unknown[]) => mockGetOrgIdFromRequest(...args),
}));
jest.mock("@/lib/workspaces/workspace-storage", () => ({
  listWorkspaces: (...args: unknown[]) => mockListWorkspaces(...args),
  checkWorkspaceAccess: (...args: unknown[]) => mockCheckWorkspaceAccess(...args),
}));
jest.mock("@/lib/system/token-store", () => ({
  getRunTokenUsage: (...args: unknown[]) => mockGetRunTokenUsage(...args),
}));
jest.mock("@/lib/links/link-run-runtime", () => ({
  resolveLinkRunsDir: () => globalThis.__MENTIKO_RUNS_ROUTE_TEST_DIR__,
}));

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET } from "./route";

declare global {
  var __MENTIKO_RUNS_ROUTE_TEST_DIR__: string;
}

function writeRun(runsDir: string, directoryId: string, record: Record<string, unknown> | string): void {
  const runDir = join(runsDir, directoryId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, "run.json"),
    typeof record === "string" ? record : JSON.stringify(record),
  );
}

function validRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "run-valid",
    chain: "typed-list",
    goal: "return only validated run projections",
    started: "2026-07-15T12:00:00.000Z",
    status: "stalled",
    agents: [{
      id: "writer",
      name: "Writer",
      session: "writer-run-valid",
      status: "complete",
      providerMetadata: { shouldNotReachClient: true },
    }],
    metadata: { taskExecution: true },
    runnerV2: { attempts: [] },
    customPersistenceExtension: { shouldNotReachClient: true },
    ...overrides,
  };
}

describe("GET /api/runs", () => {
  let root: string;
  let runsDir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    root = mkdtempSync(join(tmpdir(), "mentiko-runs-route-"));
    runsDir = join(root, "runs");
    mkdirSync(runsDir);
    globalThis.__MENTIKO_RUNS_ROUTE_TEST_DIR__ = runsDir;
    mockCheckAuth.mockResolvedValue(true);
    mockGetSessionUser.mockResolvedValue({ id: "user-1" });
    mockGetNamespaceIdFromRequest.mockResolvedValue("default");
    mockGetOrgIdFromRequest.mockResolvedValue("default");
    mockListWorkspaces.mockReturnValue([]);
    mockCheckWorkspaceAccess.mockReturnValue(true);
    mockGetRunTokenUsage.mockReturnValue(null);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("lists only canonically valid records and returns the explicit UI projection", async () => {
    writeRun(runsDir, "run-valid", validRun());
    writeRun(runsDir, "run-missing-id", validRun({ id: undefined }));
    writeRun(runsDir, "run-invalid-status", validRun({ id: "run-invalid-status", status: "mystery" }));
    writeRun(runsDir, "run-mismatch", validRun({ id: "run-other" }));
    writeRun(runsDir, "run-invalid-json", "{broken");
    mockGetRunTokenUsage.mockReturnValue({ totalCostCents: 125 });

    const response = await GET(new Request("http://localhost/api/runs?limit=100") as never);
    const body = await response.json() as { data: { runs: Array<Record<string, unknown>> } };

    expect(response.status).toBe(200);
    expect(body.data.runs).toEqual([{
      id: "run-valid",
      chain: "typed-list",
      goal: "return only validated run projections",
      started: "2026-07-15T12:00:00.000Z",
      status: "stalled",
      agents: [{
        id: "writer",
        name: "Writer",
        session: "writer-run-valid",
        status: "complete",
      }],
      metadata: { taskExecution: true },
      totalCostCents: 125,
      totalCostDisplay: "$1.25",
    }]);
  });

  it("preserves an omitted sessions field and filters using validated fields", async () => {
    writeRun(runsDir, "run-valid", validRun({ taskId: "TASK-1", type: "chain" }));

    const response = await GET(new Request(
      "http://localhost/api/runs?task=TASK-1&status=stalled&type=chain",
    ) as never);
    const body = await response.json() as { data: { runs: Array<Record<string, unknown>> } };

    expect(body.data.runs).toHaveLength(1);
    expect(body.data.runs[0]).not.toHaveProperty("sessions");
  });
});
