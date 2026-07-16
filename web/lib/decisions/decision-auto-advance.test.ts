/**
 * @jest-environment node
 */

import {
  advanceDecisionAfterPhase,
  decisionPhaseKey,
  startDecisionPhaseOnce,
} from "./decision-auto-advance";

jest.mock("@/lib/workspaces/workspace-storage", () => ({
  listWorkspaces: jest.fn(),
  resolveDecisionAutoApprove: jest.fn(),
}));

import { listWorkspaces, resolveDecisionAutoApprove } from "@/lib/workspaces/workspace-storage";

describe("decision auto-advance", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    jest.mocked(listWorkspaces).mockReset();
    jest.mocked(resolveDecisionAutoApprove).mockReset();
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
