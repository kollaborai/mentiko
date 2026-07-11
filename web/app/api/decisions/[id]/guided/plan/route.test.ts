/**
 * @jest-environment node
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
const buildDecisionContext = jest.fn();
const buildPreferenceText = jest.fn();
const startDecisionChainRun = jest.fn();
const resolveLinkRunsDir = jest.fn();

jest.mock("@/lib/auth/api-auth", () => ({ checkAuth: (...args: unknown[]) => checkAuth(...args) }));
jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: (...args: unknown[]) => getNamespaceIdFromRequest(...args),
  getOrgIdFromRequest: (...args: unknown[]) => getOrgIdFromRequest(...args),
}));
jest.mock("@/lib/workspaces/workspace-params", () => ({
  getWorkspacePath: (...args: unknown[]) => getWorkspacePath(...args),
}));
jest.mock("@/lib/auth/auth-bridge", () => ({ getSessionUser: (...args: unknown[]) => getSessionUser(...args) }));
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
jest.mock("@/lib/decisions/decision-context", () => ({
  buildDecisionContext: (...args: unknown[]) => buildDecisionContext(...args),
  buildPreferenceText: (...args: unknown[]) => buildPreferenceText(...args),
}));
jest.mock("@/lib/decisions/decision-chain-dispatch", () => ({
  startDecisionChainRun: (...args: unknown[]) => startDecisionChainRun(...args),
}));
jest.mock("@/lib/links/link-run-runtime", () => ({
  resolveLinkRunsDir: (...args: unknown[]) => resolveLinkRunsDir(...args),
}));
jest.mock("@/lib/runs/job-store", () => ({ getJob: jest.fn() }));
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
import { resetDecisionPhaseMemoryForTests } from "@/lib/decisions/decision-auto-advance";

function option(id: string, letter: string) {
  return {
    id,
    letter,
    name: `Option ${letter}`,
    description: `${letter} path`,
    pros: ["pro"],
    cons: ["con"],
    effort: "medium" as const,
    risk: "medium" as const,
    matchScore: 80,
  };
}

function baseDecision(id: string) {
  return {
    id,
    status: "briefed",
    prompt: "Choose a path",
    options: [option("option-a", "A"), option("option-b", "B")],
    guidedFlow: {
      currentRound: 2,
      round1: { status: "complete", questions: [], answers: [] },
      round2: {
        status: "ready",
        tailoredOptions: [option("option-a", "A"), option("option-b", "B")],
      },
      round3: { status: "pending" },
    },
  };
}

function request(selectedOptionId: string) {
  return {
    method: "POST",
    url: "http://localhost:3200/api/decisions/dec-plan/guided/plan",
    headers: new Headers(),
    json: async () => ({ selectedOptionId }),
  } as never;
}

type PlanPayload = { runId?: string; status?: string; decision?: unknown };

async function responseData(response: { json: () => Promise<unknown> }): Promise<PlanPayload> {
  return ((await response.json()) as { data: PlanPayload }).data;
}

describe("POST /api/decisions/[id]/guided/plan", () => {
  let storedDecision: ReturnType<typeof baseDecision>;
  let runsDir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    runsDir = mkdtempSync(join(tmpdir(), "decision-plan-runs-"));
    resolveLinkRunsDir.mockReturnValue(runsDir);
    resetDecisionPhaseMemoryForTests();
    checkAuth.mockResolvedValue(true);
    getNamespaceIdFromRequest.mockResolvedValue("default");
    getOrgIdFromRequest.mockResolvedValue("default");
    getWorkspacePath.mockReturnValue(undefined);
    getSessionUser.mockResolvedValue({ id: "user-1" });
    resolveAuthorizedWorkspacePath.mockReturnValue(undefined);
    getTemplate.mockReturnValue({ content: "plan template" });
    resolveTemplate.mockReturnValue("resolved plan prompt");
    buildDecisionContext.mockReturnValue("decision context");
    buildPreferenceText.mockReturnValue("preferences");
    storedDecision = baseDecision("dec-plan");
    getDecision.mockImplementation(() => storedDecision);
    updateDecision.mockImplementation(async (_ns, _org, _id, patch) => {
      storedDecision = { ...storedDecision, ...patch };
      return storedDecision;
    });
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  it("starts one plan run for a double-submit of the same selection", async () => {
    let resolveRun: ((run: { runId: string }) => void) | undefined;
    startDecisionChainRun.mockImplementation(() => new Promise((resolve) => { resolveRun = resolve; }));

    const first = POST(request("option-b"), { params: Promise.resolve({ id: "dec-plan" }) });
    await new Promise((resolve) => setImmediate(resolve));
    const second = POST(request("option-b"), { params: Promise.resolve({ id: "dec-plan" }) });
    expect(startDecisionChainRun).toHaveBeenCalledTimes(1);

    resolveRun?.({ runId: "run-plan-once" });
    const responses = await Promise.all([first, second]);
    const payloads = await Promise.all(responses.map(responseData));

    expect(startDecisionChainRun).toHaveBeenCalledTimes(1);
    expect(payloads.map((payload) => payload.status).sort()).toEqual(["already_generating", "running"]);
    expect((storedDecision.guidedFlow.round2 as { selectedOptionId?: string }).selectedOptionId)
      .toBe("option-b");
    expect((storedDecision.guidedFlow.round3 as { generationRunId?: string }).generationRunId)
      .toBe("run-plan-once");
  });

  it("adopts the selected option's plan after a pointer-write crash and restart", async () => {
    storedDecision = baseDecision("dec-plan-restart");
    startDecisionChainRun.mockResolvedValue({ runId: "run-plan-restart" });
    updateDecision
      .mockRejectedValueOnce(new Error("temporary plan pointer failure"))
      .mockImplementation(async (_ns, _org, _id, patch) => {
        storedDecision = { ...storedDecision, ...patch };
        return storedDecision;
      });

    await expect(POST(request("option-b"), { params: Promise.resolve({ id: "dec-plan-restart" }) }))
      .rejects.toThrow("temporary plan pointer failure");
    resetDecisionPhaseMemoryForTests();
    const retry = await POST(request("option-b"), { params: Promise.resolve({ id: "dec-plan-restart" }) });
    const payload = await responseData(retry);

    expect(startDecisionChainRun).toHaveBeenCalledTimes(1);
    expect(payload).toMatchObject({ runId: "run-plan-restart", status: "already_generating" });
    expect((storedDecision.guidedFlow.round2 as { selectedOptionId?: string }).selectedOptionId)
      .toBe("option-b");
  });

  it("does not adopt an old plan run for a different selected option", async () => {
    storedDecision = baseDecision("dec-plan-choice");
    const oldRunDir = join(runsDir, "run-plan-option-a");
    mkdirSync(oldRunDir, { recursive: true });
    writeFileSync(join(oldRunDir, "run.json"), JSON.stringify({
      id: "run-plan-option-a",
      status: "running",
      started: "2026-07-09T20:00:00.000Z",
      metadata: {
        decisionId: "dec-plan-choice",
        decisionPhase: "plan",
        selectedOptionId: "option-a",
      },
    }));
    resetDecisionPhaseMemoryForTests();
    startDecisionChainRun.mockResolvedValue({ runId: "run-plan-option-b" });

    const response = await POST(request("option-b"), { params: Promise.resolve({ id: "dec-plan-choice" }) });
    const payload = await responseData(response);

    expect(startDecisionChainRun).toHaveBeenCalledTimes(1);
    expect(startDecisionChainRun).toHaveBeenCalledWith(expect.objectContaining({
      selectedOptionId: "option-b",
    }));
    expect(payload).toMatchObject({ runId: "run-plan-option-b", status: "running" });
  });
});
