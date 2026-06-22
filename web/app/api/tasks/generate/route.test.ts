/**
 * @jest-environment node
 */

const checkAuth = jest.fn();
const enforceGuestWrites = jest.fn();
const createJob = jest.fn();
const getNamespaceIdFromRequest = jest.fn();
const getOrgIdFromRequest = jest.fn();
const getTaskSchema = jest.fn();
const getTemplate = jest.fn();
const resolveTemplate = jest.fn();
const getSessionUser = jest.fn();
const resolveAuthorizedWorkspacePath = jest.fn();
const startGenerationChainRun = jest.fn();
const createDecision = jest.fn();
const updateDecision = jest.fn();
const taskCreate = jest.fn();

jest.mock("@/lib/auth/api-auth", () => ({
  checkAuth: (...args: unknown[]) => checkAuth(...args),
}));

jest.mock("@/lib/middleware", () => ({
  enforceGuestWrites: (...args: unknown[]) => enforceGuestWrites(...args),
}));

jest.mock("@/lib/runs/job-store", () => ({
  createJob: (...args: unknown[]) => createJob(...args),
}));

jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: (...args: unknown[]) => getNamespaceIdFromRequest(...args),
  getOrgIdFromRequest: (...args: unknown[]) => getOrgIdFromRequest(...args),
}));

jest.mock("@/lib/schema-loader", () => ({
  getTaskSchema: (...args: unknown[]) => getTaskSchema(...args),
}));

jest.mock("@/lib/generation/generation-template-storage", () => ({
  getTemplate: (...args: unknown[]) => getTemplate(...args),
}));

jest.mock("@/lib/system/template-resolver", () => ({
  resolveTemplate: (...args: unknown[]) => resolveTemplate(...args),
}));

jest.mock("@/lib/auth/auth-bridge", () => ({
  getSessionUser: (...args: unknown[]) => getSessionUser(...args),
}));

jest.mock("@/lib/auth/workspace-auth", () => ({
  resolveAuthorizedWorkspacePath: (...args: unknown[]) => resolveAuthorizedWorkspacePath(...args),
}));

jest.mock("@/lib/generation/generation-chain-dispatch", () => ({
  startGenerationChainRun: (...args: unknown[]) => startGenerationChainRun(...args),
}));

jest.mock("@/lib/decisions/decision-storage", () => ({
  createDecision: (...args: unknown[]) => createDecision(...args),
  updateDecision: (...args: unknown[]) => updateDecision(...args),
}));

jest.mock("@/lib/tasks/task-store", () => ({
  taskCreate: (...args: unknown[]) => taskCreate(...args),
}));

import { POST } from "./route";

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost:3000/api/tasks/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/tasks/generate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    checkAuth.mockResolvedValue(true);
    enforceGuestWrites.mockResolvedValue(null);
    getNamespaceIdFromRequest.mockResolvedValue("default");
    getOrgIdFromRequest.mockResolvedValue("default");
    getTaskSchema.mockReturnValue("{}");
    getTemplate.mockReturnValue({ content: "{{USER_PROMPT}}" });
    resolveTemplate.mockImplementation((template: string, vars: Record<string, string>) =>
      template.replace("{{USER_PROMPT}}", vars.USER_PROMPT),
    );
    getSessionUser.mockResolvedValue({ id: "user-1" });
    resolveAuthorizedWorkspacePath.mockReturnValue("/repo");
    createJob.mockReturnValue({ id: "job-1", status: "pending" });
    startGenerationChainRun.mockResolvedValue({ runId: "run-1" });
    createDecision.mockReturnValue({
      id: "decision-1",
      status: "intake",
      prompt: "Decide the implementation approach",
      options: [],
    });
    updateDecision.mockImplementation(async (_ns, _org, _id, updates) => ({
      id: "decision-1",
      status: "intake",
      prompt: "Decide the implementation approach",
      options: [],
      ...updates,
    }));
    taskCreate.mockReturnValue({
      id: "DEC-001",
      parent_id: "EPIC-008",
      issue_type: "decision",
    });
  });

  it("creates a decision instead of a task job when routing is enabled and warranted", async () => {
    const res = await POST(makeRequest({
      prompt: "create a better git integration in the UI",
      workspacePath: "/repo",
      sendToDecisionIfWarranted: true,
    }) as Parameters<typeof POST>[0]);

    await expect(res.json()).resolves.toMatchObject({
      success: true,
      data: {
        routedTo: "decision",
        decisionId: "decision-1",
        taskId: "DEC-001",
      },
    });
    expect(createDecision).toHaveBeenCalledWith(
      "default",
      "default",
      expect.objectContaining({
        source: "task-generate",
        prompt: expect.stringContaining("create a better git integration in the UI"),
      }),
      "/repo",
    );
    expect(taskCreate).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({
        workspace_id: "/repo",
        issue_type: "decision",
        metadata: expect.objectContaining({
          decision_id: "decision-1",
          decision_status: "intake",
        }),
      }),
      "default",
    );
    expect(updateDecision).toHaveBeenCalledWith(
      "default",
      "default",
      "decision-1",
      expect.objectContaining({
        taskId: "DEC-001",
      }),
      "/repo",
    );
    expect(createJob).not.toHaveBeenCalled();
    expect(startGenerationChainRun).not.toHaveBeenCalled();
  });

  it("explicitly creates a decision task under the selected epic", async () => {
    const res = await POST(makeRequest({
      prompt: "decide whether EPIC-008 is ready to go live",
      workspacePath: "/repo",
      parentId: "EPIC-008",
      mode: "decision",
    }) as Parameters<typeof POST>[0]);

    await expect(res.json()).resolves.toMatchObject({
      success: true,
      data: {
        routedTo: "decision",
        decisionId: "decision-1",
        taskId: "DEC-001",
      },
    });
    expect(taskCreate).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({
        workspace_id: "/repo",
        issue_type: "decision",
        parent_id: "EPIC-008",
        title: "Decide the implementation approach for: decide whether EPIC-008 is ready to go live",
        metadata: expect.objectContaining({
          decision_id: "decision-1",
          decision_status: "intake",
          decision_parent_task_id: "EPIC-008",
        }),
      }),
      "default",
    );
    expect(createJob).not.toHaveBeenCalled();
    expect(startGenerationChainRun).not.toHaveBeenCalled();
  });

  it("starts the normal task generation job when routing is disabled", async () => {
    const res = await POST(makeRequest({
      prompt: "create a better git integration in the UI",
      workspacePath: "/repo",
      sendToDecisionIfWarranted: false,
    }) as Parameters<typeof POST>[0]);

    await expect(res.json()).resolves.toMatchObject({
      success: true,
      data: {
        jobId: "job-1",
        runId: "run-1",
      },
    });
    expect(createDecision).not.toHaveBeenCalled();
    expect(createJob).toHaveBeenCalled();
    expect(startGenerationChainRun).toHaveBeenCalled();
  });
});
