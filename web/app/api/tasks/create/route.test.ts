/**
 * @jest-environment node
 */
// Contract tests for POST /api/tasks/create. As of chain-contract Track C,
// the route is a thin adapter over lib/tasks/task-creation-service.ts -- the
// deep auto-run/chain-metadata logic these tests used to assert directly now
// lives (and is asserted) in task-creation-service.test.ts. These tests mock
// the service's own dependencies (not the service itself) so the two
// original regression cases below keep proving the exact same end-to-end
// behavior as before the refactor: what taskCreate() is actually called
// with. New cases cover what Track C added: workspace authorization,
// idempotency replay, and invalid-parent handling.

const mockEnforceGuestWrites = jest.fn();
const mockTaskCreate = jest.fn();
const mockTaskGet = jest.fn();
const mockGetWorkspaceId = jest.fn();
const mockHasWorkspaceParam = jest.fn();
const mockGetNamespaceIdFromRequest = jest.fn();
const mockGetOrgIdFromRequest = jest.fn();
const mockValidateChainId = jest.fn();
const mockBuildChainMetadata = jest.fn();
const mockResolveTaskAutoRunPolicy = jest.fn();
const mockGetDb = jest.fn();

// A fake sqlite handle for the idempotency lookup path (task-creation-service
// queries it via _getDb directly). Queue drains in call order.
let dbGetQueue: Array<{ id: string } | undefined> = [];
function queueDbGet(value: { id: string } | undefined) {
  dbGetQueue.push(value);
}

jest.mock("@/lib/auth/api-auth", () => ({
  requirePermission: () => (handler: unknown) => handler,
}));
jest.mock("@/lib/middleware", () => ({
  enforceGuestWrites: (...args: unknown[]) => mockEnforceGuestWrites(...(args as [Request])),
}));
jest.mock("@/lib/tasks/task-store", () => ({
  taskCreate: (...args: unknown[]) => mockTaskCreate(...args),
  taskGet: (...args: unknown[]) => mockTaskGet(...args),
  _getDb: (...args: unknown[]) => mockGetDb(...args),
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
  resolveTaskAutoRunPolicy: (...args: unknown[]) => mockResolveTaskAutoRunPolicy(...args),
}));
jest.mock("@/lib/auth/workspace-auth", () => ({
  // Mirrors the exact convention app/api/mentiko-mcp/ops/tasks/route.test.ts
  // already uses for this function -- identity passthrough for known test
  // paths, undefined (unauthorized) for anything else.
  resolveAuthorizedWorkspacePath: jest.fn((_namespaceId: string, _orgId: string, workspacePath: string) =>
    workspacePath === "/repo" ? workspacePath : undefined,
  ),
}));

import { POST } from "./route";
import { resolveAuthorizedWorkspacePath } from "@/lib/auth/workspace-auth";

function makeRequest(body: Record<string, unknown>, workspace = "%2Frepo") {
  const qs = workspace ? `?workspace=${workspace}` : "";
  return new Request(`http://localhost:3000/api/tasks/create${qs}`, {
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
    mockResolveTaskAutoRunPolicy.mockReturnValue({ enabled: true, source: "workspace_override" });
    mockValidateChainId.mockReturnValue({ valid: true, chainName: "Build Chain" });
    mockBuildChainMetadata.mockImplementation((chainId: string, chainName: string, autoRun: boolean) => ({
      chainBinding: {
        chain_id: chainId,
        chain_name: chainName,
        auto_run: autoRun,
      },
    }));
    mockTaskCreate.mockReturnValue({ id: "TASK-001", title: "New task", status: "open", parent_id: null, assignee: null });
    (resolveAuthorizedWorkspacePath as jest.Mock).mockImplementation((_ns: string, _org: string, path: string) =>
      path === "/repo" ? path : undefined,
    );
  });

  it("enables auto-run from workspace/system default when creation does not explicitly opt out", async () => {
    const res = await POST(makeRequest({
      title: "New task",
      type: "task",
      priority: 2,
    }) as Parameters<typeof POST>[0]);

    expect(res.status).toBe(201);
    expect(mockResolveTaskAutoRunPolicy).toHaveBeenCalledWith({
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
    mockResolveTaskAutoRunPolicy.mockReturnValue({ enabled: false, source: "explicit" });

    const res = await POST(makeRequest({
      title: "New task",
      type: "task",
      priority: 2,
      chainAssignment: { chainId: "build-chain", autoRun: false },
    }) as Parameters<typeof POST>[0]);

    expect(res.status).toBe(201);
    expect(mockResolveTaskAutoRunPolicy).toHaveBeenCalledWith({
      namespaceId: "default",
      orgId: "default",
      workspacePath: "/repo",
      explicitAutoRun: false,
    });
    expect(mockBuildChainMetadata).toHaveBeenCalledWith("build-chain", "Build Chain", false);
    expect(mockTaskCreate).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({
        metadata: expect.objectContaining({
          chainBinding: { chain_id: "build-chain", chain_name: "Build Chain", auto_run: false },
        }),
      }),
      "default",
    );
  });

  it("returns the effective auto-run policy and chain binding in a new `creation` field, alongside the unchanged `issue`", async () => {
    const res = await POST(makeRequest({ title: "New task", type: "task" }) as Parameters<typeof POST>[0]);
    const body = await res.json();
    expect(body.data.issue).toEqual({ id: "TASK-001", title: "New task", status: "open", parent_id: null, assignee: null });
    expect(body.data.creation).toEqual(
      expect.objectContaining({
        outcome: "created",
        effectiveAutoRun: { enabled: true, source: "workspace_override" },
        chainBinding: null,
      }),
    );
  });
});

