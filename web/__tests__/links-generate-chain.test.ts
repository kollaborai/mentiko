/**
 * @jest-environment node
 */

export {};

const mockCheckAuth = jest.fn().mockResolvedValue(true);
jest.mock("@/lib/auth/api-auth", () => ({
  checkAuth: (...args: unknown[]) => mockCheckAuth(...args),
}));

const mockGetNamespaceId = jest.fn().mockResolvedValue("default");
const mockGetOrgId = jest.fn().mockResolvedValue("default");
jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: (...args: unknown[]) => mockGetNamespaceId(...args),
  getOrgIdFromRequest: (...args: unknown[]) => mockGetOrgId(...args),
}));

const mockGetTemplate = jest.fn().mockReturnValue({
  content: "prompt={{USER_PROMPT}}\nagents={{AGENT_CATALOG}}\nworkspace={{WORKSPACE_CONTEXT}}",
});
jest.mock("@/lib/generation/generation-template-storage", () => ({
  getTemplate: (...args: unknown[]) => mockGetTemplate(...args),
}));

const mockResolveTemplate = jest.fn().mockImplementation((_template: string, vars: Record<string, string>) => {
  let rendered = _template;
  for (const [key, value] of Object.entries(vars)) {
    rendered = rendered.replace(`{{${key}}}`, value || "");
  }
  return rendered;
});
jest.mock("@/lib/system/template-resolver", () => ({
  resolveTemplate: (...args: unknown[]) => mockResolveTemplate(...args),
}));

const mockCreateJob = jest.fn().mockReturnValue({
  id: "job-link",
  status: "pending",
});
jest.mock("@/lib/runs/job-store", () => ({
  createJob: (...args: unknown[]) => mockCreateJob(...args),
}));

const mockStartGenerationChainRun = jest.fn().mockResolvedValue({
  runId: "run-link",
  chainId: "link-generation",
  status: "started",
});
jest.mock("@/lib/generation/generation-chain-dispatch", () => ({
  startGenerationChainRun: (...args: unknown[]) => mockStartGenerationChainRun(...args),
}));

jest.mock("@/lib/agents/agent-catalog", () => ({
  buildAgentCatalog: () => 'agent id="agent-1" name="Researcher" role="Analyst"',
}));

jest.mock("@/lib/auth/auth-bridge", () => ({
  getSessionUser: jest.fn().mockResolvedValue({ id: "user-1" }),
}));

const mockResolveWorkspace = jest.fn((...args: unknown[]) => args[2]);
jest.mock("@/lib/auth/workspace-auth", () => ({
  resolveAuthorizedWorkspacePath: (...args: unknown[]) => mockResolveWorkspace(args[0], args[1], args[2], args[3]),
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

describe("POST /api/links/generate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates a link job and dispatches link-generation with compatible response", async () => {
    const { POST } = await import("@/app/api/links/generate/route");

    const response = await POST(makeRequest({
      prompt: "pair two specialists",
      workspacePath: "/repo/mentiko",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobId: "job-link",
      status: "pending",
    });
    expect(mockCreateJob).toHaveBeenCalledWith(
      "link",
      expect.objectContaining({
        prompt: expect.stringContaining("pair two specialists"),
        workspacePath: "/repo/mentiko",
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
      kind: "link",
      job: expect.objectContaining({ id: "job-link" }),
      workspacePath: "/repo/mentiko",
      prompt: expect.stringContaining("pair two specialists"),
    }));
  });
});
