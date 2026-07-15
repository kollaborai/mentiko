/**
 * @jest-environment node
 */

export {};

const mockCheckAuth = jest.fn().mockResolvedValue(true);
jest.mock("@/lib/auth/api-auth", () => ({
  checkAuth: (...args: unknown[]) => mockCheckAuth(...args),
}));

const mockEnforceGuestWrites = jest.fn().mockResolvedValue(null);
jest.mock("@/lib/middleware", () => ({
  enforceGuestWrites: (...args: unknown[]) => mockEnforceGuestWrites(...args),
}));

const mockStartGenerationJob = jest.fn().mockResolvedValue({
  jobId: "job-task",
  runId: "run-task",
  status: "pending",
});
jest.mock("@/lib/generation/generation-chain-dispatch", () => ({
  startGenerationJob: (...args: unknown[]) => mockStartGenerationJob(...args),
}));

jest.mock("@/lib/schema-loader", () => ({
  getTaskSchema: () => '{"type":"object"}',
}));

jest.mock("@/lib/generation/generation-template-storage", () => ({
  getTemplate: () => ({ content: "prompt={{USER_PROMPT}} schema={{SCHEMA}} ws={{WORKSPACE_CONTEXT}}" }),
}));

jest.mock("@/lib/system/template-resolver", () => ({
  resolveTemplate: (_template: string, vars: Record<string, string>) =>
    `prompt=${vars.USER_PROMPT} schema=${vars.SCHEMA} ws=${vars.WORKSPACE_CONTEXT}`,
}));

jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: jest.fn().mockResolvedValue("default"),
  getOrgIdFromRequest: jest.fn().mockResolvedValue("default"),
}));

jest.mock("@/lib/auth/auth-bridge", () => ({
  getSessionUser: jest.fn().mockResolvedValue({ id: "user-1" }),
}));

const mockResolveWorkspace = jest.fn((_namespaceId, _orgId, workspacePath) => workspacePath);
jest.mock("@/lib/auth/workspace-auth", () => ({
  resolveAuthorizedWorkspacePath: (...args: unknown[]) => mockResolveWorkspace(args[0], args[1], args[2]),
}));

jest.mock("@/lib/api-response", () => ({
  withErrorHandling: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  apiSuccess: (data: unknown) => ({ status: 200, json: async () => data }),
}));

jest.mock("@/lib/api-errors", () => ({
  BadRequest: class BadRequest extends Error {
    constructor(message: string) { super(message); }
  },
  Unauthorized: class Unauthorized extends Error {},
}));

function makeRequest(body: Record<string, unknown>) {
  return {
    json: () => Promise.resolve(body),
    nextUrl: { origin: "http://localhost:3000" },
  } as never;
}

describe("POST /api/tasks/generate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("starts the task generation core chain and preserves the job response shape", async () => {
    const { POST } = await import("@/app/api/tasks/generate/route");

    const response = await POST(makeRequest({
      prompt: "make a UI proof task",
      workspacePath: "/repo/app",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobId: "job-task",
      runId: "run-task",
      status: "pending",
    });
    expect(mockStartGenerationJob).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.anything(),
      namespaceId: "default",
      orgId: "default",
      kind: "task",
      workspacePath: "/repo/app",
      prompt: expect.stringContaining("make a UI proof task"),
      userId: "user-1",
    }));
  });

  test("stores parent and auto-run selection on the generation job", async () => {
    const { POST } = await import("@/app/api/tasks/generate/route");

    const response = await POST(makeRequest({
      prompt: "make a child task",
      workspacePath: "/repo/app",
      parentId: "EPIC-001",
      autoRun: true,
    }));

    expect(response.status).toBe(200);
    expect(mockStartGenerationJob).toHaveBeenCalledWith(expect.objectContaining({
      jobInput: expect.objectContaining({
        parentId: "EPIC-001",
        autoRun: true,
      }),
    }));
  });
});
