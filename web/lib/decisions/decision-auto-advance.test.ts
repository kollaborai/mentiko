/**
 * @jest-environment node
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  advanceDecisionAfterPhase,
  decisionPhaseKey,
  isDecisionGenerationPointerDead,
  startDecisionPhaseOnce,
} from "./decision-auto-advance";

jest.mock("@/lib/workspaces/workspace-storage", () => ({
  listWorkspaces: jest.fn(),
  resolveDecisionAutoApprove: jest.fn(),
}));

jest.mock("@/lib/links/link-run-runtime", () => ({
  resolveLinkRunsDir: jest.fn(),
}));

jest.mock("@/lib/runs/job-store", () => ({
  getJob: jest.fn(),
}));

import { listWorkspaces, resolveDecisionAutoApprove } from "@/lib/workspaces/workspace-storage";
import { resolveLinkRunsDir } from "@/lib/links/link-run-runtime";
import { getJob } from "@/lib/runs/job-store";

describe("decision auto-advance", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    jest.mocked(listWorkspaces).mockReset();
    jest.mocked(resolveDecisionAutoApprove).mockReset();
    jest.mocked(resolveLinkRunsDir).mockReset();
    jest.mocked(getJob).mockReset();
  });

  it("coalesces concurrent research-complete nudges into one deck request", async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
    global.fetch = fetchMock;
    const decision = {
      id: "dec-deck-once",
      status: "briefed",
      options: [],
    } as never;

    advanceDecisionAfterPhase({ namespaceId: "ns", orgId: "org", decision });
    advanceDecisionAfterPhase({ namespaceId: "ns", orgId: "org", decision });
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/decisions/dec-deck-once/guided/questions");
  });

  it("automatically generates options once the deck is ready", async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
    global.fetch = fetchMock;
    const decision = {
      id: "dec-options",
      status: "briefed",
      options: [],
      guidedFlow: {
        currentRound: 1,
        round1: { status: "in_progress", questions: [{ id: "q-1" }], answers: [] },
        round2: { status: "pending", tailoredOptions: [] },
        round3: { status: "pending" },
      },
    } as never;

    advanceDecisionAfterPhase({ namespaceId: "ns", orgId: "org", decision });
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/decisions/dec-options/guided/options");
  });

  it("leaves a generated plan for explicit human approval", async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
    global.fetch = fetchMock;
    const decision = {
      id: "dec-plan-ready",
      status: "briefed",
      options: [],
      guidedFlow: {
        currentRound: 3,
        round1: { status: "complete", questions: [], answers: [] },
        round2: { status: "ready", tailoredOptions: [], selectedOptionId: "option-a" },
        round3: {
          status: "ready",
          plan: { summary: "plan", tasks: [], dependencies: [] },
        },
      },
    } as never;

    advanceDecisionAfterPhase({ namespaceId: "ns", orgId: "org", decision });
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("selects the recommended option and starts its plan when the workspace policy is enabled", async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
    global.fetch = fetchMock;
    jest.mocked(listWorkspaces).mockReturnValue([{ id: "ws", path: "/repo", name: "repo" }] as never);
    jest.mocked(resolveDecisionAutoApprove).mockReturnValue(true);
    const decision = {
      id: "dec-auto-plan",
      status: "briefed",
      workspacePath: "/repo",
      options: [{ id: "option-a" }],
      recommendation: { choiceId: "option-a" },
      guidedFlow: {
        currentRound: 2,
        round1: { status: "complete", questions: [], answers: [] },
        round2: { status: "ready", tailoredOptions: [] },
        round3: { status: "pending" },
      },
    } as never;

    advanceDecisionAfterPhase({ namespaceId: "ns", orgId: "org", decision });
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/decisions/dec-auto-plan/guided/plan");
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({ selectedOptionId: "option-a" });
  });

  it("approves a recommended plan when the workspace policy is enabled", async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
    global.fetch = fetchMock;
    jest.mocked(listWorkspaces).mockReturnValue([{ id: "ws", path: "/repo", name: "repo" }] as never);
    jest.mocked(resolveDecisionAutoApprove).mockReturnValue(true);
    const decision = {
      id: "dec-auto-approve",
      status: "briefed",
      workspacePath: "/repo",
      options: [{ id: "option-a" }],
      recommendation: { choiceId: "option-a" },
      guidedFlow: {
        currentRound: 3,
        round1: { status: "complete", questions: [], answers: [] },
        round2: { status: "ready", tailoredOptions: [], selectedOptionId: "option-a" },
        round3: { status: "ready", plan: { summary: "plan", tasks: [], dependencies: [] } },
      },
    } as never;

    advanceDecisionAfterPhase({ namespaceId: "ns", orgId: "org", decision });
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/decisions/dec-auto-approve/resolve");
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual(expect.objectContaining({
      selectedOptionId: "option-a",
      autoApprovedByWorkspacePolicy: true,
    }));
  });

  it("retries a failed pointer write by adopting the original run", async () => {
    const key = decisionPhaseKey("ns", "org", "dec-recover", "questions");
    const start = jest.fn().mockResolvedValue({ runId: "run-existing" });
    const persist = jest.fn()
      .mockRejectedValueOnce(new Error("temporary decision write failure"))
      .mockResolvedValue({ id: "dec-recover" });

    await expect(startDecisionPhaseOnce({ key, start, persist })).rejects.toThrow("temporary decision write failure");
    const recovered = await startDecisionPhaseOnce({ key, start, persist });

    expect(start).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(2);
    expect(recovered).toMatchObject({
      started: { runId: "run-existing" },
      persisted: { id: "dec-recover" },
      recovered: true,
      joined: false,
    });
  });
});

describe("isDecisionGenerationPointerDead", () => {
  let runsDir: string;

  beforeEach(() => {
    jest.mocked(resolveLinkRunsDir).mockReset();
    jest.mocked(getJob).mockReset();
    runsDir = mkdtempSync(join(tmpdir(), "decision-pointer-dead-runs-"));
    jest.mocked(resolveLinkRunsDir).mockReturnValue(runsDir);
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  function writeRun(runId: string, status: string) {
    const dir = join(runsDir, runId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "run.json"), JSON.stringify({ id: runId, status }));
  }

  it("returns false when neither a run nor a job pointer is set", () => {
    expect(isDecisionGenerationPointerDead("ns", "org", {})).toBe(false);
  });

  it.each(["blocked", "failed", "stopped", "cancelled", "deleted", "unknown"])(
    "treats a run with terminal status %s as dead",
    (status) => {
      writeRun("run-dead", status);
      expect(isDecisionGenerationPointerDead("ns", "org", { runId: "run-dead" })).toBe(true);
    },
  );

  it.each(["running", "pending"])("treats a live run (%s) as not dead", (status) => {
    writeRun("run-live", status);
    expect(isDecisionGenerationPointerDead("ns", "org", { runId: "run-live" })).toBe(false);
  });

  it.each(["completed", "complete"])("treats a %s run as not dead (completed-pending-import)", (status) => {
    writeRun("run-done", status);
    expect(isDecisionGenerationPointerDead("ns", "org", { runId: "run-done" })).toBe(false);
  });

  it("treats a missing run.json as dead (launch never landed durably)", () => {
    expect(isDecisionGenerationPointerDead("ns", "org", { runId: "run-never-existed" })).toBe(true);
  });

  it("treats a failed job as dead", () => {
    jest.mocked(getJob).mockReturnValue({ id: "job-1", status: "failed" } as never);
    expect(isDecisionGenerationPointerDead("ns", "org", { jobId: "job-1" })).toBe(true);
  });

  it("treats a missing job as dead", () => {
    jest.mocked(getJob).mockReturnValue(null);
    expect(isDecisionGenerationPointerDead("ns", "org", { jobId: "job-missing" })).toBe(true);
  });

  it.each(["pending", "running", "complete"])("treats a %s job as not dead", (status) => {
    jest.mocked(getJob).mockReturnValue({ id: "job-1", status } as never);
    expect(isDecisionGenerationPointerDead("ns", "org", { jobId: "job-1" })).toBe(false);
  });

  it("is dead only when every present pointer component is dead", () => {
    writeRun("run-dead-2", "blocked");
    jest.mocked(getJob).mockReturnValue({ id: "job-1", status: "running" } as never);
    expect(isDecisionGenerationPointerDead("ns", "org", { runId: "run-dead-2", jobId: "job-1" })).toBe(false);
  });
});

describe("decision auto-advance self-heal", () => {
  const originalFetchForHealTests = global.fetch;
  let runsDir: string;

  beforeEach(() => {
    jest.mocked(resolveLinkRunsDir).mockReset();
    jest.mocked(getJob).mockReset();
    runsDir = mkdtempSync(join(tmpdir(), "decision-advance-heal-runs-"));
    jest.mocked(resolveLinkRunsDir).mockReturnValue(runsDir);
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
    global.fetch = originalFetchForHealTests;
  });

  function writeRun(runId: string, status: string) {
    const dir = join(runsDir, runId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "run.json"), JSON.stringify({ id: runId, status }));
  }

  it("re-fires the questions phase when round1 is generating with a dead run and no questions", async () => {
    writeRun("run-questions-dead", "blocked");
    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
    global.fetch = fetchMock;
    const decision = {
      id: "dec-heal-questions",
      status: "briefed",
      options: [],
      guidedFlow: {
        currentRound: 0,
        round1: { status: "in_progress", questions: [], answers: [], generationRunId: "run-questions-dead" },
        round2: { status: "pending", tailoredOptions: [] },
        round3: { status: "pending" },
      },
    } as never;

    advanceDecisionAfterPhase({ namespaceId: "ns", orgId: "org", decision });
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/decisions/dec-heal-questions/guided/questions");
  });

  it("does not re-fire questions when round1's run is still live", async () => {
    writeRun("run-questions-live", "running");
    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
    global.fetch = fetchMock;
    const decision = {
      id: "dec-heal-questions-live",
      status: "briefed",
      options: [],
      guidedFlow: {
        currentRound: 0,
        round1: { status: "in_progress", questions: [], answers: [], generationRunId: "run-questions-live" },
        round2: { status: "pending", tailoredOptions: [] },
        round3: { status: "pending" },
      },
    } as never;

    advanceDecisionAfterPhase({ namespaceId: "ns", orgId: "org", decision });
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-fires the options phase when round2 is generating with a dead run (the DEC-001 wedge)", async () => {
    writeRun("run-options-dead", "blocked");
    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
    global.fetch = fetchMock;
    const decision = {
      id: "dec-heal-options",
      status: "briefed",
      options: [],
      guidedFlow: {
        currentRound: 1,
        round1: { status: "in_progress", questions: [{ id: "q-1" }], answers: [] },
        round2: { status: "generating", tailoredOptions: [], generationRunId: "run-options-dead" },
        round3: { status: "pending" },
      },
    } as never;

    advanceDecisionAfterPhase({ namespaceId: "ns", orgId: "org", decision });
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/decisions/dec-heal-options/guided/options");
  });

  it("does not re-fire options when round2's run is still live", async () => {
    writeRun("run-options-live", "pending");
    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
    global.fetch = fetchMock;
    const decision = {
      id: "dec-heal-options-live",
      status: "briefed",
      options: [],
      guidedFlow: {
        currentRound: 1,
        round1: { status: "in_progress", questions: [{ id: "q-1" }], answers: [] },
        round2: { status: "generating", tailoredOptions: [], generationRunId: "run-options-live" },
        round3: { status: "pending" },
      },
    } as never;

    advanceDecisionAfterPhase({ namespaceId: "ns", orgId: "org", decision });
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-fires the plan phase (with the selected option) when round3 is generating with a dead run", async () => {
    writeRun("run-plan-dead", "failed");
    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
    global.fetch = fetchMock;
    const decision = {
      id: "dec-heal-plan",
      status: "briefed",
      options: [{ id: "option-a" }],
      guidedFlow: {
        currentRound: 2,
        round1: { status: "complete", questions: [], answers: [] },
        round2: { status: "ready", tailoredOptions: [], selectedOptionId: "option-a" },
        round3: { status: "generating", generationRunId: "run-plan-dead" },
      },
    } as never;

    advanceDecisionAfterPhase({ namespaceId: "ns", orgId: "org", decision });
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/decisions/dec-heal-plan/guided/plan");
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({ selectedOptionId: "option-a" });
  });
});
