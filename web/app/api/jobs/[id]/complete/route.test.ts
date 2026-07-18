/**
 * @jest-environment node
 */

export {};

import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const mockGetNamespaceIdFromRequest = jest.fn().mockResolvedValue("default");
const mockGetOrgIdFromRequest = jest.fn().mockResolvedValue("default");
jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: (...args: unknown[]) => mockGetNamespaceIdFromRequest(...args),
  getOrgIdFromRequest: (...args: unknown[]) => mockGetOrgIdFromRequest(...args),
}));

const mockHasInternalAuth = jest.fn().mockReturnValue(true);
jest.mock("@/lib/auth/internal-api-auth", () => ({
  hasInternalAuth: (...args: unknown[]) => mockHasInternalAuth(...args),
}));

jest.mock("@/lib/api-response", () => ({
  withErrorHandling: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  apiSuccess: (data: unknown) => ({ status: 200, json: async () => data }),
}));

jest.mock("@/lib/api-errors", () => ({
  Unauthorized: class Unauthorized extends Error {},
  NotFound: class NotFound extends Error {
    constructor(entity: string, id: string) {
      super(`${entity} ${id} not found`);
    }
  },
}));

const mockGetJob = jest.fn();
const mockUpdateJob = jest.fn();
jest.mock("@/lib/runs/job-store", () => ({
  getJob: (...args: unknown[]) => mockGetJob(...args),
  updateJob: (...args: unknown[]) => mockUpdateJob(...args),
}));

const mockTaskCreate = jest.fn();
const mockTaskAddDep = jest.fn();
const mockTaskGet = jest.fn();
const mockTaskUpdate = jest.fn();
const mockTaskDb = {
  transaction: (fn: () => unknown) => fn,
  prepare: jest.fn().mockReturnValue({
    all: jest.fn().mockReturnValue([]),
  }),
};
jest.mock("@/lib/tasks/task-store", () => ({
  _getDb: jest.fn().mockReturnValue(mockTaskDb),
  taskCreate: (...args: unknown[]) => mockTaskCreate(...args),
  taskAddDep: (...args: unknown[]) => mockTaskAddDep(...args),
  taskGet: (...args: unknown[]) => mockTaskGet(...args),
  taskUpdate: (...args: unknown[]) => mockTaskUpdate(...args),
}));

const mockGetDecision = jest.fn();
const mockUpdateDecision = jest.fn();
jest.mock("@/lib/decisions/decision-storage", () => ({
  getDecision: (...args: unknown[]) => mockGetDecision(...args),
  updateDecision: (...args: unknown[]) => mockUpdateDecision(...args),
}));

const mockPostProcessChain = jest.fn();
jest.mock("@/lib/chains/chain-postprocessor", () => ({
  postProcessChain: (...args: unknown[]) => mockPostProcessChain(...args),
}));

jest.mock("@/lib/auth/internal-web-origin", () => ({
  internalApiUrl: (path: string) => `http://localhost:3000${path}`,
}));

const mockApplyDecisionRunResult = jest.fn();
jest.mock("@/lib/decisions/decision-run-results", () => ({
  applyDecisionRunResult: (...args: unknown[]) => mockApplyDecisionRunResult(...args),
}));

const mockAdvanceDecisionAfterPhase = jest.fn();
jest.mock("@/lib/decisions/decision-auto-advance", () => ({
  advanceDecisionAfterPhase: (...args: unknown[]) => mockAdvanceDecisionAfterPhase(...args),
}));

const mockApplyCompletionAudit = jest.fn();
jest.mock("@/lib/tasks/completion-audit-apply", () => ({
  applyCompletionAudit: (...args: unknown[]) => mockApplyCompletionAudit(...args),
}));

const mockEnforceDeliveryGate = jest.fn((...args: unknown[]) => args[0]);
jest.mock("@/lib/tasks/completion-audit-delivery-gate", () => ({
  enforceDeliveryGate: (...args: unknown[]) => mockEnforceDeliveryGate(...args),
}));

