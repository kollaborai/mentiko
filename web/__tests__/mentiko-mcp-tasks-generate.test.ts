/**
 * POST /api/mentiko-mcp/ops/tasks/generate — agent-as-gate contract.
 *
 * - mode "task" (default): start a generation job, return at once
 *   { jobId, runId, status }. The AGENT decides task-vs-decision during the
 *   run (no pre-flight heuristic); sendToDecisionIfWarranted toggles whether
 *   the agent is allowed to route (threaded as allowDecisionRouting).
 * - mode "decision": createTaskDecision directly, return
 *   { routedTo: "decision", decisionId, taskId }.
 *
 * @jest-environment node
 */
import { POST } from "@/app/api/mentiko-mcp/ops/tasks/generate/route";

const mockStartGenerationJob = jest.fn();
jest.mock("@/lib/generation/generation-chain-dispatch", () => ({
  startGenerationJob: (...args: unknown[]) => mockStartGenerationJob(...args),
}));

const mockCreateTaskDecision = jest.fn();
jest.mock("@/lib/tasks/task-decision-link", () => ({
  createTaskDecision: (...args: unknown[]) => mockCreateTaskDecision(...args),
}));

jest.mock("@/lib/ai-engine/mentiko-mcp-ops-auth", () => ({
  requireOpsAuth: jest.fn().mockResolvedValue({
    namespaceId: "default", orgId: "default", userId: "user-1", sessionId: "session-1",
  }),
  requireOpsPermission: jest.fn().mockReturnValue(null),
}));
jest.mock("@/lib/schema-loader", () => ({ getTaskSchema: jest.fn().mockReturnValue("{}") }));
jest.mock("@/lib/generation/generation-template-storage", () => ({
  getTemplate: jest.fn().mockReturnValue({ content: "{{USER_PROMPT}}{{ALLOW_DECISION_ROUTING}}" }),
}));
jest.mock("@/lib/system/template-resolver", () => ({
  resolveTemplate: jest.fn().mockImplementation((_t: string, v: Record<string, string>) =>
    (v.USER_PROMPT ?? "") + (v.ALLOW_DECISION_ROUTING ?? ""),
  ),
}));
jest.mock("@/lib/auth/workspace-auth", () => ({
  resolveAuthorizedWorkspacePath: jest.fn((_a: unknown, _b: unknown, wp: string) => wp),
}));

function makeRequest(body: object) {
  return new Request("http://localhost/api/mentiko-mcp/ops/tasks/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStartGenerationJob.mockResolvedValue({ jobId: "job-1", runId: "run-1", status: "pending" });
  mockCreateTaskDecision.mockResolvedValue({ decision: { id: "dec-1" }, task: { id: "DEC-1" } });
});

describe("POST /api/mentiko-mcp/ops/tasks/generate — task mode (async)", () => {
  it("returns a { jobId, runId, status } handle without polling", async () => {
    const res = await POST(makeRequest({ description: "build something", workspacePath: "/ws" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jobId: "job-1", runId: "run-1", status: "pending" });
  });

  it("threads allowDecisionRouting=true into jobInput by default (agent may route)", async () => {
    await POST(makeRequest({ description: "build something" }));
    expect(mockStartGenerationJob.mock.calls[0][0].jobInput.allowDecisionRouting).toBe(true);
    // no DISABLED marker in the prompt
    expect(mockStartGenerationJob.mock.calls[0][0].prompt).not.toContain("DECISION ROUTING DISABLED");
  });

  it("sendToDecisionIfWarranted:false forces task-only (allowDecisionRouting=false + DISABLED prompt)", async () => {
    await POST(makeRequest({ description: "redesign the architecture", sendToDecisionIfWarranted: false }));
    expect(mockStartGenerationJob.mock.calls[0][0].jobInput.allowDecisionRouting).toBe(false);
    expect(mockStartGenerationJob.mock.calls[0][0].prompt).toContain("DECISION ROUTING DISABLED");
    expect(mockCreateTaskDecision).not.toHaveBeenCalled();
  });

  it("does not pre-flight route — a strategic prompt still starts a job (agent gates async)", async () => {
    await POST(makeRequest({ description: "redesign the whole authentication architecture and strategy" }));
    expect(mockStartGenerationJob).toHaveBeenCalledTimes(1);
    expect(mockCreateTaskDecision).not.toHaveBeenCalled();
  });

  it("returns 400 when description is missing/blank", async () => {
    expect((await POST(makeRequest({}))).status).toBe(400);
    expect((await POST(makeRequest({ description: "  " }))).status).toBe(400);
  });
});

describe("POST /api/mentiko-mcp/ops/tasks/generate — decision mode", () => {
  it("mode:decision creates a decision directly and returns { routedTo, decisionId, taskId }", async () => {
    const res = await POST(makeRequest({ description: "which approach should we take", mode: "decision" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ routedTo: "decision", decisionId: "dec-1", taskId: "DEC-1" });
    expect(mockCreateTaskDecision).toHaveBeenCalledTimes(1);
    expect(mockStartGenerationJob).not.toHaveBeenCalled();
    expect(mockCreateTaskDecision.mock.calls[0][0].source).toBe("task-generate-decision");
  });

  it("mode:decision passes workspacePath to createTaskDecision", async () => {
    await POST(makeRequest({ description: "x", mode: "decision", workspacePath: "/ws" }));
    expect(mockCreateTaskDecision.mock.calls[0][0]).toMatchObject({ workspacePath: "/ws" });
  });
});
