/**
 * @jest-environment node
 *
 * Tests for POST /api/chains/recommend
 * - profile catalog injection into generation prompt
 * - direct workspacePath param
 */

import { POST } from "@/app/api/chains/recommend/route";

// ---- mocks ----------------------------------------------------------------

const mockCheckAuth = jest.fn().mockResolvedValue(true);
jest.mock("@/lib/auth/api-auth", () => ({
  checkAuth: (...args: unknown[]) => mockCheckAuth(...args),
}));

const mockGetNamespaceId = jest.fn().mockReturnValue("default");
const mockGetOrgId = jest.fn().mockReturnValue("default");
jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: (...args: unknown[]) => mockGetNamespaceId(...args),
  getOrgIdFromRequest: (...args: unknown[]) => mockGetOrgId(...args),
}));

const mockSessionUser = jest.fn().mockReturnValue({ id: "user-1" });
jest.mock("@/lib/auth/auth-bridge", () => ({
  getSessionUser: (...args: unknown[]) => mockSessionUser(...args),
}));

jest.mock("@/lib/schema-loader", () => ({
  getChainSchema: () => '{"type": "object"}',
}));

const mockTemplate = { content: "USER: {{USER_PROMPT}}\nAGENTS: {{AGENT_CATALOG}}\nPROFILES: {{PROFILE_CATALOG}}\nWS: {{WORKSPACE_CONTEXT}}" };
jest.mock("@/lib/generation/generation-template-storage", () => ({
  getTemplate: () => mockTemplate,
}));

jest.mock("@/lib/system/template-resolver", () => ({
  resolveTemplate: (_t: string, vars: Record<string, string>) => {
    let result = _t;
    for (const [k, v] of Object.entries(vars)) {
      result = result.replace(`{{${k}}}`, v || "");
    }
    return result;
  },
}));

const mockCreateJob = jest.fn().mockReturnValue({ id: "job-123", status: "running" });
const mockDeleteJob = jest.fn().mockReturnValue(true);
jest.mock("@/lib/runs/job-store", () => ({
  createJob: (...args: unknown[]) => mockCreateJob(...args),
  deleteJob: (...args: unknown[]) => mockDeleteJob(...args),
}));

const mockStartGenerationChainRun = jest.fn().mockResolvedValue({
  runId: "run-123",
  chainId: "chain-generation",
  status: "started",
});
jest.mock("@/lib/generation/generation-chain-dispatch", () => ({
  startGenerationChainRun: (...args: unknown[]) => mockStartGenerationChainRun(...args),
}));

const mockAgentCatalog = "AGENT_CATALOG_DATA";
jest.mock("@/lib/agents/agent-catalog", () => ({
  buildAgentCatalog: () => mockAgentCatalog,
}));

const mockProfileCatalog = "PROFILE_CATALOG_DATA";
jest.mock("@/lib/agents/profile-catalog", () => ({
  buildProfileCatalog: () => mockProfileCatalog,
}));

const mockResolveWorkspace = jest.fn().mockReturnValue("/ws/path");
jest.mock("@/lib/auth/workspace-auth", () => ({
  resolveAuthorizedWorkspacePath: (...args: unknown[]) => mockResolveWorkspace(...args),
}));

jest.mock("@/lib/api-response", () => ({
  withErrorHandling: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  apiSuccess: (data: unknown) => ({ json: () => data, status: 200 }),
}));

jest.mock("@/lib/api-errors", () => ({
  BadRequest: class extends Error { constructor(m: string) { super(m); } },
  Unauthorized: class extends Error { constructor() { super(); } },
  NotFound: class extends Error { constructor(m: string) { super(m); } },
  InternalServerError: class extends Error { constructor(m: string) { super(m); } },
}));

const mockTaskGet = jest.fn().mockReturnValue(null);
const mockTaskUpdate = jest.fn();
jest.mock("@/lib/tasks/task-store", () => ({
  taskGet: (...args: unknown[]) => mockTaskGet(...args),
  taskUpdate: (...args: unknown[]) => mockTaskUpdate(...args),
}));

// ---- tests ----------------------------------------------------------------

function makeRequest(body: Record<string, unknown>) {
  return {
    json: () => Promise.resolve(body),
    nextUrl: { origin: "http://localhost:3000" },
  } as unknown as Parameters<typeof POST>[0];
}

describe("POST /api/chains/recommend", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTaskGet.mockReset();
    mockTaskUpdate.mockReset();
    mockTaskGet.mockReturnValue(null);
  });

  it("injects profile catalog into generation prompt", async () => {
    await POST(makeRequest({ prompt: "build me a chain" }));

    const jobArg = mockCreateJob.mock.calls[0][1] as { prompt: string };
    expect(jobArg.prompt).toContain("PROFILE_CATALOG_DATA");
    expect(jobArg.prompt).toContain("AGENT_CATALOG_DATA");
  });

  it("accepts direct workspacePath param", async () => {
    await POST(makeRequest({ prompt: "build me a chain", workspacePath: "/my/workspace" }));

    expect(mockResolveWorkspace).toHaveBeenCalledWith(
      "default", "default", "/my/workspace", "user-1"
    );
  });

  it("prefers task.workspace_id over stale metadata workspace_path", async () => {
    mockTaskGet
      .mockReturnValueOnce({
        id: "TASK-1",
        workspace_id: "/repo/live",
        metadata: { workspace_path: "/repo/stale" },
      })
      .mockReturnValueOnce({
        id: "TASK-1",
        workspace_id: "/repo/live",
        metadata: { workspace_path: "/repo/stale", generation_job_id: "job-123" },
      });

    await POST(makeRequest({ prompt: "build me a chain", taskId: "TASK-1" }));

    expect(mockResolveWorkspace).toHaveBeenCalledWith(
      "default", "default", "/repo/live", "user-1"
    );
  });

  it("requires prompt", async () => {
    await expect(POST(makeRequest({}))).rejects.toThrow("prompt is required");
  });

  it("creates job with type generate", async () => {
    await POST(makeRequest({ prompt: "build me a chain" }));

    expect(mockCreateJob).toHaveBeenCalledWith(
      "generate",
      expect.anything(),
      undefined,
      undefined,
      "user-1",
      "default",
    );
    expect(mockStartGenerationChainRun).toHaveBeenCalledWith(expect.objectContaining({
      namespaceId: "default",
      orgId: "default",
      kind: "chain_generation",
      job: expect.objectContaining({ id: "job-123" }),
      prompt: expect.stringContaining("build me a chain"),
      workspacePath: "/ws/path",
    }));
  });

  it("preserves response shape compatibility", async () => {
    const response = await POST(makeRequest({ prompt: "build me a chain" }));

    expect(response.status).toBe(200);
    expect(response.json()).toEqual({
      jobId: "job-123",
      runId: "run-123",
      chainId: "chain-generation",
      status: "running",
    });
  });
});
