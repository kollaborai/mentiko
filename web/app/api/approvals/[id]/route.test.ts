const requirePermission = jest.fn();
const getNamespaceIdFromRequest = jest.fn();
const getOrgIdFromRequest = jest.fn();
const getApprovalRequest = jest.fn();
const updateApprovalRequest = jest.fn();
const getSessionUser = jest.fn();

jest.mock("@/lib/auth/rbac-auth", () => ({
  requirePermission: (...args: unknown[]) => requirePermission(...args),
}));
jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: (...args: unknown[]) => getNamespaceIdFromRequest(...args),
  getOrgIdFromRequest: (...args: unknown[]) => getOrgIdFromRequest(...args),
}));
jest.mock("@/lib/system/approval-storage", () => ({
  getApprovalRequest: (...args: unknown[]) => getApprovalRequest(...args),
  updateApprovalRequest: (...args: unknown[]) => updateApprovalRequest(...args),
}));
jest.mock("@/lib/auth/auth-bridge", () => ({
  getSessionUser: (...args: unknown[]) => getSessionUser(...args),
}));
jest.mock("@/lib/api-response", () => ({
  withErrorHandling: (handler: (...args: unknown[]) => unknown) => handler,
  apiSuccess: (data: unknown) => ({ status: 200, data }),
}));
jest.mock("@/lib/api-errors", () => ({
  BadRequest: class BadRequest extends Error {},
  NotFound: class NotFound extends Error {},
  Forbidden: class Forbidden extends Error {},
  Unauthorized: class Unauthorized extends Error {},
}));

import { DELETE, PATCH, POST } from "./route";

const actor = {
  id: "session-user-1",
  sessionId: "session-1",
  role: "owner",
  namespaceId: "default",
};

function makeRequest(method: string, body?: Record<string, unknown>, headers?: Record<string, string>) {
  return {
    method,
    url: "http://localhost:3000/api/approvals/approval-1",
    headers: new Headers(headers),
    json: async () => body ?? {},
  } as never;
}

function makeApproval(overrides: Record<string, unknown> = {}) {
  return {
    id: "approval-1",
    chainId: "chain-1",
    runId: "run-1",
    agentName: "reviewer",
    stepName: "review",
    status: "pending",
    requestedBy: "requester-1",
    requestedAt: "2026-11-13T00:00:00.000Z",
    method: "web",
    metadata: {},
    action: "approve change",
    description: "approve change",
    ...overrides,
  };
}

const context = { params: Promise.resolve({ id: "approval-1" }) };

describe("approval decisions use the authenticated session actor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    requirePermission.mockResolvedValue(null);
    getNamespaceIdFromRequest.mockResolvedValue("default");
    getOrgIdFromRequest.mockResolvedValue("default");
    getSessionUser.mockResolvedValue(actor);
    getApprovalRequest.mockResolvedValue(makeApproval());
    updateApprovalRequest.mockResolvedValue(undefined);
  });

  it("approves without an actor header and persists the session identity", async () => {
    const response = await POST(makeRequest("POST"), context as never) as { status: number };

    expect(response.status).toBe(200);
    expect(getSessionUser).toHaveBeenCalled();
    expect(updateApprovalRequest).toHaveBeenCalledWith("default", "default", expect.objectContaining({
      status: "approved",
      approvedBy: "session-user-1",
      approvalActor: { user_id: "session-user-1", session_id: "session-1", org_role: "owner" },
    }));
  });

  it("ignores a spoofed x-user-id header", async () => {
    await POST(makeRequest("POST", undefined, { "x-user-id": "spoofed-user" }), context as never);

    expect(updateApprovalRequest).toHaveBeenCalledWith("default", "default", expect.objectContaining({
      approvedBy: "session-user-1",
      approvalActor: expect.objectContaining({ user_id: "session-user-1" }),
    }));
  });

  it("checks the approver allowlist against the session user", async () => {
    getApprovalRequest.mockResolvedValue(makeApproval({ approvers: ["another-user"] }));

    await expect(POST(makeRequest("POST", undefined, { "x-user-id": "another-user" }), context as never))
      .rejects.toThrow("not an allowed approver");
    expect(updateApprovalRequest).not.toHaveBeenCalled();
  });

  it("records the session actor for rejection and cancellation", async () => {
    await PATCH(makeRequest("PATCH", { reason: "Needs revision" }), context as never);
    expect(updateApprovalRequest).toHaveBeenLastCalledWith("default", "default", expect.objectContaining({
      status: "rejected",
      approvedBy: "session-user-1",
      approvalActor: expect.objectContaining({ user_id: "session-user-1" }),
    }));

    getApprovalRequest.mockResolvedValue(makeApproval());
    await DELETE(makeRequest("DELETE"), context as never);
    expect(updateApprovalRequest).toHaveBeenLastCalledWith("default", "default", expect.objectContaining({
      status: "cancelled",
      approvedBy: "session-user-1",
      approvalActor: expect.objectContaining({ user_id: "session-user-1" }),
    }));
  });

  it("refuses mutations without a session actor", async () => {
    getSessionUser.mockResolvedValue(null);
    await expect(POST(makeRequest("POST"), context as never)).rejects.toThrow("Authenticated session user required");
    expect(updateApprovalRequest).not.toHaveBeenCalled();
  });
});
