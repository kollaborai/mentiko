/**
 * @jest-environment node
 */

export {};

const mockCheckAuth = jest.fn().mockResolvedValue(true);
jest.mock("@/lib/auth/api-auth", () => ({
  checkAuth: (...args: unknown[]) => mockCheckAuth(...args),
}));

const mockCreateJob = jest.fn().mockReturnValue({ id: "job-1", status: "pending", type: "artifact" });
jest.mock("@/lib/runs/job-store", () => ({
  createJob: (...args: unknown[]) => mockCreateJob(...args),
}));

const mockStartGenerationChainRun = jest.fn().mockResolvedValue({
  runId: "run-1",
  chainId: "artifact-generation",
  status: "started",
});
jest.mock("@/lib/generation/generation-chain-dispatch", () => ({
  startGenerationChainRun: (...args: unknown[]) => mockStartGenerationChainRun(...args),
}));

jest.mock("@/lib/generation/generation-template-storage", () => ({
  getTemplate: () => ({ content: "prompt={{USER_PROMPT}} ws={{WORKSPACE_CONTEXT}} schema={{SCHEMA}}" }),
}));

jest.mock("@/lib/system/template-resolver", () => ({
  resolveTemplate: (template: string, vars: Record<string, string>) =>
    `${template}\nprompt=${vars.USER_PROMPT} ws=${vars.WORKSPACE_CONTEXT ?? ""} schema=${vars.SCHEMA ?? ""}`,
}));

jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: jest.fn().mockResolvedValue("default"),
  getOrgIdFromRequest: jest.fn().mockResolvedValue("default"),
}));

jest.mock("@/lib/auth/auth-bridge", () => ({
  getSessionUser: jest.fn().mockResolvedValue({ id: "user-1" }),
}));

jest.mock("@/lib/agents/agent-catalog", () => ({
  buildAgentCatalog: () => "agent-catalog-entry",
}));

jest.mock("@/lib/agents/profile-catalog", () => ({
  buildProfileCatalog: () => "profile-catalog-entry",
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

describe("worker c generation route migrations", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateJob.mockReturnValue({ id: "job-1", status: "pending", type: "artifact" });
  });

  test("POST /api/artifact-templates/generate keeps artifact job type and dispatches artifact chain kind", async () => {
    const { POST } = await import("@/app/api/artifact-templates/generate/route");

    const response = await POST(makeRequest({
      prompt: "generate a release note artifact",
      workspacePath: "/repo/project",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobId: "job-1",
      status: "pending",
    });
    expect(mockCreateJob).toHaveBeenCalledWith(
      "artifact",
      expect.objectContaining({
        prompt: expect.stringContaining("generate a release note artifact"),
        workspacePath: "/repo/project",
      }),
      undefined,
      undefined,
      "user-1",
      "default",
    );
    expect(mockStartGenerationChainRun).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.anything(),
      namespaceId: "default",
      orgId: "default",
      kind: "artifact",
      job: expect.objectContaining({ id: "job-1" }),
      workspacePath: "/repo/project",
      prompt: expect.stringContaining("generate a release note artifact"),
    }));
  });

  test("POST /api/generation-templates/test keeps template_test job type and dispatches template test chain kind", async () => {
    mockCreateJob.mockReturnValue({ id: "job-template", status: "pending", type: "template_test" });
    const { POST } = await import("@/app/api/generation-templates/test/route");

    const response = await POST(makeRequest({
      content: "draft={{USER_PROMPT}} {{WORKSPACE_CONTEXT}}",
      templateId: "chain_recommendation",
      prompt: "raw output is allowed",
      workspacePath: "/repo/project",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobId: "job-template",
    });
    expect(mockCreateJob).toHaveBeenCalledWith(
      "template_test",
      expect.objectContaining({
        prompt: expect.stringContaining("raw output is allowed"),
        workspacePath: "/repo/project",
      }),
      undefined,
      undefined,
      "user-1",
      "default",
    );
    expect(mockStartGenerationChainRun).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.anything(),
      namespaceId: "default",
      orgId: "default",
      kind: "template_test",
      job: expect.objectContaining({ id: "job-template" }),
      workspacePath: "/repo/project",
      prompt: expect.stringContaining("raw output is allowed"),
    }));
    expect(mockCreateJob).toHaveBeenCalledWith(
      "template_test",
      expect.objectContaining({
        prompt: expect.stringContaining("TASK_LINKED_CHAIN_RUNTIME"),
      }),
      undefined,
      undefined,
      "user-1",
      "default",
    );
  });
});
