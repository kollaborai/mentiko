/**
 * @jest-environment node
 */

const mockEnforceGuestWrites = jest.fn();
const mockTaskCreate = jest.fn();
const mockGetWorkspaceId = jest.fn();
const mockHasWorkspaceParam = jest.fn();
const mockGetNamespaceIdFromRequest = jest.fn();
const mockGetOrgIdFromRequest = jest.fn();
const mockValidateChainId = jest.fn();
const mockBuildChainMetadata = jest.fn();
const mockResolveTaskAutoRunDefault = jest.fn();

jest.mock("@/lib/auth/api-auth", () => ({
  requirePermission: () => (handler: unknown) => handler,
}));
jest.mock("@/lib/middleware", () => ({
  enforceGuestWrites: (...args: unknown[]) => mockEnforceGuestWrites(...(args as [Request])),
}));
jest.mock("@/lib/tasks/task-store", () => ({
  taskCreate: (...args: unknown[]) => mockTaskCreate(...(args as [string, unknown, string])),
}));
jest.mock("@/lib/workspaces/workspace-params", () => ({
  getWorkspaceId: (...args: unknown[]) => mockGetWorkspaceId(...(args as [Request])),
  hasWorkspaceParam: (...args: unknown[]) => mockHasWorkspaceParam(...(args as [Request])),
}));
jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: (...args: unknown[]) => mockGetNamespaceIdFromRequest(...(args as [Request])),
  getOrgIdFromRequest: (...args: unknown[]) => mockGetOrgIdFromRequest(...(args as [Request])),
}));
jest.mock("@/lib/chains/chain-validation", () => ({
  validateChainId: (...args: unknown[]) => mockValidateChainId(...(args as [string, string, string])),
  buildChainMetadata: (...args: unknown[]) => mockBuildChainMetadata(...(args as [string, string, boolean])),
}));
jest.mock("@/lib/tasks/task-auto-run-default", () => ({
  resolveTaskAutoRunDefault: (...args: unknown[]) => mockResolveTaskAutoRunDefault(...(args as [unknown])),
}));

import { POST } from "./route";

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost:3000/api/tasks/create?workspace=%2Frepo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/tasks/create auto-run defaults", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnforceGuestWrites.mockResolvedValue(null);
    mockGetNamespaceIdFromRequest.mockResolvedValue("default");
    mockGetOrgIdFromRequest.mockResolvedValue("default");
    mockGetWorkspaceId.mockReturnValue("/repo");
    mockHasWorkspaceParam.mockReturnValue(true);
    mockResolveTaskAutoRunDefault.mockReturnValue(true);
    mockValidateChainId.mockReturnValue({ valid: true, chainName: "Build Chain" });
    mockBuildChainMetadata.mockImplementation((chainId: string, chainName: string, autoRun: boolean) => ({
      chain_id: chainId,
      chain_name: chainName,
      auto_run: autoRun,
    }));
    mockTaskCreate.mockReturnValue({ id: "TASK-001", title: "New task" });
  });

  it("enables auto-run from workspace/system default when creation does not explicitly opt out", async () => {
    const res = await POST(makeRequest({
      title: "New task",
      type: "task",
      priority: 2,
    }) as Parameters<typeof POST>[0]);

    expect(res.status).toBe(201);
    expect(mockResolveTaskAutoRunDefault).toHaveBeenCalledWith({
      namespaceId: "default",
      orgId: "default",
      workspacePath: "/repo",
      explicitAutoRun: undefined,
    });
    expect(mockTaskCreate).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({
        metadata: expect.objectContaining({
          workspace_path: "/repo",
          auto_run: true,
        }),
      }),
      "default",
    );
  });

  it("honors explicit chainAssignment.autoRun:false", async () => {
    mockResolveTaskAutoRunDefault.mockReturnValue(false);

    const res = await POST(makeRequest({
      title: "New task",
      type: "task",
      priority: 2,
      chainAssignment: { chainId: "build-chain", autoRun: false },
    }) as Parameters<typeof POST>[0]);

    expect(res.status).toBe(201);
    expect(mockResolveTaskAutoRunDefault).toHaveBeenCalledWith({
      namespaceId: "default",
      orgId: "default",
      workspacePath: "/repo",
      explicitAutoRun: false,
    });
    expect(mockBuildChainMetadata).toHaveBeenCalledWith("build-chain", "Build Chain", false);
  });
});
