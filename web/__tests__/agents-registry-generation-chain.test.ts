/**
 * @jest-environment node
 */

import { readFileSync } from "node:fs";

export {};

const mockCheckAuth = jest.fn().mockResolvedValue(true);
jest.mock("@/lib/api-auth", () => ({
  checkAuth: (...args: unknown[]) => mockCheckAuth(...args),
}));

const mockCreateJob = jest.fn();
jest.mock("@/lib/job-store", () => ({
  createJob: (...args: unknown[]) => mockCreateJob(...args),
}));

const mockStartGenerationChainRun = jest.fn().mockResolvedValue({
  runId: "run-agent",
  chainId: "agent-generation",
  status: "started",
});
jest.mock("@/lib/generation-chain-dispatch", () => ({
  startGenerationChainRun: (...args: unknown[]) => mockStartGenerationChainRun(...args),
}));

jest.mock("@/lib/schema-loader", () => ({
  getAgentSchema: () => '{"type":"object"}',
}));

const mockGetTemplate = jest.fn();
jest.mock("@/lib/generation-template-storage", () => ({
  getTemplate: (...args: unknown[]) => mockGetTemplate(...args),
}));

const mockResolveTemplate = jest.fn();
jest.mock("@/lib/template-resolver", () => ({
  resolveTemplate: (...args: unknown[]) => mockResolveTemplate(...args),
}));

jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: jest.fn().mockResolvedValue("default"),
  getOrgIdFromRequest: jest.fn().mockResolvedValue("org-1"),
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
  InternalServerError: class InternalServerError extends Error {
    constructor(message: string) { super(message); }
  },
}));

function makeRequest(body: Record<string, unknown>) {
  return {
    json: () => Promise.resolve(body),
    nextUrl: { origin: "http://localhost:3000" },
  } as never;
}

describe("agent registry generation routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateJob.mockReturnValue({ id: "job-1", status: "pending" });
    mockGetTemplate.mockReturnValue({ content: "template" });
    mockResolveTemplate.mockImplementation((_template: string, vars: Record<string, string>) =>
      vars.USER_PROMPT || vars.USER_INSTRUCTIONS || "",
    );
  });

  test("generate route preserves job type and dispatches core chain with kind agent", async () => {
    const { POST } = await import("@/app/api/agents/registry/generate/route");
    const response = await POST(makeRequest({
      prompt: "build a release engineer agent",
      workspacePath: "/repo/app",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobId: "job-1",
      status: "pending",
    });
    expect(mockCreateJob).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        prompt: expect.stringContaining("build a release engineer agent"),
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
      orgId: "org-1",
      kind: "agent",
      job: expect.objectContaining({ id: "job-1" }),
      prompt: expect.stringContaining("build a release engineer agent"),
      workspacePath: "/repo/app",
    }));
  });

  test("edit route preserves job type and dispatches core chain with kind agent_edit", async () => {
    const { POST } = await import("@/app/api/agents/registry/edit/route");
    const response = await POST(makeRequest({
      agentJson: { name: "Helper", prompt: "Do work" },
      instructions: "make it stricter",
      workspacePath: "/repo/worker",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobId: "job-1",
      status: "pending",
    });
    expect(mockCreateJob).toHaveBeenCalledWith(
      "agent_edit",
      expect.objectContaining({
        prompt: expect.stringContaining("make it stricter"),
        workspacePath: "/repo/worker",
      }),
      undefined,
      undefined,
      "user-1",
      "default",
    );
    expect(mockStartGenerationChainRun).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.anything(),
      namespaceId: "default",
      orgId: "org-1",
      kind: "agent_edit",
      job: expect.objectContaining({ id: "job-1" }),
      prompt: expect.stringContaining("make it stricter"),
      workspacePath: "/repo/worker",
    }));
  });

  test("routes no longer reference launchJobRunner", () => {
    const generateSource = readFileSync("app/api/agents/registry/generate/route.ts", "utf8");
    const editSource = readFileSync("app/api/agents/registry/edit/route.ts", "utf8");

    expect(generateSource).not.toContain("launchJobRunner");
    expect(editSource).not.toContain("launchJobRunner");
  });
});
