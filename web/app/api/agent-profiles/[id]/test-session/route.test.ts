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

const mockRecordSessionOwner = jest.fn();
jest.mock("@/lib/pty/session-owners", () => ({
  recordSessionOwner: (...args: unknown[]) => mockRecordSessionOwner(...args),
}));

const mockResolveAndValidate = jest.fn();
jest.mock("@/lib/system/path-validation", () => ({
  getAllowedRoots: jest.fn(async () => ["/workspace"]),
  resolveAndValidate: (...args: unknown[]) => mockResolveAndValidate(...args),
}));

const mockPtySpawn = jest.fn();
jest.mock("@/lib/pty/pty-client", () => ({
  pty: {
    spawn: (...args: unknown[]) => mockPtySpawn(...args),
  },
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
    mockPtySpawn.mockResolvedValue({ name: "agent-test-kollab-1234567890", pid: 321 });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("spawns the selected profile through the shared interactive profile builder", async () => {
    const response = await POST(
      makeRequest({ cwd: "/workspace/project" }),
      { params: Promise.resolve({ id: "kollab" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.name).toBe("agent-test-kollab-1234567890");
    expect(mockPtySpawn).toHaveBeenCalledWith(
      "agent-test-kollab-1234567890",
      "bash",
      [
        "-lc",
        expect.stringContaining("build_profile_command '/tmp/mentiko-global/namespaces/default/agent-profiles/kollab.json' --interactive"),
      ],
      expect.objectContaining({
        cwd: "/workspace/project",
        env: expect.objectContaining({
          MENTIKO_CODE_ROOT: "/repo/mentiko",
          NAMESPACE_ID: "default",
          ORG_ID: "default",
          MENTIKO_WORKSPACE_PATH: "/workspace/project",
        }),
      }),
    );
    expect(mockRecordSessionOwner).toHaveBeenCalledWith("agent-test-kollab-1234567890", "user-1");
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
    expect(mockPtySpawn).not.toHaveBeenCalled();
  });
});
