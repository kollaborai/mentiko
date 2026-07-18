/**
 * @jest-environment node
 *
 * POST /api/tasks/generate — agent-as-gate contract:
 *  - mode "task" (default): start a generation job (the agent gates
 *    task-vs-decision async). No pre-flight heuristic routing.
 *  - mode "decision": createTaskDecision directly.
 *  - sendToDecisionIfWarranted (default on) toggles allowDecisionRouting,
 *    threaded into the job + the ALLOW_DECISION_ROUTING template var.
 */

const checkAuth = jest.fn();
const enforceGuestWrites = jest.fn();
const getNamespaceIdFromRequest = jest.fn();
const getOrgIdFromRequest = jest.fn();
const getTaskSchema = jest.fn();
const getTemplate = jest.fn();
const resolveTemplate = jest.fn();
const getSessionUser = jest.fn();
const resolveAuthorizedWorkspacePath = jest.fn();
const startGenerationJob = jest.fn();
const createDecision = jest.fn();
const updateDecision = jest.fn();
const taskCreate = jest.fn();
const taskGet = jest.fn();
const listWorkspaces = jest.fn();
const resolveTaskAutoRunDefault = jest.fn();

jest.mock("@/lib/auth/api-auth", () => ({ checkAuth: (...a: unknown[]) => checkAuth(...a) }));
jest.mock("@/lib/middleware", () => ({ enforceGuestWrites: (...a: unknown[]) => enforceGuestWrites(...a) }));
jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: (...a: unknown[]) => getNamespaceIdFromRequest(...a),
  getOrgIdFromRequest: (...a: unknown[]) => getOrgIdFromRequest(...a),
}));
jest.mock("@/lib/schema-loader", () => ({ getTaskSchema: (...a: unknown[]) => getTaskSchema(...a) }));
jest.mock("@/lib/generation/generation-template-storage", () => ({ getTemplate: (...a: unknown[]) => getTemplate(...a) }));
jest.mock("@/lib/system/template-resolver", () => ({ resolveTemplate: (...a: unknown[]) => resolveTemplate(...a) }));
jest.mock("@/lib/auth/auth-bridge", () => ({ getSessionUser: (...a: unknown[]) => getSessionUser(...a) }));
jest.mock("@/lib/auth/workspace-auth", () => ({
  resolveAuthorizedWorkspacePath: (...a: unknown[]) => resolveAuthorizedWorkspacePath(...a),
}));
jest.mock("@/lib/generation/generation-chain-dispatch", () => ({
  startGenerationJob: (...a: unknown[]) => startGenerationJob(...a),
}));
jest.mock("@/lib/tasks/task-auto-run-default", () => ({
  resolveTaskAutoRunDefault: (...a: unknown[]) => resolveTaskAutoRunDefault(...a),
}));
// createTaskDecision (real) calls these mocked internals in decision mode:
jest.mock("@/lib/decisions/decision-storage", () => ({
  createDecision: (...a: unknown[]) => createDecision(...a),
  updateDecision: (...a: unknown[]) => updateDecision(...a),
}));
jest.mock("@/lib/tasks/task-store", () => ({
  taskCreate: (...a: unknown[]) => taskCreate(...a),
  taskGet: (...a: unknown[]) => taskGet(...a),
}));
// createTaskDecision (real, via task-decision-link.ts) resolves the parent
// task's workspace scope through taskGet + listWorkspaces before creating
// the decision task -- mock both so decision mode doesn't hit the real
// task store / workspace file storage.
jest.mock("@/lib/workspaces/workspace-storage", () => ({
  listWorkspaces: (...a: unknown[]) => listWorkspaces(...a),
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
    getTemplate.mockReturnValue({ content: "{{USER_PROMPT}}{{ALLOW_DECISION_ROUTING}}" });
    resolveTemplate.mockImplementation((_t: string, vars: Record<string, string>) =>
      (vars.USER_PROMPT ?? "") + (vars.ALLOW_DECISION_ROUTING ?? ""),
    );
    getSessionUser.mockResolvedValue({ id: "user-1" });
    resolveAuthorizedWorkspacePath.mockReturnValue("/repo");
    resolveTaskAutoRunDefault.mockReturnValue(true);
    startGenerationJob.mockResolvedValue({ jobId: "job-1", runId: "run-1", status: "pending" });
    createDecision.mockReturnValue({ id: "decision-1", status: "intake", prompt: "x", options: [] });
    updateDecision.mockImplementation(async (_ns: unknown, _org: unknown, _id: unknown, updates: unknown) => ({
      id: "decision-1", status: "intake", prompt: "x", options: [], ...(updates as object),
    }));
    taskCreate.mockReturnValue({ id: "DEC-001", parent_id: null, issue_type: "decision" });
    taskGet.mockImplementation((_orgId: unknown, id: string) => (
      id === "EPIC-008" ? { id, workspace_id: "/repo", issue_type: "epic", parent_id: null, metadata: {} } : null
    ));
    listWorkspaces.mockReturnValue([{ id: "repo", path: "/repo" }]);
  });

  it("task mode starts a generation job — no pre-flight decision routing (agent gates async)", async () => {
    const res = await POST(makeRequest({
      prompt: "create a better git integration in the UI", // strategic, but no pre-flight
      workspacePath: "/repo",
      sendToDecisionIfWarranted: true,
    }) as Parameters<typeof POST>[0]);

    await expect(res.json()).resolves.toMatchObject({
      success: true,
      data: { jobId: "job-1", runId: "run-1", status: "pending" },
    });
    expect(startGenerationJob).toHaveBeenCalledTimes(1);
    expect(startGenerationJob.mock.calls[0][0]).toMatchObject({
      kind: "task", workspacePath: "/repo", userId: "user-1",
    });
    expect(resolveTaskAutoRunDefault).toHaveBeenCalledWith({
      namespaceId: "default",
      orgId: "default",
      workspacePath: "/repo",
      explicitAutoRun: undefined,
    });
    expect(startGenerationJob.mock.calls[0][0].jobInput.autoRun).toBe(true);
    expect(startGenerationJob.mock.calls[0][0].jobInput.allowDecisionRouting).toBe(true);
    expect(createDecision).not.toHaveBeenCalled();
  });

  it("mode:decision creates a decision task directly under the selected epic", async () => {
    const res = await POST(makeRequest({
      prompt: "decide whether EPIC-008 is ready to go live",
      workspacePath: "/repo",
      parentId: "EPIC-008",
      mode: "decision",
    }) as Parameters<typeof POST>[0]);

    await expect(res.json()).resolves.toMatchObject({
      success: true,
      data: { routedTo: "decision", decisionId: "decision-1", taskId: "DEC-001" },
    });
    expect(taskCreate).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({
        workspace_id: "/repo",
        issue_type: "decision",
        parent_id: "EPIC-008",
        metadata: expect.objectContaining({ decision_id: "decision-1", decision_parent_task_id: "EPIC-008" }),
      }),
      "default",
    );
    expect(startGenerationJob).not.toHaveBeenCalled();
  });

  it("sendToDecisionIfWarranted:false forces task-only (allowDecisionRouting:false + DISABLED prompt)", async () => {
    const res = await POST(makeRequest({
      prompt: "create a better git integration in the UI",
      workspacePath: "/repo",
      sendToDecisionIfWarranted: false,
    }) as Parameters<typeof POST>[0]);

    await expect(res.json()).resolves.toMatchObject({
      success: true,
      data: { jobId: "job-1", runId: "run-1" },
    });
    expect(startGenerationJob.mock.calls[0][0].jobInput.allowDecisionRouting).toBe(false);
    expect(startGenerationJob.mock.calls[0][0].prompt).toContain("DECISION ROUTING DISABLED");
    expect(createDecision).not.toHaveBeenCalled();
  });

  it("honors explicit autoRun:false over the workspace/system default", async () => {
    resolveTaskAutoRunDefault.mockReturnValue(false);

    const res = await POST(makeRequest({
      prompt: "create a better git integration in the UI",
      workspacePath: "/repo",
      autoRun: false,
    }) as Parameters<typeof POST>[0]);

    await expect(res.json()).resolves.toMatchObject({
      success: true,
      data: { jobId: "job-1", runId: "run-1" },
    });
    expect(resolveTaskAutoRunDefault).toHaveBeenCalledWith({
      namespaceId: "default",
      orgId: "default",
      workspacePath: "/repo",
      explicitAutoRun: false,
    });
    expect(startGenerationJob.mock.calls[0][0].jobInput.autoRun).toBe(false);
  });

  it("rejects when prompt is missing", async () => {
    const res = await POST(makeRequest({ workspacePath: "/repo" }) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
  });
});
