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
}));
jest.mock("@/lib/decisions/decision-chain-dispatch", () => ({
  startDecisionChainRun: (...args: unknown[]) => startDecisionChainRun(...args),
}));
jest.mock("@/lib/links/link-run-runtime", () => ({
  resolveLinkRunsDir: (...args: unknown[]) => resolveLinkRunsDir(...args),
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
import { resetDecisionPhaseMemoryForTests } from "@/lib/decisions/decision-auto-advance";

function request() {
  return {
    method: "POST",
    url: "http://localhost:3200/api/decisions/dec-questions/guided/questions",
    headers: new Headers(),
    json: async () => ({}),
  } as never;
}

function baseDecision(id: string) {
  return {
    id,
    status: "briefed",
    prompt: "Choose an implementation path",
    options: [],
  };
}

type QuestionsPayload = {
  runId?: string;
  status?: string;
  decision?: unknown;
};

async function responseData(response: { json: () => Promise<unknown> }): Promise<QuestionsPayload> {
  return ((await response.json()) as { data: QuestionsPayload }).data;
}

describe("POST /api/decisions/[id]/guided/questions", () => {
  let storedDecision: ReturnType<typeof baseDecision> & { guidedFlow?: unknown; mode?: string };
  let runsDir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    checkAuth.mockResolvedValue(true);
    getNamespaceIdFromRequest.mockResolvedValue("default");
    getOrgIdFromRequest.mockResolvedValue("default");
    getWorkspacePath.mockReturnValue(undefined);
    getSessionUser.mockResolvedValue({ id: "user-1" });
    resolveAuthorizedWorkspacePath.mockReturnValue(undefined);
    getTemplate.mockReturnValue({ content: "{{DECISION_CONTEXT}}" });
    resolveTemplate.mockReturnValue("resolved decision prompt");
    buildDecisionContext.mockReturnValue("decision context");
    runsDir = mkdtempSync(join(tmpdir(), "decision-question-runs-"));
    resolveLinkRunsDir.mockReturnValue(runsDir);
    resetDecisionPhaseMemoryForTests();
    storedDecision = baseDecision("dec-questions");
    getDecision.mockImplementation(() => storedDecision);
    updateDecision.mockImplementation(async (_ns, _org, _id, patch) => {
      storedDecision = { ...storedDecision, ...patch };
      return storedDecision;
    });
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  it("starts one deck run when browser and server calls arrive concurrently", async () => {
    let resolveRun: ((run: { runId: string }) => void) | undefined;
    startDecisionChainRun.mockImplementation(() => new Promise((resolve) => {
      // Mirror chain-run-service.startChainRun: run.json is durably written
      // before the caller can ever observe the runId, so a concurrent reader's
      // dead-pointer check must see a live run, not a missing one.
      resolveRun = (result) => {
        const dir = join(runsDir, result.runId);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "run.json"), JSON.stringify({ id: result.runId, status: "running" }));
        resolve(result);
      };
    }));

    const first = POST(request(), { params: Promise.resolve({ id: "dec-questions" }) });
    await new Promise((resolve) => setImmediate(resolve));
    const second = POST(request(), { params: Promise.resolve({ id: "dec-questions" }) });
    expect(startDecisionChainRun).toHaveBeenCalledTimes(1);

    resolveRun?.({ runId: "run-deck-once" });
    const [firstResult, secondResult] = await Promise.all([first, second]);
    const [firstData, secondData] = await Promise.all([responseData(firstResult), responseData(secondResult)]);

    expect(startDecisionChainRun).toHaveBeenCalledTimes(1);
    expect([firstData.status, secondData.status].sort()).toEqual([
      "already_generating",
      "running",
    ]);
    expect(storedDecision.guidedFlow).toEqual(expect.objectContaining({
      round1: expect.objectContaining({ generationRunId: "run-deck-once" }),
    }));
  });

  it("adopts a launched run after the decision write fails instead of starting another", async () => {
    storedDecision = baseDecision("dec-recover-questions");
    startDecisionChainRun.mockResolvedValue({ runId: "run-recover" });
    updateDecision
      .mockRejectedValueOnce(new Error("temporary decision write failure"))
      .mockImplementation(async (_ns, _org, _id, patch) => {
        storedDecision = { ...storedDecision, ...patch };
        return storedDecision;
      });

    await expect(POST(request(), { params: Promise.resolve({ id: "dec-recover-questions" }) }))
      .rejects.toThrow("temporary decision write failure");
    const retry = await POST(request(), { params: Promise.resolve({ id: "dec-recover-questions" }) });
    const retryData = await responseData(retry);

    expect(startDecisionChainRun).toHaveBeenCalledTimes(1);
    expect(retryData).toMatchObject({ runId: "run-recover", status: "already_generating" });
  });

  it("adopts a persisted phase run after process memory is cleared instead of relaunching", async () => {
    storedDecision = baseDecision("dec-restart-adopt");
    const runDir = join(runsDir, "run-existing");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "run.json"), JSON.stringify({
      id: "run-existing",
      status: "running",
      started: "2026-07-09T20:00:00.000Z",
      metadata: {
        decisionId: "dec-restart-adopt",
        decisionPhase: "questions",
      },
    }));
    resetDecisionPhaseMemoryForTests();

    const response = await POST(request(), { params: Promise.resolve({ id: "dec-restart-adopt" }) });
    const responsePayload = await responseData(response);

    expect(startDecisionChainRun).not.toHaveBeenCalled();
    expect(responsePayload).toMatchObject({ runId: "run-existing" });
    expect(storedDecision.guidedFlow).toEqual(expect.objectContaining({
      round1: expect.objectContaining({ generationRunId: "run-existing" }),
    }));
  });

  function writeRun(runId: string, status: string) {
    const dir = join(runsDir, runId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "run.json"), JSON.stringify({ id: runId, status }));
  }

  it("relaunches when the pointed-at deck run died (dead-run recovery)", async () => {
    storedDecision = {
      ...baseDecision("dec-questions-dead"),
      guidedFlow: {
        currentRound: 1,
        round1: { status: "in_progress", questions: [], answers: [], generationRunId: "run-questions-dead" },
        round2: { status: "pending", tailoredOptions: [] },
        round3: { status: "pending" },
      },
    };
    writeRun("run-questions-dead", "blocked");
    startDecisionChainRun.mockResolvedValue({ runId: "run-questions-relaunched" });

    const response = await POST(request(), { params: Promise.resolve({ id: "dec-questions-dead" }) });
    const payload = await responseData(response);

    expect(startDecisionChainRun).toHaveBeenCalledTimes(1);
    expect(payload).toMatchObject({ runId: "run-questions-relaunched", status: "running" });
    expect((storedDecision.guidedFlow as { round1: { generationRunId?: string } }).round1.generationRunId)
      .toBe("run-questions-relaunched");
  });

  it("keeps already_generating when the pointed-at deck run is still live", async () => {
    storedDecision = {
      ...baseDecision("dec-questions-live"),
      guidedFlow: {
        currentRound: 1,
        round1: { status: "in_progress", questions: [], answers: [], generationRunId: "run-questions-live" },
        round2: { status: "pending", tailoredOptions: [] },
        round3: { status: "pending" },
      },
    };
    writeRun("run-questions-live", "pending");

    const response = await POST(request(), { params: Promise.resolve({ id: "dec-questions-live" }) });
    const payload = await responseData(response);

    expect(startDecisionChainRun).not.toHaveBeenCalled();
    expect(payload).toMatchObject({ status: "already_generating" });
  });
});
