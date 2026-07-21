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
const getJob = jest.fn();

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
jest.mock("@/lib/runs/job-store", () => ({ getJob: (...args: unknown[]) => getJob(...args) }));
jest.mock("@/lib/auth/internal-api-auth", () => ({
  resolveInternalAuthSecret: jest.fn(() => "derived-decision-import-secret"),
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

function request(selectedOptionId: string, jobId?: string) {
  return {
    method: "POST",
    url: "http://localhost:3200/api/decisions/dec-plan/guided/plan",
    headers: new Headers(),
    json: async () => ({ selectedOptionId, ...(jobId ? { jobId } : {}) }),
  } as never;
}

type PlanPayload = { runId?: string; status?: string; decision?: unknown; plan?: { tasks: Array<Record<string, unknown>> } };

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

  function writeRun(runId: string, status: string) {
    const dir = join(runsDir, runId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "run.json"), JSON.stringify({ id: runId, status }));
  }

  it("relaunches when the pointed-at plan run died (dead-run recovery)", async () => {
    storedDecision = {
      ...baseDecision("dec-plan-dead"),
      guidedFlow: {
        currentRound: 3,
        round1: { status: "complete", questions: [], answers: [] },
        round2: {
          status: "ready",
          tailoredOptions: [option("option-a", "A"), option("option-b", "B")],
          selectedOptionId: "option-b",
        },
        round3: { status: "generating", generationRunId: "run-plan-dead" },
      },
    } as never;
    writeRun("run-plan-dead", "failed");
    startDecisionChainRun.mockResolvedValue({ runId: "run-plan-relaunched" });

    const response = await POST(request("option-b"), { params: Promise.resolve({ id: "dec-plan-dead" }) });
    const payload = await responseData(response);

    expect(startDecisionChainRun).toHaveBeenCalledTimes(1);
    expect(payload).toMatchObject({ runId: "run-plan-relaunched", status: "running" });
    expect((storedDecision.guidedFlow.round3 as { generationRunId?: string }).generationRunId)
      .toBe("run-plan-relaunched");
  });

  it("keeps already_generating when the pointed-at plan run is still live", async () => {
    storedDecision = {
      ...baseDecision("dec-plan-live"),
      guidedFlow: {
        currentRound: 3,
        round1: { status: "complete", questions: [], answers: [] },
        round2: {
          status: "ready",
          tailoredOptions: [option("option-a", "A"), option("option-b", "B")],
          selectedOptionId: "option-b",
        },
        round3: { status: "generating", generationRunId: "run-plan-live" },
      },
    } as never;
    writeRun("run-plan-live", "running");

    const response = await POST(request("option-b"), { params: Promise.resolve({ id: "dec-plan-live" }) });
    const payload = await responseData(response);

    expect(startDecisionChainRun).not.toHaveBeenCalled();
    expect(payload).toMatchObject({ runId: "run-plan-live", status: "already_generating" });
  });

  it("replays the import instead of relaunching when the pointed-at plan run completed but its result was never imported (DEC-005 wedge)", async () => {
    storedDecision = {
      ...baseDecision("dec-plan-lost-import"),
      guidedFlow: {
        currentRound: 3,
        round1: { status: "complete", questions: [], answers: [] },
        round2: {
          status: "ready",
          tailoredOptions: [option("option-a", "A"), option("option-b", "B")],
          selectedOptionId: "option-b",
        },
        round3: { status: "generating", generationRunId: "run-plan-completed-lost-import" },
      },
    } as never;
    const runDir = join(runsDir, "run-plan-completed-lost-import");
    mkdirSync(join(runDir, "artifacts"), { recursive: true });
    writeFileSync(join(runDir, "run.json"), JSON.stringify({ id: "run-plan-completed-lost-import", status: "completed" }));
    writeFileSync(join(runDir, "artifacts", "decision-result.json"), JSON.stringify({ summary: "s", tasks: [], dependencies: [] }));
    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
    global.fetch = fetchMock;

    const response = await POST(request("option-b"), { params: Promise.resolve({ id: "dec-plan-lost-import" }) });
    const payload = await responseData(response);

    expect(startDecisionChainRun).not.toHaveBeenCalled();
    // Still reports already_generating -- the generation itself did happen --
    // but a replayed import request has been fired so the round can advance
    // on the next poll instead of staying wedged forever.
    expect(payload).toMatchObject({ runId: "run-plan-completed-lost-import", status: "already_generating" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/decisions/dec-plan-lost-import/import");
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      phase: "plan",
      runId: "run-plan-completed-lost-import",
      selectedOptionId: "option-b",
    });
  });

  it("refuses a completed legacy plan that cannot prove each generated task", async () => {
    getJob.mockReturnValue({
      id: "job-legacy-plan",
      status: "complete",
      result: {
        summary: "An old plan",
        tasks: [{ id: "old-task", title: "Document status", description: "Write an update", priority: 2, phase: 1 }],
        dependencies: [],
      },
    });

    await expect(POST(request("option-b", "job-legacy-plan"), { params: Promise.resolve({ id: "dec-plan" }) }))
      .rejects.toThrow("requires a concrete deliverable");
    expect(updateDecision).not.toHaveBeenCalled();
  });

  it("stores a verified completed plan with its task contract intact", async () => {
    getJob.mockReturnValue({
      id: "job-verified-plan",
      status: "complete",
      result: {
        summary: "A verified plan",
        tasks: [{
          id: "implement",
          title: "Implement the endpoint",
          description: "Add the endpoint and its focused regression.",
          subtasks: [],
          deliverable: "The endpoint and focused regression test",
          verification: "Run npm test -- endpoint and expect exit code 0",
          acceptance_criteria: "The endpoint returns 200 and the focused test passes.",
          priority: 1,
          phase: 1,
        }],
        dependencies: [],
      },
    });

    const response = await POST(request("option-b", "job-verified-plan"), { params: Promise.resolve({ id: "dec-plan" }) });
    const data = await responseData(response);

    expect(data.plan?.tasks[0]).toMatchObject({
      deliverable: "The endpoint and focused regression test",
      verification: expect.stringContaining("npm test"),
      acceptance_criteria: expect.stringContaining("Deliverable: The endpoint and focused regression test"),
    });
  });
});
