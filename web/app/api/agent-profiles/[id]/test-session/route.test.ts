/**
 * @jest-environment node
 */

import type { NextRequest } from "next/server";

jest.mock("@/lib/config", () => {
  const join = (...parts: string[]) => parts.join("/").replace(/\/+/g, "/");
  const globalRoot = "/tmp/mentiko-global";
  const namespaceRoot = join(globalRoot, "namespaces", "default");

  return {
    __esModule: true,
    default: {
      globalRoot,
      codeRoot: "/repo/mentiko",
      namespaceRoot,
      orgRoot: namespaceRoot,
      projectRoot: namespaceRoot,
    },
    orgPath: (namespaceId: string, orgId: string, ...segments: string[]) =>
      orgId === "default"
        ? join(globalRoot, "namespaces", namespaceId, ...segments)
        : join(globalRoot, "namespaces", namespaceId, "orgs", orgId, ...segments),
    nsPath: (namespaceId: string, ...segments: string[]) =>
      join(globalRoot, "namespaces", namespaceId, ...segments),
  };
});

jest.mock("@/lib/auth/rbac-auth", () => ({
  requirePermission: jest.fn(async () => null),
}));

jest.mock("@/lib/auth/auth-bridge", () => ({
  getSessionUser: jest.fn(async () => ({ id: "user-1" })),
}));

jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: jest.fn(async () => "default"),
  getOrgIdFromRequest: jest.fn(async () => "default"),
}));

const mockGetProfile = jest.fn();
jest.mock("@/lib/agents/agent-profile-storage", () => ({
  getProfile: (...args: unknown[]) => mockGetProfile(...args),
  getProfilesDir: () => "/tmp/mentiko-global/namespaces/default/agent-profiles",
}));

const mockResolveAndValidate = jest.fn();
jest.mock("@/lib/system/path-validation", () => ({
  getAllowedRoots: jest.fn(async () => ["/workspace"]),
  resolveAndValidate: (...args: unknown[]) => mockResolveAndValidate(...args),
}));

const mockStartChainRun = jest.fn();
jest.mock("@/lib/runs/chain-run-service", () => ({
  startChainRun: (...args: unknown[]) => mockStartChainRun(...args),
}));

import { POST } from "./route";

function makeRequest(body: Record<string, unknown> = {}): NextRequest {
  return new Request("http://localhost/api/agent-profiles/kollab/test-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe("POST /api/agent-profiles/[id]/test-session", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, "now").mockReturnValue(1234567890);
    mockGetProfile.mockReturnValue({
      id: "kollab",
      name: "Kollab",
      cli: "kollab",
      isDefault: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mockResolveAndValidate.mockReturnValue("/workspace/project");
    mockStartChainRun.mockResolvedValue({
      runId: "run-readiness-1",
      chainId: "agent-profile-readiness-test",
      status: "started",
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("starts a real readiness test chain with the selected profile", async () => {
    const response = await POST(
      makeRequest({ cwd: "/workspace/project", workspaceId: "workspace-1" }),
      { params: Promise.resolve({ id: "kollab" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.runId).toBe("run-readiness-1");
    expect(body.data.chainId).toBe("agent-profile-readiness-test");
    expect(body.data.profileId).toBe("kollab");
    expect(body.data.message).toBe("Started readiness test chain for Kollab");
    expect(mockStartChainRun).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.any(Request),
        namespaceId: "default",
        orgId: "default",
        body: expect.objectContaining({
          chainId: "agent-profile-readiness-test",
          agentProfileId: "kollab",
          workspacePath: "/workspace/project",
          workspaceId: "workspace-1",
          userPrompt: expect.stringContaining("real readiness test"),
          metadata: expect.objectContaining({
            source: "agent-profile-test-session",
            profileId: "kollab",
            profileName: "Kollab",
          }),
        }),
      }),
    );
    const runBody = mockStartChainRun.mock.calls[0][0].body;
    expect(runBody.chain.default_agent_profile).toBe("kollab");
    expect(runBody.chain.config.cli).toBe("kollab");
    expect(runBody.chain.config.max_rounds).toBe(1);
    expect(runBody.chain.agents).toEqual([
      expect.objectContaining({
        id: "readiness_probe",
        agent_profile: "kollab",
        prompt: expect.stringContaining("Readiness probe"),
      }),
    ]);
  });

  it("rejects cwd outside allowed roots", async () => {
    mockResolveAndValidate.mockReturnValue(null);

    const response = await POST(
      makeRequest({ cwd: "/etc" }),
      { params: Promise.resolve({ id: "kollab" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.message).toBe("cwd is outside the allowed roots");
    expect(mockStartChainRun).not.toHaveBeenCalled();
  });
});