const mockOutcomeSummarySourceEligibility = jest.fn(
  (_namespaceId: string, _orgId: string, _runId: string, expectedFingerprint?: string): {
    eligible: boolean;
    status: string;
    fingerprint: string;
    reason?: string;
  } => ({
    eligible: true,
    status: "completed",
    fingerprint: expectedFingerprint || "completed:current",
  }),
);
jest.mock("@/lib/tasks/run-outcome-evidence", () => ({
  outcomeSummarySourceEligibility: (
    namespaceId: string,
    orgId: string,
    runId: string,
    expectedFingerprint?: string,
  ) => mockOutcomeSummarySourceEligibility(namespaceId, orgId, runId, expectedFingerprint),
}));

let linkRunDir = "";
jest.mock("@/lib/links/link-run-runtime", () => ({
  resolveLinkRunPaths: jest.fn(() => ({ runDir: linkRunDir })),
}));

function makeRequest(body: Record<string, unknown>) {
  return {
    json: async () => body,
    headers: new Headers({ authorization: "Bearer test" }),
    url: "http://localhost:3000/api/jobs/job-task/complete",
    method: "POST",
  } as never;
}

function generatedTask() {
  return {
    title: "Expand E2E test coverage for critical user workflows",
    description: "Add coverage for the main flows.",
    type: "epic",
    priority: 2,
    labels: ["testing", "e2e"],
    subtasks: [
      {
        title: "Add login flow coverage",
        description: "Cover login success and failure.",
        type: "task",
        priority: 1,
      },
      {
        title: "Add task generation flow coverage",
        description: "Cover task generation through import.",
        type: "task",
        priority: 1,
        depends_on: [0],
      },
    ],
  };
}

