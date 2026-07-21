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

function baseDecision(id: string) {
  return {
    id,
    status: "briefed",
    prompt: "Choose a path",
    options: [],
    context: { constraints: [] },
    guidedFlow: {
      currentRound: 1,
      round1: { status: "in_progress", questions: [{ id: "q-1" }], answers: [] },
      round2: { status: "pending", tailoredOptions: [] },
      round3: { status: "pending" },
    },
  };
}

function request() {
  return {
    method: "POST",
    url: "http://localhost:3200/api/decisions/dec-options/guided/options",
    headers: new Headers(),
    json: async () => ({}),
  } as never;
}

type OptionsPayload = { runId?: string; status?: string; decision?: unknown };

async function responseData(response: { json: () => Promise<unknown> }): Promise<OptionsPayload> {
  return ((await response.json()) as { data: OptionsPayload }).data;
}

describe("POST /api/decisions/[id]/guided/options", () => {
  let storedDecision: ReturnType<typeof baseDecision>;
  let runsDir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    runsDir = mkdtempSync(join(tmpdir(), "decision-option-runs-"));
    resolveLinkRunsDir.mockReturnValue(runsDir);
    resetDecisionPhaseMemoryForTests();
    checkAuth.mockResolvedValue(true);
    getNamespaceIdFromRequest.mockResolvedValue("default");
    getOrgIdFromRequest.mockResolvedValue("default");
    getWorkspacePath.mockReturnValue(undefined);
    getSessionUser.mockResolvedValue({ id: "user-1" });
    resolveAuthorizedWorkspacePath.mockReturnValue(undefined);
    getTemplate.mockReturnValue({ content: "options template" });
    resolveTemplate.mockReturnValue("resolved options prompt");
    buildDecisionContext.mockReturnValue("decision context");
    buildPreferenceText.mockReturnValue("no preferences");
    storedDecision = baseDecision("dec-options");
    getDecision.mockImplementation(() => storedDecision);
    updateDecision.mockImplementation(async (_ns, _org, _id, patch) => {
      storedDecision = { ...storedDecision, ...patch };
      return storedDecision;
    });
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  it("starts one options run when browser and server calls arrive concurrently", async () => {
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

    const first = POST(request(), { params: Promise.resolve({ id: "dec-options" }) });
    await new Promise((resolve) => setImmediate(resolve));
    const second = POST(request(), { params: Promise.resolve({ id: "dec-options" }) });
    expect(startDecisionChainRun).toHaveBeenCalledTimes(1);

    resolveRun?.({ runId: "run-options-once" });
    const responses = await Promise.all([first, second]);
    const payloads = await Promise.all(responses.map(responseData));

    expect(startDecisionChainRun).toHaveBeenCalledTimes(1);
    expect(payloads.map((payload) => payload.status).sort()).toEqual(["already_generating", "running"]);
    expect(storedDecision.guidedFlow.round2).toEqual(expect.objectContaining({
      status: "generating",
      generationRunId: "run-options-once",
    }));
  });

  it("adopts the durable options run after a pointer-write crash and process restart", async () => {
    storedDecision = baseDecision("dec-options-restart");
    startDecisionChainRun.mockResolvedValue({ runId: "run-options-restart" });
    updateDecision
      .mockRejectedValueOnce(new Error("temporary decision write failure"))
      .mockImplementation(async (_ns, _org, _id, patch) => {
        storedDecision = { ...storedDecision, ...patch };
        return storedDecision;
      });

    await expect(POST(request(), { params: Promise.resolve({ id: "dec-options-restart" }) }))
      .rejects.toThrow("temporary decision write failure");
    resetDecisionPhaseMemoryForTests();
    const retry = await POST(request(), { params: Promise.resolve({ id: "dec-options-restart" }) });
    const payload = await responseData(retry);

    expect(startDecisionChainRun).toHaveBeenCalledTimes(1);
    expect(payload).toMatchObject({ runId: "run-options-restart", status: "already_generating" });
    expect((storedDecision.guidedFlow.round2 as { generationRunId?: string }).generationRunId)
      .toBe("run-options-restart");
  });

  function writeRun(runId: string, status: string) {
    const dir = join(runsDir, runId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "run.json"), JSON.stringify({ id: runId, status }));
  }

  it("relaunches when the pointed-at options run died (dead-run recovery)", async () => {
    storedDecision = {
      ...baseDecision("dec-options-dead"),
      guidedFlow: {
        currentRound: 1,
        round1: { status: "in_progress", questions: [{ id: "q-1" }], answers: [] },
        round2: { status: "generating", tailoredOptions: [], generationRunId: "run-options-dead" },
        round3: { status: "pending" },
      },
    } as never;
    writeRun("run-options-dead", "blocked");
    startDecisionChainRun.mockResolvedValue({ runId: "run-options-relaunched" });

    const response = await POST(request(), { params: Promise.resolve({ id: "dec-options-dead" }) });
    const payload = await responseData(response);

    expect(startDecisionChainRun).toHaveBeenCalledTimes(1);
    expect(payload).toMatchObject({ runId: "run-options-relaunched", status: "running" });
    expect((storedDecision.guidedFlow.round2 as { generationRunId?: string }).generationRunId)
      .toBe("run-options-relaunched");
  });

  it("relaunches when the pointed-at options run is missing entirely", async () => {
    storedDecision = {
      ...baseDecision("dec-options-missing"),
      guidedFlow: {
        currentRound: 1,
        round1: { status: "in_progress", questions: [{ id: "q-1" }], answers: [] },
        round2: { status: "generating", tailoredOptions: [], generationRunId: "run-options-never-existed" },
        round3: { status: "pending" },
      },
    } as never;
    startDecisionChainRun.mockResolvedValue({ runId: "run-options-relaunched-2" });

    const response = await POST(request(), { params: Promise.resolve({ id: "dec-options-missing" }) });
    const payload = await responseData(response);

    expect(startDecisionChainRun).toHaveBeenCalledTimes(1);
    expect(payload).toMatchObject({ runId: "run-options-relaunched-2", status: "running" });
  });

  it("keeps already_generating when the pointed-at options run is still live", async () => {
    storedDecision = {
      ...baseDecision("dec-options-live"),
      guidedFlow: {
        currentRound: 1,
        round1: { status: "in_progress", questions: [{ id: "q-1" }], answers: [] },
        round2: { status: "generating", tailoredOptions: [], generationRunId: "run-options-live" },
        round3: { status: "pending" },
      },
    } as never;
    writeRun("run-options-live", "running");

    const response = await POST(request(), { params: Promise.resolve({ id: "dec-options-live" }) });
    const payload = await responseData(response);

    expect(startDecisionChainRun).not.toHaveBeenCalled();
    expect(payload).toMatchObject({ runId: "run-options-live", status: "already_generating" });
  });
});
