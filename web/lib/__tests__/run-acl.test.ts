import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { checkRunAccess, normalizeRunId } from "../auth/run-acl";

jest.mock("../config", () => ({
  __esModule: true,
  default: {
    runsDir: "/missing/default/runs",
  },
}));

jest.mock("../auth/auth-bridge", () => ({
  getSessionUser: jest.fn(() => ({
    id: "user-1",
    email: "user@example.com",
    name: "User",
    role: "owner",
    isAdmin: true,
    namespaceId: "acme",
  })),
}));

jest.mock("../namespace-config", () => ({
  getNamespaceIdFromRequest: jest.fn(() => "acme"),
  getOrgIdFromRequest: jest.fn(() => "default"),
}));

jest.mock("../workspaces/workspace-storage", () => ({
  getWorkspace: jest.fn(() => null),
  listWorkspaces: jest.fn(() => []),
  checkWorkspaceAccess: jest.fn(() => true),
}));

describe("run acl", () => {
  let root: string;
  let runsDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "mentiko-run-acl-"));
    runsDir = join(root, "runs");
    const runDir = join(runsDir, "run-123");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "run.json"),
      JSON.stringify({
        id: "run-123",
        chain: "acl-test",
        goal: "test request-scoped access",
        started: "2026-07-15T12:00:00.000Z",
        status: "running",
        agents: [],
      })
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  it("checks access against a request-scoped runs directory", async () => {
    await expect(checkRunAccess(new Request("http://test"), "run-123")).resolves.toMatchObject({
      ok: false,
      reason: "run-not-found",
    });

    await expect(checkRunAccess(new Request("http://test"), "run-123", runsDir)).resolves.toMatchObject({
      ok: true,
      userId: "user-1",
    });
  });

  it("rejects traversal-shaped run ids before filesystem access", async () => {
    expect(normalizeRunId("run-../secret")).toBeNull();
    expect(normalizeRunId("run-123/../../secret")).toBeNull();
    expect(normalizeRunId("123", { allowBare: true })).toBe("run-123");

    await expect(checkRunAccess(new Request("http://test"), "run-../secret", runsDir)).resolves.toMatchObject({
      ok: false,
      reason: "run-not-found",
    });
  });

  it("treats a malformed persisted record as missing instead of trusting a partial cast", async () => {
    const malformedDir = join(runsDir, "run-malformed");
    mkdirSync(malformedDir);
    writeFileSync(join(malformedDir, "run.json"), JSON.stringify({
      id: "run-malformed",
      status: "running",
      agents: [],
    }));

    await expect(checkRunAccess(new Request("http://test"), "run-malformed", runsDir)).resolves.toMatchObject({
      ok: false,
      reason: "run-not-found",
    });
  });
});