describe("POST /api/jobs/[id]/complete", () => {
  afterEach(() => {
    if (linkRunDir) {
      rmSync(linkRunDir, { recursive: true, force: true });
      linkRunDir = "";
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockOutcomeSummarySourceEligibility.mockImplementation(
      (_namespaceId: string, _orgId: string, _runId: string, expectedFingerprint?: string) => ({
        eligible: true,
        status: "completed",
        fingerprint: expectedFingerprint || "completed:current",
      }),
    );

    let currentJob = {
      id: "job-task",
      type: "task",
      status: "running",
      input: {
        workspacePath: "/repo/mentiko",
        taskGenerationMetadata: {
          created_by_session: "session-1",
        },
      },
      runId: "run-task",
      chainId: "task-generation",
      createdAt: "2026-05-26T00:00:00.000Z",
    };

    mockGetJob.mockImplementation(() => currentJob);
    mockUpdateJob.mockImplementation((_id, updates) => {
      currentJob = { ...currentJob, ...updates };
    });
    mockTaskGet.mockImplementation((_orgId, taskId) => ({
      id: taskId,
      metadata: {},
    }));
    mockPostProcessChain.mockResolvedValue({
      chain: {
        name: "Processed Chain",
        agents: [{ $ref: "processed-agent" }],
      },
      createdAgents: ["processed-agent"],
      extractedCount: 1,
    });
    mockApplyCompletionAudit.mockResolvedValue({ action: "closed" });
    mockEnforceDeliveryGate.mockImplementation((audit) => audit);
    mockGetDecision.mockReturnValue(null);
    mockUpdateDecision.mockResolvedValue(undefined);
    mockApplyDecisionRunResult.mockResolvedValue(undefined);

    let createCount = 0;
    mockTaskCreate.mockImplementation((_orgId, input) => {
      createCount += 1;
      return {
        id: createCount === 1 ? "EPIC-001" : `TASK-00${createCount - 1}`,
        title: input.title,
        issue_type: input.issue_type,
        priority: input.priority,
      };
    });
  });

  test("creates the generated task tree when a task generation job completes", async () => {
    const { POST } = await import("./route");

    const response = await POST(makeRequest({
      status: "complete",
      result: generatedTask(),
      runId: "run-task",
      chainId: "task-generation",
      generationKind: "task",
    }), { params: Promise.resolve({ id: "job-task" }) });

    expect(response.status).toBe(200);
    expect(mockTaskCreate).toHaveBeenCalledTimes(3);
    expect(mockTaskCreate.mock.calls[0][1]).toEqual(expect.objectContaining({
      title: "Expand E2E test coverage for critical user workflows",
      issue_type: "epic",
      workspace_id: "/repo/mentiko",
      metadata: expect.objectContaining({
        task_generation_job_id: "job-task",
        task_generation_run_id: "run-task",
        created_by_session: "session-1",
        workspace_path: "/repo/mentiko",
      }),
    }));
    expect(mockTaskCreate.mock.calls[0][1].metadata).not.toHaveProperty("generation_job_id");
    expect(mockTaskCreate.mock.calls[0][1].metadata).not.toHaveProperty("generation_status");
    expect(mockTaskCreate.mock.calls[1][1]).toEqual(expect.objectContaining({
      title: "Add login flow coverage",
      parent_id: "EPIC-001",
      workspace_id: "/repo/mentiko",
    }));
    expect(mockTaskCreate.mock.calls[2][1]).toEqual(expect.objectContaining({
      title: "Add task generation flow coverage",
      parent_id: "EPIC-001",
      workspace_id: "/repo/mentiko",
    }));
    expect(mockTaskAddDep).toHaveBeenCalledWith("default", "TASK-002", "TASK-001", "default", "/repo/mentiko");
    expect(mockUpdateJob).toHaveBeenCalledWith("job-task", expect.objectContaining({
      taskId: "EPIC-001",
      result: expect.objectContaining({
        createdTaskIds: ["EPIC-001", "TASK-001", "TASK-002"],
      }),
    }), "default");
    expect(mockTaskUpdate).not.toHaveBeenCalled();
  });

  test("unwraps the job runner output envelope before importing a generated task", async () => {
    const { POST } = await import("./route");

    const response = await POST(makeRequest({
      status: "complete",
      result: {
        output: JSON.stringify({
          route: "task",
          task: generatedTask(),
        }),
      },
      runId: "run-task",
      chainId: "task-generation",
      generationKind: "task",
    }), { params: Promise.resolve({ id: "job-task" }) });

    expect(response.status).toBe(200);
    expect(mockTaskCreate).toHaveBeenCalledTimes(3);
    expect(mockTaskCreate.mock.calls[0][1]).toEqual(expect.objectContaining({
      title: "Expand E2E test coverage for critical user workflows",
      workspace_id: "/repo/mentiko",
    }));
    expect(mockUpdateJob).toHaveBeenCalledWith("job-task", expect.objectContaining({
      status: "complete",
    }), "default");
    expect(mockUpdateJob).not.toHaveBeenCalledWith("job-task", expect.objectContaining({
      status: "failed",
    }), "default");
  });

  test("retries a complete task generation job when task import side effects are missing", async () => {
    let currentJob = {
      id: "job-task",
      type: "task",
      status: "complete",
      input: {
        workspacePath: "/repo/mentiko",
      },
      result: generatedTask(),
      runId: "run-task",
      chainId: "task-generation",
      createdAt: "2026-05-26T00:00:00.000Z",
    };
    mockGetJob.mockImplementation(() => currentJob);
    mockUpdateJob.mockImplementation((_id, updates) => {
      currentJob = { ...currentJob, ...updates };
    });

    const { POST } = await import("./route");

    const response = await POST(makeRequest({
      status: "complete",
      result: generatedTask(),
      runId: "run-task",
      chainId: "task-generation",
      generationKind: "task",
    }), { params: Promise.resolve({ id: "job-task" }) });

    expect(response.status).toBe(200);
    expect(mockTaskCreate).toHaveBeenCalledTimes(3);
    expect(mockUpdateJob).toHaveBeenCalledWith("job-task", expect.objectContaining({
      taskId: "EPIC-001",
    }), "default");
  });

  test("hands the exact completed decision run to the auto-advance driver", async () => {
    let currentJob = {
      id: "job-decision-questions",
      type: "decision_guided_questions",
      status: "running",
      decisionId: "dec-questions",
      input: { workspacePath: "/repo/mentiko" },
      runId: "run-decision-questions",
      chainId: "decision-guided-questions",
      createdAt: "2026-05-26T00:00:00.000Z",
    };
    mockGetJob.mockImplementation(() => currentJob);
    mockUpdateJob.mockImplementation((_id, updates) => {
      currentJob = { ...currentJob, ...updates };
    });
    mockGetDecision.mockReturnValue({ id: "dec-questions", workspacePath: "/repo/mentiko" });
    const advancedDecision = {
      id: "dec-questions",
      status: "briefed",
      options: [],
      workspacePath: "/repo/mentiko",
    };
    mockApplyDecisionRunResult.mockResolvedValue(advancedDecision);

    const { POST } = await import("./route");
    const response = await POST(makeRequest({
      status: "complete",
      result: { questions: [{ id: "q-1" }] },
      runId: "run-decision-questions",
      chainId: "decision-guided-questions",
    }), { params: Promise.resolve({ id: "job-decision-questions" }) });

    expect(response.status).toBe(200);
    expect(mockApplyDecisionRunResult).toHaveBeenCalledWith(expect.objectContaining({
      decisionId: "dec-questions",
      phase: "questions",
      runId: "run-decision-questions",
      workspacePath: "/repo/mentiko",
    }));
    expect(mockAdvanceDecisionAfterPhase).toHaveBeenCalledWith({
      namespaceId: "default",
      orgId: "default",
      decision: advancedDecision,
    });
  });

  test("repairs a decision phase when a complete-job retry follows a partial failure", async () => {
    let currentJob = {
      id: "job-decision-repair",
      type: "decision_guided_questions",
      status: "complete",
      decisionId: "dec-repair",
      input: { workspacePath: "/repo/mentiko" },
      result: { questions: [{ id: "q-1" }] },
      runId: "run-decision-repair",
      chainId: "decision-guided-questions",
      createdAt: "2026-05-26T00:00:00.000Z",
    };
    mockGetJob.mockImplementation(() => currentJob);
    mockUpdateJob.mockImplementation((_id, updates) => {
      currentJob = { ...currentJob, ...updates };
    });
    mockGetDecision.mockReturnValue({ id: "dec-repair", workspacePath: "/repo/mentiko" });
    const repairedDecision = { id: "dec-repair", status: "briefed", options: [] };
    mockApplyDecisionRunResult
      .mockRejectedValueOnce(new Error("temporary decision write failure"))
      .mockResolvedValueOnce(repairedDecision);

    const { POST } = await import("./route");
    await POST(makeRequest({ status: "complete" }), { params: Promise.resolve({ id: "job-decision-repair" }) });
    await POST(makeRequest({ status: "complete" }), { params: Promise.resolve({ id: "job-decision-repair" }) });

    expect(mockApplyDecisionRunResult).toHaveBeenCalledTimes(2);
    expect(mockAdvanceDecisionAfterPhase).toHaveBeenCalledTimes(1);
    expect(mockAdvanceDecisionAfterPhase).toHaveBeenLastCalledWith({
      namespaceId: "default",
      orgId: "default",
      decision: repairedDecision,
    });
  });

  test("post-processes generated chain agents in the request namespace and org", async () => {
    mockGetNamespaceIdFromRequest.mockResolvedValueOnce("team-a");
    mockGetOrgIdFromRequest.mockResolvedValueOnce("org-a");
    let currentJob = {
      id: "job-chain",
      type: "generate",
      status: "running",
      input: {
        namespaceId: "team-a",
        orgId: "org-a",
      },
      runId: "run-chain",
      chainId: "chain-generation",
      createdAt: "2026-05-26T00:00:00.000Z",
    };
    mockGetJob.mockImplementation(() => currentJob);
    mockUpdateJob.mockImplementation((_id, updates) => {
      currentJob = { ...currentJob, ...updates };
    });

    const { POST } = await import("./route");

    const response = await POST(makeRequest({
      status: "complete",
      result: {
        output: JSON.stringify({
          name: "Generated Chain",
          agents: [{ id: "agent-a", name: "Agent A", prompt: "Do work" }],
        }),
      },
      runId: "run-chain",
      chainId: "chain-generation",
    }), { params: Promise.resolve({ id: "job-chain" }) });

    expect(response.status).toBe(200);
    expect(mockPostProcessChain).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Generated Chain" }),
      "team-a",
      "org-a",
    );
    expect(mockUpdateJob).toHaveBeenCalledWith("job-chain", expect.objectContaining({
      result: expect.objectContaining({
        createdAgents: ["processed-agent"],
        extractedCount: 1,
      }),
    }), "team-a");
  });

  test("recommend completion stores recommendation run provenance without clobbering execution run", async () => {
    let currentJob = {
      id: "job-recommend",
      type: "recommend",
      status: "running",
      taskId: "CHOR-001",
      input: {},
      runId: "run-recommend",
      chainId: "chain-recommendation",
      createdAt: "2026-05-26T00:00:00.000Z",
    };
    mockGetJob.mockImplementation(() => currentJob);
    mockUpdateJob.mockImplementation((_id, updates) => {
      currentJob = { ...currentJob, ...updates };
    });
    mockTaskGet.mockReturnValue({
      id: "CHOR-001",
      metadata: {
        chain_id: "assigned-chain",
        chain_name: "Assigned Chain",
        last_run_id: "run-execution",
        last_run_status: "complete",
      },
    });

    const { POST } = await import("./route");

    const response = await POST(makeRequest({
      status: "complete",
      result: { recommendation: { action: "use_existing" } },
      runId: "run-recommend",
      chainId: "chain-recommendation",
    }), { params: Promise.resolve({ id: "job-recommend" }) });

    expect(response.status).toBe(200);
    expect(mockTaskUpdate).toHaveBeenCalledWith("default", "CHOR-001", {
      metadata: expect.objectContaining({
        chain_id: "assigned-chain",
        last_run_id: "run-execution",
        analysis_status: "complete",
        recommendation_run_id: "run-recommend",
        recommendation_chain_id: "chain-recommendation",
      }),
    }, "default");
  });

  test("retries a complete link summary job when summary side effect is missing", async () => {
    linkRunDir = mkdtempSync(join(tmpdir(), "link-summary-run-"));
    let currentJob = {
      id: "job-link-summary",
      type: "link_summary",
      status: "complete",
      input: { runId: "link-run-1" },
      result: { summary: "Recovered summary" },
      runId: "run-link-summary",
      chainId: "link-summary",
      createdAt: "2026-05-26T00:00:00.000Z",
    };
    mockGetJob.mockImplementation(() => currentJob);
    mockUpdateJob.mockImplementation((_id, updates) => {
      currentJob = { ...currentJob, ...updates };
    });

    const { POST } = await import("./route");

    const response = await POST(makeRequest({}), { params: Promise.resolve({ id: "job-link-summary" }) });

    expect(response.status).toBe(200);
    const summaryPath = join(linkRunDir, "summary.json");
    expect(existsSync(summaryPath)).toBe(true);
    expect(JSON.parse(readFileSync(summaryPath, "utf8"))).toEqual({ summary: "Recovered summary" });
  });

  test("task run summary completion writes dashboard summary metadata", async () => {
    let currentJob = {
      id: "job-task-summary",
      type: "task_run_summary",
      status: "running",
      taskId: "TASK-070",
      input: { sourceRunId: "run-execution", runFingerprint: "completed:2026-07-08T01:23:55.573Z" },
      result: undefined,
      runId: "run-summary",
      chainId: "run-summary-generation",
      createdAt: "2026-05-26T00:00:00.000Z",
    };
    mockGetJob.mockImplementation(() => currentJob);
    mockUpdateJob.mockImplementation((_id, updates) => {
      currentJob = { ...currentJob, ...updates };
    });
    mockTaskGet.mockReturnValue({
      id: "TASK-070",
      metadata: {
        last_run_id: "run-execution",
        chain_id: "cli-agnostic-pointer-validator-v4",
      },
    });

    const { POST } = await import("./route");

    const result = {
      headline: "Pointer validation completed",
      narrative: "The run completed and produced the required proof artifact.",
      outcome: "complete",
      confidence: "high",
      decision_required: false,
      what_happened: ["created proof artifact"],
      evidence: ["cli-agnostic-pointer-proof-v4.json"],
      improvement_signals: ["No orchestration issue detected."],
      next_actions: [],
    };
    const response = await POST(makeRequest({
      status: "complete",
      result,
      runId: "run-summary",
      chainId: "run-summary-generation",
    }), { params: Promise.resolve({ id: "job-task-summary" }) });

    expect(response.status).toBe(200);
    expect(mockTaskUpdate).toHaveBeenCalledWith("default", "TASK-070", {
      metadata: expect.objectContaining({
        last_run_id: "run-execution",
        task_outcome_summary_status: "complete",
        task_outcome_summary_job_id: "job-task-summary",
        task_outcome_summary_run_id: "run-summary",
        task_outcome_summary_chain_id: "run-summary-generation",
        task_outcome_summary_source_run_id: "run-execution",
        task_outcome_summary: result,
      }),
    }, "default");
  });

  test("supersedes a summary whose execution source was non-terminal or changed before delivery", async () => {
    let currentJob = {
      id: "job-stale-summary",
      type: "task_run_summary",
      status: "running",
      taskId: "TASK-070",
      input: { sourceRunId: "run-execution", runFingerprint: "running:no-terminal-time" },
      result: undefined,
      runId: "run-summary",
      chainId: "run-summary-generation",
      createdAt: "2026-05-26T00:00:00.000Z",
    };
    mockGetJob.mockImplementation(() => currentJob);
    mockUpdateJob.mockImplementation((_id, updates) => {
      currentJob = { ...currentJob, ...updates };
    });
    mockTaskGet.mockReturnValue({ id: "TASK-070", title: "Fix ingestion", issue_type: "bug", metadata: {} });
    mockOutcomeSummarySourceEligibility.mockReturnValue({
      eligible: false,
      status: "stopped",
      fingerprint: "stopped:terminal-time",
      reason: "execution source changed before summary delivery",
    });

    const { POST } = await import("./route");
    const response = await POST(makeRequest({
      status: "complete",
      result: { audit: { verdict: "decision", reason: "wait" } },
    }), { params: Promise.resolve({ id: "job-stale-summary" }) });

    expect(response.status).toBe(200);
    expect(mockTaskUpdate).toHaveBeenCalledWith("default", "TASK-070", {
      metadata: expect.objectContaining({
        task_outcome_summary_status: "superseded",
        task_outcome_summary: undefined,
        task_outcome_summary_completed_at: undefined,
        task_outcome_summary_error: "execution source changed before summary delivery",
      }),
    }, "default");
    expect(mockApplyCompletionAudit).not.toHaveBeenCalled();
  });

  test("task run summary completion applies audit verdict embedded in output string", async () => {
    let currentJob = {
      id: "job-task-summary",
      type: "task_run_summary",
      status: "running",
      taskId: "TASK-094",
      input: {
        sourceRunId: "run-execution",
        runFingerprint: "completed:2026-07-08T01:31:46.726Z",
        workspacePath: "/repo/realtor-website",
      },
      result: undefined,
      runId: "run-summary",
      chainId: "run-summary-generation",
      createdAt: "2026-05-26T00:00:00.000Z",
    };
    mockGetJob.mockImplementation(() => currentJob);
    mockUpdateJob.mockImplementation((_id, updates) => {
      currentJob = { ...currentJob, ...updates };
    });
    mockTaskGet.mockReturnValue({
      id: "TASK-094",
      title: "Design and implement landing page components",
      issue_type: "task",
      metadata: {
        last_run_id: "run-execution",
        chain_id: "realtor-landing-page-delivery-pipeline",
      },
    });

    const { POST } = await import("./route");
    const result = {
      output: JSON.stringify({
        headline: "Implementation verified",
        audit: {
          verdict: "close",
          reason: "All acceptance checks passed against the live app.",
        },
      }),
    };

    const response = await POST(makeRequest({
      status: "complete",
      result,
      runId: "run-summary",
      chainId: "run-summary-generation",
    }), { params: Promise.resolve({ id: "job-task-summary" }) });

    expect(response.status).toBe(200);
    expect(mockApplyCompletionAudit).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "default",
      namespaceId: "default",
      task: expect.objectContaining({ id: "TASK-094" }),
      audit: { verdict: "close", reason: "All acceptance checks passed against the live app." },
      runId: "run-execution",
      runFingerprint: "completed:2026-07-08T01:31:46.726Z",
      workspacePath: "/repo/realtor-website",
      metadata: expect.objectContaining({ last_run_id: "run-execution" }),
    }));
  });

  test("generate completion stores generated-chain run provenance without clobbering execution run", async () => {
    let currentJob = {
      id: "job-generate",
      type: "generate",
      status: "running",
      taskId: "CHOR-001",
      input: {},
      runId: "run-generate",
      chainId: "chain-generation",
      createdAt: "2026-05-26T00:00:00.000Z",
    };
    mockGetJob.mockImplementation(() => currentJob);
    mockUpdateJob.mockImplementation((_id, updates) => {
      currentJob = { ...currentJob, ...updates };
    });
    mockTaskGet.mockReturnValue({
      id: "CHOR-001",
      metadata: {
        chain_id: "assigned-chain",
        last_run_id: "run-execution",
        last_run_status: "complete",
      },
    });

    const { POST } = await import("./route");

    const response = await POST(makeRequest({
      status: "complete",
      result: { output: "{}" },
      runId: "run-generate",
      chainId: "chain-generation",
    }), { params: Promise.resolve({ id: "job-generate" }) });

    expect(response.status).toBe(200);
    expect(mockTaskUpdate).toHaveBeenCalledWith("default", "CHOR-001", {
      metadata: expect.objectContaining({
        chain_id: "assigned-chain",
        last_run_id: "run-execution",
        generation_status: "complete",
        generated_chain_run_id: "run-generate",
        generated_chain_source_chain_id: "chain-generation",
      }),
    }, "default");
  });

  test("recommend completion clears a legacy audit run from last_run_id", async () => {
    let currentJob = {
      id: "job-recommend",
      type: "recommend",
      status: "running",
      taskId: "CHOR-001",
      input: {},
      runId: "run-recommend",
      chainId: "chain-recommendation",
      createdAt: "2026-05-26T00:00:00.000Z",
    };
    mockGetJob.mockImplementation(() => currentJob);
    mockUpdateJob.mockImplementation((_id, updates) => {
      currentJob = { ...currentJob, ...updates };
    });
    mockTaskGet.mockReturnValue({
      id: "CHOR-001",
      metadata: {
        chain_id: "assigned-chain",
        last_run_id: "run-recommend",
        last_run_status: "running",
      },
    });

    const { POST } = await import("./route");

    await POST(makeRequest({
      status: "complete",
      result: { recommendation: { action: "use_existing" } },
      runId: "run-recommend",
      chainId: "chain-recommendation",
    }), { params: Promise.resolve({ id: "job-recommend" }) });

    const metadata = mockTaskUpdate.mock.calls.at(-1)?.[2]?.metadata;
    expect(metadata).toEqual(expect.objectContaining({
      recommendation_run_id: "run-recommend",
      recommendation_chain_id: "chain-recommendation",
      analysis_status: "complete",
    }));
    expect(metadata).not.toHaveProperty("last_run_id");
    expect(metadata).not.toHaveProperty("last_run_status");
  });
});
