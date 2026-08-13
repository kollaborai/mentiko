/**
 * @jest-environment node
 */

const checkAuth = jest.fn();
const getNamespaceIdFromRequest = jest.fn();
const getOrgIdFromRequest = jest.fn();
const getWorkspacePath = jest.fn();
const getSessionUser = jest.fn();
const resolveAuthorizedWorkspacePath = jest.fn();
const getDecision = jest.fn();
const updateDecision = jest.fn();
const getTemplate = jest.fn();
const resolveTemplate = jest.fn();
const getJob = jest.fn();
const startDecisionChainRun = jest.fn();
const startDecisionResearch = jest.fn();
const isCompletedRunAwaitingDecisionImport = jest.fn();
const isDecisionGenerationPointerDead = jest.fn();
const triggerDecisionImportReplay = jest.fn();
const taskUpdate = jest.fn();

jest.mock("@/lib/auth/api-auth", () => ({ checkAuth: (...args: unknown[]) => checkAuth(...args) }));
jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: (...args: unknown[]) => getNamespaceIdFromRequest(...args),
  getOrgIdFromRequest: (...args: unknown[]) => getOrgIdFromRequest(...args),
}));
jest.mock("@/lib/workspaces/workspace-params", () => ({
  getWorkspacePath: (...args: unknown[]) => getWorkspacePath(...args),
}));
jest.mock("@/lib/auth/auth-bridge", () => ({
  getSessionUser: (...args: unknown[]) => getSessionUser(...args),
}));
jest.mock("@/lib/auth/workspace-auth", () => ({
  resolveAuthorizedWorkspacePath: (...args: unknown[]) => resolveAuthorizedWorkspacePath(...args),
}));
jest.mock("@/lib/decisions/decision-storage", () => ({
  getDecision: (...args: unknown[]) => getDecision(...args),
  updateDecision: (...args: unknown[]) => updateDecision(...args),
}));
jest.mock("@/lib/generation/generation-template-storage", () => ({
  getTemplate: (...args: unknown[]) => getTemplate(...args),
}));
jest.mock("@/lib/system/template-resolver", () => ({
  resolveTemplate: (...args: unknown[]) => resolveTemplate(...args),
}));
jest.mock("@/lib/runs/job-store", () => ({
  getJob: (...args: unknown[]) => getJob(...args),
}));
jest.mock("@/lib/decisions/decision-chain-dispatch", () => ({
  startDecisionChainRun: (...args: unknown[]) => startDecisionChainRun(...args),
  startDecisionResearch: (...args: unknown[]) => startDecisionResearch(...args),
}));
jest.mock("@/lib/decisions/decision-auto-advance", () => ({
  isCompletedRunAwaitingDecisionImport: (...args: unknown[]) => isCompletedRunAwaitingDecisionImport(...args),
  isDecisionGenerationPointerDead: (...args: unknown[]) => isDecisionGenerationPointerDead(...args),
  triggerDecisionImportReplay: (...args: unknown[]) => triggerDecisionImportReplay(...args),
}));
jest.mock("@/lib/tasks/task-store", () => ({
  taskUpdate: (...args: unknown[]) => taskUpdate(...args),
}));
jest.mock("@/lib/api-response", () => ({
  withErrorHandling: <T extends (...args: never[]) => unknown>(handler: T) => handler,
  apiSuccess: (data: unknown) => ({ status: 200, json: async () => ({ success: true, data }) }),
}));
jest.mock("@/lib/api-errors", () => ({
  Unauthorized: class Unauthorized extends Error {},
  NotFound: class NotFound extends Error {},
  BadRequest: class BadRequest extends Error {},
  InternalServerError: class InternalServerError extends Error {},
}));

import { POST } from "./route";

function request(body: Record<string, unknown> = {}) {
  return {
    method: "POST",
    url: "http://localhost:3200/api/decisions/decision-repair/research",
    headers: new Headers(),
    json: async () => body,
  } as never;
}

function baseDecision(input: Partial<Record<string, unknown>> = {}) {
  return {
    id: "decision-repair",
    status: "intake",
    prompt: "Recover the research phase",
    title: "Recover the research phase",
    options: [],
    ...input,
  };
}

async function responseData(response: { json: () => Promise<unknown> }) {
  return ((await response.json()) as { data: Record<string, unknown> }).data;
}

describe("POST /api/decisions/[id]/research", () => {
  let storedDecision: ReturnType<typeof baseDecision>;

  beforeEach(() => {
    jest.clearAllMocks();
    checkAuth.mockResolvedValue(true);
    getNamespaceIdFromRequest.mockResolvedValue("default");
    getOrgIdFromRequest.mockResolvedValue("default");
    getWorkspacePath.mockReturnValue(undefined);
    getSessionUser.mockResolvedValue({ id: "user-1" });
    resolveAuthorizedWorkspacePath.mockReturnValue(undefined);
    getTemplate.mockReturnValue({ content: "{{PREVIOUS_ANALYSIS}}" });
    resolveTemplate.mockReturnValue("resolved research prompt");
    getJob.mockReturnValue(undefined);
    isCompletedRunAwaitingDecisionImport.mockReturnValue(false);
    isDecisionGenerationPointerDead.mockReturnValue(false);
    startDecisionResearch.mockResolvedValue({ runId: "run-research-new" });
    startDecisionChainRun.mockResolvedValue({ runId: "run-research-steered" });
    storedDecision = baseDecision();
    getDecision.mockImplementation(() => storedDecision);
    updateDecision.mockImplementation(async (_ns, _org, _id, patch) => {
      storedDecision = { ...storedDecision, ...patch };
      return storedDecision;
    });
  });

  it("relaunches a dead research pointer when the user clicks repair", async () => {
    storedDecision = baseDecision({
      status: "researching",
      researchRunId: "run-research-dead",
    });
    isDecisionGenerationPointerDead.mockReturnValue(true);

    const response = await POST(request({ repair: true }), {
      params: Promise.resolve({ id: "decision-repair" }),
    });
    const payload = await responseData(response);

    expect(startDecisionResearch).toHaveBeenCalledTimes(1);
    expect(payload).toMatchObject({ runId: "run-research-new", status: "running" });
    expect(storedDecision).toMatchObject({
      status: "researching",
      researchRunId: "run-research-new",
    });
  });

  it("does not duplicate a live research run when repair races with recovery", async () => {
    storedDecision = baseDecision({
      status: "researching",
      researchRunId: "run-research-live",
    });

    const response = await POST(request({ repair: true }), {
      params: Promise.resolve({ id: "decision-repair" }),
    });
    const payload = await responseData(response);

    expect(startDecisionResearch).not.toHaveBeenCalled();
    expect(payload).toMatchObject({
      runId: "run-research-live",
      status: "already_running",
    });
  });

  it("rejects repair for a completed decision even when its old pointer is dead", async () => {
    storedDecision = baseDecision({
      status: "briefed",
      researchRunId: "run-research-dead",
    });
    isDecisionGenerationPointerDead.mockReturnValue(true);

    await expect(POST(request({ repair: true }), {
      params: Promise.resolve({ id: "decision-repair" }),
    })).rejects.toThrow("Only an unfinished research phase can be repaired.");
    expect(startDecisionResearch).not.toHaveBeenCalled();
  });
});
