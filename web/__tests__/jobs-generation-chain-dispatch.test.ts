/**
 * @jest-environment node
 */

export {};

const mockCheckAuth = jest.fn().mockResolvedValue(true);
jest.mock("@/lib/api-auth", () => ({
  checkAuth: (...args: unknown[]) => mockCheckAuth(...args),
}));

const mockCreateJob = jest.fn().mockReturnValue({ id: "job-1", status: "pending" });
const mockListJobs = jest.fn().mockReturnValue([]);
const mockCleanupOldJobs = jest.fn();
jest.mock("@/lib/job-store", () => ({
  createJob: (...args: unknown[]) => mockCreateJob(...args),
  listJobs: (...args: unknown[]) => mockListJobs(...args),
  cleanupOldJobs: (...args: unknown[]) => mockCleanupOldJobs(...args),
}));

jest.mock("@/lib/auth-bridge", () => ({
  getSessionUser: jest.fn().mockResolvedValue({ id: "user-1" }),
}));

jest.mock("@/lib/config", () => ({
  __esModule: true,
  default: { chainsDir: "/tmp/chains" },
}));

jest.mock("node:fs", () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readdirSync: jest.fn(),
  readFileSync: jest.fn(),
}));

jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: jest.fn().mockResolvedValue("default"),
  getOrgIdFromRequest: jest.fn().mockResolvedValue("default"),
}));

jest.mock("@/lib/generation-template-storage", () => ({
  getTemplate: (_namespaceId: string, _orgId: string, key: string) => ({
    content:
      key === "chain_recommendation"
        ? "recommend {{TASK_CONTEXT}} {{CHAIN_CATALOG}} {{WORKSPACE_CONTEXT}}"
        : "generate {{USER_PROMPT}} {{SCHEMA}} {{WORKSPACE_CONTEXT}}",
  }),
}));

jest.mock("@/lib/template-resolver", () => ({
  resolveTemplate: (template: string, vars: Record<string, string>) => {
    let out = template;
    for (const [k, v] of Object.entries(vars)) out = out.replace(`{{${k}}}`, v || "");
    return out;
  },
}));

jest.mock("@/lib/schema-loader", () => ({
  getChainSchema: () => '{"type":"object"}',
}));

jest.mock("@/lib/task-store", () => ({
  taskGet: jest.fn().mockReturnValue(null),
  taskUpdate: jest.fn(),
}));

const mockStartGenerationChainRun = jest.fn().mockResolvedValue({
  runId: "run-1",
  chainId: "core-chain",
  status: "started",
});
jest.mock("@/lib/generation-chain-dispatch", () => ({
  startGenerationChainRun: (...args: unknown[]) => mockStartGenerationChainRun(...args),
}));

jest.mock("@/lib/workspace-auth", () => ({
  resolveAuthorizedWorkspacePath: jest.fn().mockReturnValue("/repo/ws"),
}));

jest.mock("@/lib/job-runner-launch", () => ({
  resolveJobWorkspaceCwd: jest.fn().mockReturnValue(undefined),
}));

jest.mock("@/lib/api-response", () => ({
  withErrorHandling: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  apiSuccess: (data: unknown) => ({ status: 200, json: async () => data }),
}));

jest.mock("@/lib/api-errors", () => ({
  Unauthorized: class Unauthorized extends Error {},
  BadRequest: class BadRequest extends Error {
    constructor(message: string) {
      super(message);
    }
  },
}));

function makeRequest(body: Record<string, unknown>) {
  return {
    url: "http://localhost:3000/api/jobs",
    json: () => Promise.resolve(body),
  } as unknown as Request;
}

describe("POST /api/jobs chain dispatch migration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("type recommend keeps job type and dispatches chain_recommendation", async () => {
    const { POST } = await import("@/app/api/jobs/route");
    const response = await POST(
      makeRequest({
        type: "recommend",
        input: {
          chainCatalog: "chain_id: c1",
          task: { title: "Ship v1" },
        },
      }) as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobId: "job-1",
      runId: "run-1",
      chainId: "core-chain",
      status: "pending",
    });
    expect(mockCreateJob).toHaveBeenCalledWith(
      "recommend",
      expect.objectContaining({ chainCatalog: "chain_id: c1" }),
      undefined,
      undefined,
      "user-1",
      "default",
    );
    expect(mockStartGenerationChainRun).toHaveBeenCalledWith(expect.objectContaining({
      kind: "chain_recommendation",
      job: expect.objectContaining({ id: "job-1" }),
      prompt: expect.stringContaining("recommend"),
      workspacePath: "/repo/ws",
    }));
  });

  test("type generate keeps job type and dispatches chain_generation", async () => {
    const { POST } = await import("@/app/api/jobs/route");
    const response = await POST(
      makeRequest({
        type: "generate",
        taskId: "TASK-1",
        input: { userPrompt: "create a pipeline chain" },
      }) as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobId: "job-1",
      runId: "run-1",
      chainId: "core-chain",
      status: "pending",
    });
    expect(mockCreateJob).toHaveBeenCalledWith(
      "generate",
      expect.anything(),
      "TASK-1",
      undefined,
      "user-1",
      "default",
    );
    expect(mockStartGenerationChainRun).toHaveBeenCalledWith(expect.objectContaining({
      kind: "chain_generation",
      taskId: "TASK-1",
      job: expect.objectContaining({ id: "job-1" }),
      prompt: expect.stringContaining("create a pipeline chain"),
      workspacePath: "/repo/ws",
    }));
  });
});
