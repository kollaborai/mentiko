/**
 * @jest-environment node
 */

export {};

const mockCheckAuth = jest.fn().mockResolvedValue(true);
jest.mock("@/lib/api-auth", () => ({
  checkAuth: (...args: unknown[]) => mockCheckAuth(...args),
}));

const mockCreateJob = jest.fn().mockReturnValue({ id: "job-webhook", status: "pending" });
jest.mock("@/lib/job-store", () => ({
  createJob: (...args: unknown[]) => mockCreateJob(...args),
}));

const mockStartGenerationChainRun = jest.fn().mockResolvedValue({
  runId: "run-webhook",
  chainId: "webhook-generation",
  status: "started",
});
jest.mock("@/lib/generation-chain-dispatch", () => ({
  startGenerationChainRun: (...args: unknown[]) => mockStartGenerationChainRun(...args),
}));

const mockGetTemplate = jest.fn().mockReturnValue({ content: "prompt={{USER_PROMPT}} events={{MENTIKO_EVENTS}} ws={{WORKSPACE_CONTEXT}}" });
jest.mock("@/lib/generation-template-storage", () => ({
  getTemplate: (...args: unknown[]) => mockGetTemplate(...args),
}));

jest.mock("@/lib/template-resolver", () => ({
  resolveTemplate: (_template: string, vars: Record<string, string>) =>
    `prompt=${vars.USER_PROMPT} events=${vars.MENTIKO_EVENTS} ws=${vars.WORKSPACE_CONTEXT}`,
}));

jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: jest.fn().mockResolvedValue("default"),
  getOrgIdFromRequest: jest.fn().mockResolvedValue("default"),
}));

jest.mock("@/lib/auth-bridge", () => ({
  getSessionUser: jest.fn().mockResolvedValue({ id: "user-1" }),
}));

const mockResolveWorkspace = jest.fn((_namespaceId, _orgId, workspacePath) => workspacePath);
jest.mock("@/lib/workspace-auth", () => ({
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

describe("POST /api/webhooks/generate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("preserves inbound job type/template and starts webhook generation chain", async () => {
    const { POST } = await import("@/app/api/webhooks/generate/route");

    const response = await POST(makeRequest({
      prompt: "build inbound webhook parser",
      webhookType: "inbound",
      workspacePath: "/repo/app",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobId: "job-webhook",
      status: "pending",
    });
    expect(mockGetTemplate).toHaveBeenCalledWith("default", "default", "webhook_inbound");
    expect(mockCreateJob).toHaveBeenCalledWith(
      "webhook_inbound",
      expect.objectContaining({
        prompt: expect.stringContaining("build inbound webhook parser"),
        workspacePath: "/repo/app",
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
      kind: "webhook",
      job: expect.objectContaining({ id: "job-webhook" }),
      workspacePath: "/repo/app",
      prompt: expect.stringContaining("build inbound webhook parser"),
    }));
  });

  test("preserves outbound job type/template and response shape", async () => {
    const { POST } = await import("@/app/api/webhooks/generate/route");

    const response = await POST(makeRequest({
      prompt: "build outbound webhook sender",
      webhookType: "outbound",
      workspacePath: "/repo/app",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobId: "job-webhook",
      status: "pending",
    });
    expect(mockGetTemplate).toHaveBeenCalledWith("default", "default", "webhook_outbound");
    expect(mockCreateJob).toHaveBeenCalledWith(
      "webhook_outbound",
      expect.any(Object),
      undefined,
      undefined,
      "user-1",
      "default",
    );
  });
});
