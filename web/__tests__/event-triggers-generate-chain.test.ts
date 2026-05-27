/**
 * @jest-environment node
 */

export {};

const mockCheckAuth = jest.fn().mockResolvedValue(true);
jest.mock("@/lib/api-auth", () => ({
  checkAuth: (...args: unknown[]) => mockCheckAuth(...args),
}));

const mockCreateJob = jest.fn().mockReturnValue({ id: "job-event-trigger", status: "pending" });
jest.mock("@/lib/job-store", () => ({
  createJob: (...args: unknown[]) => mockCreateJob(...args),
}));

const mockStartGenerationChainRun = jest.fn().mockResolvedValue({
  runId: "run-event-trigger",
  chainId: "event-trigger-generation",
  status: "started",
});
jest.mock("@/lib/generation-chain-dispatch", () => ({
  startGenerationChainRun: (...args: unknown[]) => mockStartGenerationChainRun(...args),
}));

const mockGetTemplate = jest.fn().mockReturnValue({ content: "prompt={{USER_PROMPT}} catalog={{CHAIN_CATALOG}} ws={{WORKSPACE_CONTEXT}}" });
jest.mock("@/lib/generation-template-storage", () => ({
  getTemplate: (...args: unknown[]) => mockGetTemplate(...args),
}));

jest.mock("@/lib/template-resolver", () => ({
  resolveTemplate: (_template: string, vars: Record<string, string>) =>
    `prompt=${vars.USER_PROMPT} catalog=${vars.CHAIN_CATALOG} ws=${vars.WORKSPACE_CONTEXT}`,
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

describe("POST /api/events/triggers/generate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("preserves event_trigger job type and starts event_trigger generation chain", async () => {
    const { POST } = await import("@/app/api/events/triggers/generate/route");

    const response = await POST(makeRequest({
      prompt: "create a trigger for issue opened",
      chainNames: ["triage-chain", "notify-chain"],
      workspacePath: "/repo/app",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobId: "job-event-trigger",
      status: "pending",
    });
    expect(mockGetTemplate).toHaveBeenCalledWith("default", "default", "event_trigger");
    expect(mockCreateJob).toHaveBeenCalledWith(
      "event_trigger",
      expect.objectContaining({
        prompt: expect.stringContaining("create a trigger for issue opened"),
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
      kind: "event_trigger",
      job: expect.objectContaining({ id: "job-event-trigger" }),
      workspacePath: "/repo/app",
      prompt: expect.stringContaining("create a trigger for issue opened"),
    }));
  });
});
