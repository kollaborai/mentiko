const checkAuth = jest.fn();
const getNamespaceIdFromRequest = jest.fn();
const getOrgIdFromRequest = jest.fn();
const getWorkspaceId = jest.fn();
const getWorkspacePath = jest.fn();
const getSessionUser = jest.fn();
const resolveDecisionToTasks = jest.fn();

jest.mock("@/lib/auth/api-auth", () => ({ checkAuth: (...args: unknown[]) => checkAuth(...args) }));
jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: (...args: unknown[]) => getNamespaceIdFromRequest(...args),
  getOrgIdFromRequest: (...args: unknown[]) => getOrgIdFromRequest(...args),
}));
jest.mock("@/lib/workspaces/workspace-params", () => ({
  getWorkspaceId: (...args: unknown[]) => getWorkspaceId(...args),
  getWorkspacePath: (...args: unknown[]) => getWorkspacePath(...args),
}));
jest.mock("@/lib/auth/auth-bridge", () => ({ getSessionUser: (...args: unknown[]) => getSessionUser(...args) }));
jest.mock("@/lib/decisions/decision-resolution", () => ({
  resolveDecisionToTasks: (...args: unknown[]) => resolveDecisionToTasks(...args),
}));
jest.mock("@/lib/api-response", () => ({
  withErrorHandling: (handler: (...args: never[]) => unknown) => handler,
  apiSuccess: (data: unknown) => ({ status: 200, data }),
}));

import { POST } from "./route";

function makeRequest(body: Record<string, unknown>) {
  return {
    method: "POST",
    url: "http://localhost:3000/api/decisions/decision-1/resolve",
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
  } as never;
}

const context = { params: Promise.resolve({ id: "decision-1" }) };

describe("POST /api/decisions/[id]/resolve actor provenance", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    checkAuth.mockResolvedValue(true);
    getNamespaceIdFromRequest.mockResolvedValue("default");
    getOrgIdFromRequest.mockResolvedValue("org-1");
    getWorkspaceId.mockReturnValue(undefined);
    getWorkspacePath.mockReturnValue("/repo/app");
    getSessionUser.mockResolvedValue({
      id: "session-user-1",
      sessionId: "session-1",
      role: "member",
      authMethod: "better-auth",
    });
    resolveDecisionToTasks.mockResolvedValue({ decision: { id: "decision-1" }, taskId: "TASK-001", taskIds: ["TASK-001"] });
  });

  it("records the real session user for a human resolve", async () => {
    const response = await POST(makeRequest({ selectedOptionId: "opt-a" }), context as never) as { status: number };

    expect(response.status).toBe(200);
    expect(getSessionUser).toHaveBeenCalled();
    expect(resolveDecisionToTasks).toHaveBeenCalledWith(expect.objectContaining({
      actor: { user_id: "session-user-1", session_id: "session-1", org_role: "member" },
      channel: "human",
    }));
  });

  it("labels trusted workspace auto-approval separately while keeping the real actor", async () => {
    getSessionUser.mockResolvedValue({
      id: "service-user",
      role: "member",
      authMethod: "internal-service",
    });

    await POST(makeRequest({ selectedOptionId: "opt-a", autoApprovedByWorkspacePolicy: true }), context as never);

    expect(resolveDecisionToTasks).toHaveBeenCalledWith(expect.objectContaining({
      actor: { user_id: "service-user", org_role: "member" },
      channel: "workspace-auto-approve",
    }));
  });

  it("does not let a human caller label an approval as workspace auto-approved", async () => {
    await POST(makeRequest({ selectedOptionId: "opt-a", autoApprovedByWorkspacePolicy: true }), context as never);

    expect(resolveDecisionToTasks).toHaveBeenCalledWith(expect.objectContaining({ channel: "human" }));
  });
});
