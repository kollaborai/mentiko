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
const mockResolveChainAgents = jest.fn(
  (agents: unknown[], _namespaceId?: string, _orgId?: string) => agents,
);
jest.mock("@/lib/agents/agent-loader", () => ({
  resolveChainAgents: (...args: [unknown[], string, string]) => mockResolveChainAgents(...args),
}));

jest.mock("@/lib/chains/chain-postprocessor", () => ({
  postProcessChain: (...args: unknown[]) => mockPostProcessChain(...args),
}));

// Ledger IO is mocked in-memory (the real file-backed ledger has its own unit
// suite in lib/chains/generated-chain-rejections.test.ts); the envelope
// builder and canonical hash stay REAL so this route test proves the actual
// fingerprint flow.
const mockFindGeneratedChainRejection = jest.fn().mockReturnValue(undefined);
const mockRecordGeneratedChainRejection = jest.fn();
jest.mock("@/lib/chains/generated-chain-rejections", () => ({
  ...jest.requireActual("@/lib/chains/generated-chain-rejections"),
  findGeneratedChainRejection: (...args: unknown[]) => mockFindGeneratedChainRejection(...args),
  recordGeneratedChainRejection: (...args: unknown[]) => mockRecordGeneratedChainRejection(...args),
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
    // clearAllMocks keeps implementations, so restore the pass-through default
    // (inline agents resolve to themselves) or a $ref-specific implementation
    // set by one test leaks into every test after it.
    mockResolveChainAgents.mockImplementation((agents: unknown[]) => agents);
    mockFindGeneratedChainRejection.mockReturnValue(undefined);
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as jest.Mock;
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
          metadata: {
            generated_chain_contract: {
              version: 1,
              mode: "research",
              acceptance_criteria: "Given the evidence is collected, when the verifier checks the citations, then the report is complete.",
            },
          },
          agents: [{
            id: "agent-a",
            name: "Agent A",
            prompt: "Collect and verify the cited evidence.",
            triggers: ["manual-start"],
            emits: "evidence-verified",
            deliverable: "A cited evidence report",
            verification: "Check every claim against its cited source.",
            final_verifier: true,
            verifies_acceptance_criteria: true,
            success_assertion: "Every cited claim supports the requested report.",
          }],
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

  // Regression: TASK-203 (2026-07-23). With a populated agent catalog the
  // generator obeys the AGENT REUSE RULE and emits {"$ref": "id"} entries whose
  // declarations and authorities live in the registry, not inline. This boundary
  // validated the RAW model output, so a correct catalog-reuse chain looked like
  // it had no deliverable and no edit_files agent and was rejected -- verified
  // live: job-1784821712506-jkbu5wi failed on "requires an agent with edit_files"
  // while the referenced acceptance-criteria-backup-writer in the registry does
  // declare edit_files. /api/chains/save has always resolved before validating.
  test("resolves $ref agents before the delivery contract check so a catalog-reuse chain is not falsely rejected", async () => {
    let currentJob = {
      id: "job-chain",
      type: "generate",
      status: "running",
      taskId: "TASK-203",
      input: {},
      runId: "run-chain",
      chainId: "chain-generation",
      createdAt: "2026-07-23T00:00:00.000Z",
    };
    mockGetJob.mockImplementation(() => currentJob);
    mockUpdateJob.mockImplementation((_id, updates) => {
      currentJob = { ...currentJob, ...updates };
    });
    mockTaskGet.mockReturnValue({
      id: "TASK-203",
      metadata: { generation_job_id: "job-chain", generation_status: "running" },
    });
    // The registry supplies what the bare $ref omits -- exactly what runs.
    mockResolveChainAgents.mockImplementation(() => [{
      id: "acceptance-criteria-backup-writer",
      name: "Backup Writer",
      prompt: "Write the backup.",
      triggers: ["manual-start"],
      emits: "backup-written",
      deliverable: "a timestamped backup file",
      verification: "read the backup file back",
      authorities: { can: ["read_files", "edit_files", "write_artifacts"], needs_approval: [] },
      final_verifier: true,
      verifies_acceptance_criteria: true,
      success_assertion: "the backup contains every original criterion",
    }]);

    const { POST } = await import("./route");

    const response = await POST(makeRequest({
      status: "complete",
      result: {
        output: JSON.stringify({
          name: "Task Acceptance Criteria Backup",
          metadata: {
            generated_chain_contract: {
              version: 1,
              mode: "delivery",
              acceptance_criteria: "a timestamped backup of the runtime task's criteria exists",
            },
          },
          agents: [{ $ref: "acceptance-criteria-backup-writer" }],
        }),
      },
      runId: "run-chain",
      chainId: "chain-generation",
    }), { params: Promise.resolve({ id: "job-chain" }) });

    expect(response.status).toBe(200);
    expect(mockResolveChainAgents).toHaveBeenCalled();
    // accepted: it reached post-processing instead of being marked failed
    expect(mockPostProcessChain).toHaveBeenCalled();
    expect(mockUpdateJob).not.toHaveBeenCalledWith("job-chain", expect.objectContaining({
      status: "failed",
    }), expect.anything());
  });

  // Regression: CHOR-001 (2026-07-20). A generated chain missing an
  // edit_files agent used to raise an uncaught Error from
  // assertValidGeneratedChainDeliveryContract, which the route rethrew,
  // producing a raw 500 AND skipping every side effect below (task metadata
  // update, auto-run continuation) because the handler aborted mid-function.
  // The rejection is an expected outcome of model generation, not a server
  // bug: the job must be marked failed with the validator's exact message
  // (so the bounded auto-run retry can use it as corrective guidance) and
  // the route must return normally instead of throwing.
  test("marks a generate job failed with the validator's message instead of throwing a raw 500 when the delivery contract is violated", async () => {
    let currentJob = {
      id: "job-chain",
      type: "generate",
      status: "running",
      taskId: "TASK-008",
      input: {},
      runId: "run-chain",
      chainId: "chain-generation",
      createdAt: "2026-05-26T00:00:00.000Z",
    };
    mockGetJob.mockImplementation(() => currentJob);
    mockUpdateJob.mockImplementation((_id, updates) => {
      currentJob = { ...currentJob, ...updates };
    });
    mockTaskGet.mockReturnValue({
      id: "TASK-008",
      metadata: { generation_job_id: "job-chain", generation_status: "running" },
    });

    const { POST } = await import("./route");

    const response = await POST(makeRequest({
      status: "complete",
      result: {
        output: JSON.stringify({
          name: "Task Status Updater Chain",
          metadata: {
            generated_chain_contract: {
              version: 1,
              mode: "delivery",
              acceptance_criteria: "TASK-001 shows status='closed'",
            },
          },
          agents: [{
            id: "task-status-updater",
            name: "Task Status Updater",
            prompt: "Update TASK-001 status.",
            triggers: ["manual-start"],
            emits: "task-update-complete",
            deliverable: "TASK-001 status changed to closed",
            verification: "Query the task and confirm status='closed'",
            authorities: { can: ["run_commands", "read_files"], needs_approval: [] },
            final_verifier: true,
            verifies_acceptance_criteria: true,
            success_assertion: "TASK-001 status is closed",
          }],
        }),
      },
      runId: "run-chain",
      chainId: "chain-generation",
    }), { params: Promise.resolve({ id: "job-chain" }) });

    // non-5xx: apiSuccess is mocked to always report status 200
    expect(response.status).toBe(200);
    // rejected before ever reaching postProcessChain
    expect(mockPostProcessChain).not.toHaveBeenCalled();
    expect(mockUpdateJob).toHaveBeenCalledWith("job-chain", expect.objectContaining({
      status: "failed",
      error: expect.stringContaining("delivery generated chains require an agent with edit_files authority"),
    }), "default");
    // the rest of the handler still ran instead of aborting: task metadata
    // reflects the failure so the auto-run retry loop can pick it up
    expect(mockTaskUpdate).toHaveBeenCalledWith("default", "TASK-008", expect.objectContaining({
      metadata: expect.objectContaining({ generation_status: "failed" }),
    }), "default");
  });

  // 2026-07-31 incident (chain-contract-plan-of-record.md A2): lifecycle-
  // flavored prose used to be rejected here by the prose classifier. Prose
  // never blocks now -- this exact chain imports and post-processes cleanly.
  test("accepts lifecycle-flavored prose at the import boundary", async () => {
    let currentJob = {
      id: "job-temporal-chain",
      type: "generate",
      status: "running",
      taskId: "TASK-TEMPORAL",
      input: {},
      runId: "run-temporal-chain",
      chainId: "chain-generation",
      createdAt: "2026-07-30T00:00:00.000Z",
    };
    mockGetJob.mockImplementation(() => currentJob);
    mockUpdateJob.mockImplementation((_id, updates) => {
      currentJob = { ...currentJob, ...updates };
    });
    mockTaskGet.mockReturnValue({
      id: "TASK-TEMPORAL",
      metadata: {
        generation_job_id: "job-temporal-chain",
        generation_status: "running",
      },
    });
    const proseChain = {
      name: "In-Run Lifecycle Prose",
      metadata: {
        generated_chain_contract: {
          version: 1,
          mode: "research",
          acceptance_criteria: "the runtime evidence is recorded",
        },
      },
      agents: [{
        id: "runtime-verifier",
        name: "Runtime Verifier",
        prompt: "Before emitting, verify that the linked task status is open.",
        triggers: ["manual-start"],
        emits: "runtime-verified",
        deliverable: "an evidence-backed runtime verdict",
        verification: "compare observed state with the requested postcondition",
        final_verifier: true,
        verifies_acceptance_criteria: true,
        success_assertion: "runtime evidence is recorded",
      }],
    };
    mockPostProcessChain.mockResolvedValue({ chain: proseChain, createdAgents: [], extractedCount: 0 });

    const { POST } = await import("./route");
    const response = await POST(makeRequest({
      status: "complete",
      result: { output: JSON.stringify(proseChain) },
      runId: "run-temporal-chain",
      chainId: "chain-generation",
    }), { params: Promise.resolve({ id: "job-temporal-chain" }) });

    expect(response.status).toBe(200);
    expect(mockPostProcessChain).toHaveBeenCalled();
    expect(currentJob.status).toBe("complete");
    expect(mockRecordGeneratedChainRejection).not.toHaveBeenCalled();
  });

  // A3/A4: a STRUCTURAL rejection produces the typed envelope, records it in
  // the shared ledger, and persists the fingerprint decision on the task so
  // the auto-run retry path can branch on typed data.
  test("records a typed rejection envelope for a structural contract failure", async () => {
    let currentJob = {
      id: "job-structural-chain",
      type: "generate",
      status: "running",
      taskId: "TASK-STRUCTURAL",
      input: {},
      runId: "run-structural-chain",
      chainId: "chain-generation",
      createdAt: "2026-07-30T00:00:00.000Z",
    };
    mockGetJob.mockImplementation(() => currentJob);
    mockUpdateJob.mockImplementation((_id, updates) => {
      currentJob = { ...currentJob, ...updates };
    });
    mockTaskGet.mockReturnValue({
      id: "TASK-STRUCTURAL",
      metadata: {
        generation_job_id: "job-structural-chain",
        generation_status: "running",
      },
    });

    const { POST } = await import("./route");
    const response = await POST(makeRequest({
      status: "complete",
      result: {
        output: JSON.stringify({
          name: "No Verifier Chain",
          metadata: {
            generated_chain_contract: {
              version: 1,
              mode: "research",
              acceptance_criteria: "evidence exists",
            },
          },
          agents: [{
            id: "observer",
            name: "Observer",
            triggers: ["manual-start"],
            emits: "observed",
            verification: "re-read the report",
          }],
        }),
      },
      runId: "run-structural-chain",
      chainId: "chain-generation",
    }), { params: Promise.resolve({ id: "job-structural-chain" }) });

    expect(response.status).toBe(200);
    expect(mockPostProcessChain).not.toHaveBeenCalled();
    expect(currentJob.status).toBe("failed");
    expect(currentJob).toMatchObject({
      error: expect.stringContaining("agents[0].deliverable"),
    });
    expect(mockRecordGeneratedChainRejection).toHaveBeenCalledWith(
      "default",
      "default",
      expect.objectContaining({
        phase: "import",
        deterministic: true,
        code: "generated_chain_contract_violation",
        artifact_hash: expect.stringMatching(/^sha256:/),
        paths: expect.arrayContaining(["agents[0].deliverable"]),
      }),
    );
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-STRUCTURAL",
      expect.objectContaining({
        metadata: expect.objectContaining({
          generation_rejection: expect.objectContaining({ phase: "import" }),
          generation_rejection_job_id: "job-structural-chain",
          generation_rejection_fingerprints: [expect.stringMatching(/^sha256:/)],
        }),
      }),
      "default",
    );
  });

  // A4: an artifact already in the rejection ledger fails fast (no
  // re-validation, no post-processing) and the repeat fingerprint stops the
  // loop via generation_stop_reason.
  test("stops a known-rejected artifact at the import boundary without re-validating", async () => {
    const { buildGeneratedChainRejectionEnvelope, generatedChainRejectionFingerprint } =
      jest.requireActual("@/lib/chains/generated-chain-rejections");
    const rejectedChain = {
      name: "Previously Rejected",
      metadata: {
        generated_chain_contract: {
          version: 1,
          mode: "research",
          acceptance_criteria: "evidence exists",
        },
      },
      agents: [{
        id: "observer",
        name: "Observer",
        triggers: ["manual-start"],
        emits: "observed",
        deliverable: "an observation report",
        verification: "re-read the report",
      }],
    };
    const priorEnvelope = buildGeneratedChainRejectionEnvelope({
      phase: "import",
      chain: rejectedChain,
      errors: ["the last generated-chain agent must declare final_verifier: true"],
    });
    mockFindGeneratedChainRejection.mockReturnValue(priorEnvelope);

    let currentJob = {
      id: "job-duplicate-chain",
      type: "generate",
      status: "running",
      taskId: "TASK-DUPLICATE",
      input: {},
      runId: "run-duplicate-chain",
      chainId: "chain-generation",
      createdAt: "2026-07-30T00:00:00.000Z",
    };
    mockGetJob.mockImplementation(() => currentJob);
    mockUpdateJob.mockImplementation((_id, updates) => {
      currentJob = { ...currentJob, ...updates };
    });
    // The task already saw this fingerprint once -- the repeat must STOP.
    mockTaskGet.mockReturnValue({
      id: "TASK-DUPLICATE",
      metadata: {
        generation_job_id: "job-duplicate-chain",
        generation_status: "running",
        generation_rejection_fingerprints: [generatedChainRejectionFingerprint(priorEnvelope)],
      },
    });

    const { POST } = await import("./route");
    const response = await POST(makeRequest({
      status: "complete",
      result: { output: JSON.stringify(rejectedChain) },
      runId: "run-duplicate-chain",
      chainId: "chain-generation",
    }), { params: Promise.resolve({ id: "job-duplicate-chain" }) });

    expect(response.status).toBe(200);
    expect(mockPostProcessChain).not.toHaveBeenCalled();
    expect(currentJob.status).toBe("failed");
    // Already recorded: a duplicate must not append another ledger entry.
    expect(mockRecordGeneratedChainRejection).not.toHaveBeenCalled();
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-DUPLICATE",
      expect.objectContaining({
        metadata: expect.objectContaining({
          generation_stop_reason: "deterministic_duplicate",
        }),
      }),
      "default",
    );
  });

  test("fails a generate completion with no valid chain result and continues auto-recovery", async () => {
    let currentJob = {
      id: "job-chain-empty",
      type: "generate",
      status: "running",
      taskId: "FEAT-001",
      input: {},
      result: undefined,
      runId: "run-chain-empty",
      chainId: "chain-generation",
      createdAt: "2026-07-21T23:02:06.000Z",
    };
    mockGetJob.mockImplementation(() => currentJob);
    mockUpdateJob.mockImplementation((_id, updates) => {
      currentJob = { ...currentJob, ...updates };
    });
    mockTaskGet.mockReturnValue({
      id: "FEAT-001",
      workspace_id: "/repo/fresh-project",
      metadata: {
        auto_run: true,
        generation_job_id: "job-chain-empty",
        generation_status: "running",
      },
    });

    const { POST } = await import("./route");
    const response = await POST(makeRequest({
      status: "complete",
      runId: "run-chain-empty",
      chainId: "chain-generation",
    }), { params: Promise.resolve({ id: "job-chain-empty" }) });

    expect(response.status).toBe(200);
    expect(mockUpdateJob).toHaveBeenCalledWith("job-chain-empty", expect.objectContaining({
      status: "failed",
      error: expect.stringContaining("without a valid JSON chain payload"),
    }), "default");
    expect(mockTaskUpdate).toHaveBeenCalledWith("default", "FEAT-001", expect.objectContaining({
      metadata: expect.objectContaining({ generation_status: "failed" }),
    }), "default");
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/tasks/auto-run",
      expect.objectContaining({ method: "POST" }),
    );
  });

  // Regression guard: only the delivery-contract rejection gets the graceful
  // handling above. A genuine internal error during post-processing (e.g.
  // postProcessChain itself throwing) must still surface as a thrown error
  // so it is not silently swallowed as if it were an expected generation
  // rejection.
  test("still throws (not swallowed) when post-processing fails for a reason other than the delivery contract", async () => {
    let currentJob = {
      id: "job-chain",
      type: "generate",
      status: "running",
      input: {},
      runId: "run-chain",
      chainId: "chain-generation",
      createdAt: "2026-05-26T00:00:00.000Z",
    };
    mockGetJob.mockImplementation(() => currentJob);
    mockUpdateJob.mockImplementation((_id, updates) => {
      currentJob = { ...currentJob, ...updates };
    });
    mockPostProcessChain.mockRejectedValueOnce(new Error("registry write failed"));

    const { POST } = await import("./route");

    await expect(POST(makeRequest({
      status: "complete",
      result: {
        output: JSON.stringify({
          name: "Generated Chain",
          metadata: {
            generated_chain_contract: {
              version: 1,
              mode: "research",
              acceptance_criteria: "the report is complete",
            },
          },
          agents: [{
            id: "agent-a",
            name: "Agent A",
            prompt: "Collect evidence.",
            triggers: ["manual-start"],
            emits: "evidence-verified",
            deliverable: "A cited evidence report",
            verification: "Check every claim against its source.",
            authorities: ["read_files"],
            final_verifier: true,
            verifies_acceptance_criteria: true,
            success_assertion: "Every claim is cited.",
          }],
        }),
      },
      runId: "run-chain",
      chainId: "chain-generation",
    }), { params: Promise.resolve({ id: "job-chain" }) })).rejects.toThrow("registry write failed");

    expect(mockUpdateJob).toHaveBeenCalledWith("job-chain", expect.objectContaining({
      status: "failed",
      error: "registry write failed",
    }), "default");
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

  test("failed task run summary releases its execution fingerprint for a bounded retry", async () => {
    let currentJob = {
      id: "job-task-summary-failed",
      type: "task_run_summary",
      status: "running",
      taskId: "TASK-079",
      input: { sourceRunId: "run-execution", runFingerprint: "completed:f1" },
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
      id: "TASK-079",
      metadata: {
        last_run_id: "run-execution",
        task_outcome_summary_run_fingerprint: "completed:f1",
        summarized_run_fingerprints: ["run-execution::completed:f1", "run-older::completed:old"],
      },
    });

    const { POST } = await import("./route");
    const response = await POST(makeRequest({
      status: "failed",
      error: "agent capacity unavailable",
    }), { params: Promise.resolve({ id: "job-task-summary-failed" }) });

    expect(response.status).toBe(200);
    expect(mockTaskUpdate).toHaveBeenCalledWith("default", "TASK-079", {
      metadata: expect.objectContaining({
        task_outcome_summary_status: "failed",
        task_outcome_summary_error: "agent capacity unavailable",
        task_outcome_summary_run_fingerprint: undefined,
        task_outcome_summary_failures: 1,
        summarized_run_fingerprints: ["run-older::completed:old"],
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
      result: {
        output: JSON.stringify({
          name: "Generated Chain",
          metadata: {
            generated_chain_contract: {
              version: 1,
              mode: "research",
              acceptance_criteria: "The requested evidence is verified.",
            },
          },
          agents: [{
            id: "verifier",
            name: "Verifier",
            prompt: "Collect and verify evidence.",
            triggers: ["manual-start"],
            emits: "evidence-verified",
            deliverable: "Verified evidence",
            verification: "Check the evidence against the request.",
            final_verifier: true,
            verifies_acceptance_criteria: true,
            success_assertion: "The requested evidence is verified.",
          }],
        }),
      },
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
