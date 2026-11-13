const checkAuth = jest.fn();
const getNamespaceIdFromRequest = jest.fn();
const getOrgIdFromRequest = jest.fn();
const getWorkspacePath = jest.fn();
const getSessionUser = jest.fn();
const createDecision = jest.fn();

jest.mock("@/lib/auth/api-auth", () => ({ checkAuth: (...args: unknown[]) => checkAuth(...args) }));
jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: (...args: unknown[]) => getNamespaceIdFromRequest(...args),
  getOrgIdFromRequest: (...args: unknown[]) => getOrgIdFromRequest(...args),
}));
jest.mock("@/lib/workspaces/workspace-params", () => ({
  getWorkspacePath: (...args: unknown[]) => getWorkspacePath(...args),
}));
jest.mock("@/lib/auth/auth-bridge", () => ({
  getSessionUser: (...args: unknown[]) => getSessionUser(...args),
}));
jest.mock("@/lib/decisions/decision-storage", () => ({
  listDecisions: jest.fn(),
  createDecision: (...args: unknown[]) => createDecision(...args),
}));
jest.mock("@/lib/api-response", () => ({
  withErrorHandling: (handler: (...args: never[]) => unknown) => handler,
  apiSuccess: (data: unknown, _requestId?: string, status = 200) => ({ status, data }),
}));

import { POST } from "./route";

describe("POST /api/decisions actor provenance", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    checkAuth.mockResolvedValue(true);
    getNamespaceIdFromRequest.mockResolvedValue("default");
    getOrgIdFromRequest.mockResolvedValue("org-1");
    getWorkspacePath.mockReturnValue("/repo/app");
    getSessionUser.mockResolvedValue({
      id: "session-user-1",
      sessionId: "session-1",
      role: "member",
    });
    createDecision.mockReturnValue({ id: "decision-1" });
  });

  it("persists the authenticated session actor as createdBy", async () => {
    const request = {
      method: "POST",
      url: "http://localhost:3000/api/decisions",
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ prompt: "choose a path" }),
    } as never;

    const response = await POST(request) as { status: number };

    expect(response.status).toBe(201);
    expect(getSessionUser).toHaveBeenCalled();
    expect(createDecision).toHaveBeenCalledWith("default", "org-1", {
      prompt: "choose a path",
      createdBy: {
        user_id: "session-user-1",
        session_id: "session-1",
        org_role: "member",
      },
    }, "/repo/app");
  });
});