describe("POST /api/tasks/create workspace authorization (Track C divergence #7)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnforceGuestWrites.mockResolvedValue(null);
    mockGetNamespaceIdFromRequest.mockResolvedValue("default");
    mockGetOrgIdFromRequest.mockResolvedValue("default");
    mockResolveTaskAutoRunPolicy.mockReturnValue({ enabled: false, source: "unscoped" });
    mockTaskCreate.mockReturnValue({ id: "TASK-002" });
    (resolveAuthorizedWorkspacePath as jest.Mock).mockImplementation((_ns: string, _org: string, path: string) =>
      path === "/repo" ? path : undefined,
    );
  });

  it("rejects a workspace the caller is not authorized for (previously silently trusted)", async () => {
    mockGetWorkspaceId.mockReturnValue("/someone-elses-repo");
    mockHasWorkspaceParam.mockReturnValue(true);
    (resolveAuthorizedWorkspacePath as jest.Mock).mockReturnValue(undefined);

    const res = await POST(makeRequest({ title: "New task" }, "%2Fsomeone-elses-repo") as Parameters<typeof POST>[0]);

    expect(res.status).toBe(403);
    expect(mockTaskCreate).not.toHaveBeenCalled();
  });

  it("still 400s on a malformed ?workspace= param (path traversal), same message as before", async () => {
    mockGetWorkspaceId.mockReturnValue(undefined);
    mockHasWorkspaceParam.mockReturnValue(true);

    const res = await POST(makeRequest({ title: "New task" }, "..%2F..") as Parameters<typeof POST>[0]);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.message).toBe("Tasks not initialized in this workspace.");
    expect(mockTaskCreate).not.toHaveBeenCalled();
  });

  it("creates unscoped (no workspace_id) when no ?workspace= param is present at all", async () => {
    mockGetWorkspaceId.mockReturnValue(undefined);
    mockHasWorkspaceParam.mockReturnValue(false);

    const res = await POST(makeRequest({ title: "New task" }, "") as Parameters<typeof POST>[0]);

    expect(res.status).toBe(201);
    expect(resolveAuthorizedWorkspacePath).not.toHaveBeenCalled();
  });
});

describe("POST /api/tasks/create parent validation and idempotency (Track C)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnforceGuestWrites.mockResolvedValue(null);
    mockGetNamespaceIdFromRequest.mockResolvedValue("default");
    mockGetOrgIdFromRequest.mockResolvedValue("default");
    mockGetWorkspaceId.mockReturnValue(undefined);
    mockHasWorkspaceParam.mockReturnValue(false);
    mockResolveTaskAutoRunPolicy.mockReturnValue({ enabled: false, source: "unscoped" });
  });

  it("rejects a parent id that does not exist (C5: invalid parent)", async () => {
    mockTaskGet.mockReturnValue(null);
    const res = await POST(makeRequest({ title: "child", parent: "TASK-999" }, "") as Parameters<typeof POST>[0]);
    expect(res.status).toBe(404);
    expect(mockTaskCreate).not.toHaveBeenCalled();
  });

  it("replays the same idempotencyKey as an existing-task 200 instead of creating a duplicate (C5: same idempotency key replay)", async () => {
    dbGetQueue = [];
    mockGetDb.mockReturnValue({
      prepare: () => ({ get: () => (dbGetQueue.length > 0 ? dbGetQueue.shift() : undefined) }),
    });
    mockTaskCreate.mockReturnValue({ id: "TASK-005", title: "New task", status: "open" });

    queueDbGet(undefined); // first request: no existing row
    const first = await POST(
      makeRequest({ title: "New task", idempotencyKey: "double-submit-guard" }, "") as Parameters<typeof POST>[0],
    );
    expect(first.status).toBe(201);
    expect(mockTaskCreate).toHaveBeenCalledTimes(1);

    queueDbGet({ id: "TASK-005" }); // second request: same key -> found
    mockTaskGet.mockReturnValue({ id: "TASK-005", title: "New task", status: "open" });
    const second = await POST(
      makeRequest({ title: "New task", idempotencyKey: "double-submit-guard" }, "") as Parameters<typeof POST>[0],
    );
    const secondBody = await second.json();

    expect(second.status).toBe(200);
    expect(mockTaskCreate).toHaveBeenCalledTimes(1); // still 1 -- no duplicate insert
    expect(secondBody.data.creation.outcome).toBe("existing");
    expect(secondBody.data.issue.id).toBe("TASK-005");
  });
});
