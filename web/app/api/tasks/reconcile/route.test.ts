/**
 * @jest-environment node
 */

const mockCheckAuth = jest.fn();
jest.mock("@/lib/auth/api-auth", () => ({
  checkAuth: (...args: unknown[]) => mockCheckAuth(...args),
}));

const mockExistsSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockReaddirSync = jest.fn();
const mockWriteFileSync = jest.fn();
jest.mock("fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
}));

jest.mock("path", () => jest.requireActual("path"));

const mockTaskList = jest.fn();
const mockTaskGet = jest.fn();
const mockTaskUpdate = jest.fn();
const mockTaskClose = jest.fn();
jest.mock("@/lib/tasks/task-store", () => ({
  taskList: (...args: unknown[]) => mockTaskList(...args),
  taskGet: (...args: unknown[]) => mockTaskGet(...args),
  taskUpdate: (...args: unknown[]) => mockTaskUpdate(...args),
  taskClose: (...args: unknown[]) => mockTaskClose(...args),
  validateTaskId: (id: string) => id,
}));

const mockStartTaskOutcomeAudit = jest.fn().mockResolvedValue({ status: "started" });
const mockRecoverTaskOutcomeAudit = jest.fn().mockResolvedValue({ status: "not_recoverable" });
jest.mock("@/lib/tasks/task-outcome-audit", () => ({
  startTaskOutcomeAudit: (...args: unknown[]) => mockStartTaskOutcomeAudit(...args),
  recoverTaskOutcomeAudit: (...args: unknown[]) => mockRecoverTaskOutcomeAudit(...args),
}));

const mockApplyCompletionAudit = jest.fn().mockResolvedValue({ action: "closed" });
const mockSupersedeStaleCompletionAuditDecision = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/tasks/completion-audit-apply", () => ({
  applyCompletionAudit: (...args: unknown[]) => mockApplyCompletionAudit(...args),
  supersedeStaleCompletionAuditDecision: (...args: unknown[]) => mockSupersedeStaleCompletionAuditDecision(...args),
}));

const mockCurrentRunTerminalFingerprint = jest.fn();
jest.mock("@/lib/tasks/run-outcome-evidence", () => ({
  currentRunTerminalFingerprint: (...args: unknown[]) => mockCurrentRunTerminalFingerprint(...args),
  outcomeSummarySourceEligibility: jest.fn(() => ({ eligible: true, status: "completed", fingerprint: "completed:now" })),
}));

const mockLocateTaskRun = jest.fn();
jest.mock("@/lib/tasks/task-run-locator", () => {
  const actual = jest.requireActual("@/lib/tasks/task-run-locator");
  return {
    ...actual,
    locateTaskRun: (...args: unknown[]) => mockLocateTaskRun(...args),
  };
});

const mockResolveTaskAutoRunDefault = jest.fn();
jest.mock("@/lib/tasks/task-auto-run-default", () => ({
  resolveTaskAutoRunDefault: (...args: unknown[]) => mockResolveTaskAutoRunDefault(...args),
}));

// scan_unblocked_auto_run_tasks fires a real fetch() to localhost in prod (see
// lib/runs/auto-run-service.ts) -- mock it so tests never make a real network
// call (this suite's "followups.completed" path emits that effect).
const mockTriggerAutoRunScan = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/runs/auto-run-service", () => ({
  triggerAutoRunScan: (...args: unknown[]) => mockTriggerAutoRunScan(...args),
}));

jest.mock("@/lib/workspaces/workspace-params", () => ({
  getWorkspaceId: jest.fn().mockReturnValue(undefined),
  hasWorkspaceParam: jest.fn().mockReturnValue(false),
}));

const mockGetLiveSessions = jest.fn();
jest.mock("@/lib/pty/pty-client", () => ({
  getLiveSessions: (...args: unknown[]) => mockGetLiveSessions(...args),
}));

const mockCreateNotification = jest.fn();
jest.mock("@/lib/notifications/notification-server", () => ({
  createNotification: (...args: unknown[]) => mockCreateNotification(...args),
}));

jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: jest.fn().mockResolvedValue("default"),
  getOrgIdFromRequest: jest.fn().mockResolvedValue("default"),
}));

jest.mock("@/lib/config", () => ({
  __esModule: true,
  default: {
    runsDir: "/tmp/mentiko-test/runs",
    stateDir: "/tmp/mentiko-test/state",
    eventsDir: "/tmp/mentiko-test/events",
  },
}));

const mockWriteLog = jest.fn();
jest.mock("@/lib/system/system-logger", () => ({
  writeLog: (...args: unknown[]) => mockWriteLog(...args),
}));

const mockRecoverLateCompletionEvents = jest.fn();
const mockClaimLateCompletionDelivery = jest.fn();
const mockAcknowledgeLateCompletionDelivery = jest.fn();
const mockReleaseLateCompletionDelivery = jest.fn();
jest.mock("@/lib/runner-v2/completion-recovery", () => ({
  recoverLateCompletionEvents: (...args: unknown[]) => mockRecoverLateCompletionEvents(...args),
  claimLateCompletionDelivery: (...args: unknown[]) => mockClaimLateCompletionDelivery(...args),
  acknowledgeLateCompletionDelivery: (...args: unknown[]) => mockAcknowledgeLateCompletionDelivery(...args),
  releaseLateCompletionDelivery: (...args: unknown[]) => mockReleaseLateCompletionDelivery(...args),
}));

const mockBuildTypedExecutorPlan = jest.fn();
jest.mock("@/lib/runner-v2/executor", () => ({
  buildTypedExecutorPlan: (...args: unknown[]) => mockBuildTypedExecutorPlan(...args),
}));

const mockApplyTypedExecutorPlan = jest.fn();
jest.mock("@/lib/runner-v2/adapters", () => ({
  applyTypedExecutorPlan: (...args: unknown[]) => mockApplyTypedExecutorPlan(...args),
}));

import { GET } from "./route";

function makeRequest() {
  return new Request("http://localhost:3000/api/tasks/reconcile", {
    headers: {
      Authorization: "Bearer internal-secret",
      "x-namespace-id": "default",
      "x-org-id": "default",
    },
  });
}

describe("GET /api/tasks/reconcile", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckAuth.mockResolvedValue(true);
    mockGetLiveSessions.mockResolvedValue(new Set());
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([]);
    mockCurrentRunTerminalFingerprint.mockReturnValue("completed:no-terminal-time");
    mockLocateTaskRun.mockReset();
    mockRecoverLateCompletionEvents.mockReturnValue({ recovered: [], deliveries: [], run: { status: "stopped" } });
    mockClaimLateCompletionDelivery.mockReturnValue(true);
    mockAcknowledgeLateCompletionDelivery.mockReturnValue(true);
    mockReleaseLateCompletionDelivery.mockReturnValue(true);
    mockBuildTypedExecutorPlan.mockReturnValue({ action: "route", effects: [], launches: [] });
    mockApplyTypedExecutorPlan.mockReturnValue({ effectsApplied: [], operations: [], launchesStarted: [] });
    mockTaskGet.mockImplementation((_orgId: string, taskId: string) => (
      (mockTaskList() as Array<{ id: string }>).find((task) => task.id === taskId)
    ));
    mockTaskList.mockReturnValue([
      {
        id: "TASK-044",
        title: "Run recommended chain",
        status: "in_progress",
        metadata: {
          auto_run: true,
          last_run_id: "run-audit",
          last_run_status: "running",
          last_run_chain: "Chain Recommendation",
        },
      },
    ]);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-audit",
      taskId: "TASK-044",
      status: "completed",
      chainId: "chain-recommendation",
      metadata: {
        generationKind: "chain_recommendation",
      },
    }));
  });

  it("repairs audit run pollution instead of auto-closing the task", async () => {
    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      reconciled: 0,
      results: [],
    });
    expect(mockTaskClose).not.toHaveBeenCalled();
    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-044",
      {
        metadata: expect.not.objectContaining({
          last_run_id: "run-audit",
          last_run_status: "running",
        }),
      },
      "default",
    );
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-044",
      {
        metadata: expect.objectContaining({
          auto_run: true,
          recommendation_run_id: "run-audit",
          recommendation_chain_id: "chain-recommendation",
        }),
      },
      "default",
    );
  });

  it("recovers a failed summary import instead of leaving the task summarizing", async () => {
    mockTaskList.mockReturnValue([
      {
        id: "TASK-107",
        title: "Verify MCP connectivity",
        status: "open",
        metadata: {
          lifecycle_phase: "summarizing",
          task_outcome_summary_status: "running",
          task_outcome_summary_job_id: "job-summary-failed",
        },
      },
    ]);
    mockRecoverTaskOutcomeAudit.mockResolvedValueOnce({
      status: "recovered",
      jobId: "job-summary-failed",
      sourceRunId: "run-execution",
    });

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockRecoverTaskOutcomeAudit).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "TASK-107",
      namespaceId: "default",
      orgId: "default",
    }));
    expect(body.data.results).toContainEqual(expect.objectContaining({
      taskId: "TASK-107",
      runId: "run-execution",
      newStatus: "summary_recovered",
    }));
  });

  it("repairs decision run pollution instead of auto-closing the task", async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-decision",
      taskId: "TASK-044",
      status: "completed",
      chainId: "decision-research",
      metadata: {
        decisionId: "decision-1",
        decisionPhase: "research",
      },
    }));
    mockTaskList.mockReturnValue([
      {
        id: "TASK-044",
        title: "Run recommended chain",
        status: "in_progress",
        metadata: {
          auto_run: true,
          last_run_id: "run-decision",
          last_run_status: "running",
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      reconciled: 0,
      results: [],
    });
    expect(mockTaskClose).not.toHaveBeenCalled();
    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-044",
      {
        metadata: {
          auto_run: true,
        },
      },
      "default",
    );
  });

  it("audits an auto-run task when a real execution run completes", async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-exec",
      taskId: "TASK-044",
      status: "completed",
      chainId: "release-review",
      metadata: {},
    }));
    mockTaskList.mockReturnValue([
      {
        id: "TASK-044",
        title: "Run recommended chain",
        status: "in_progress",
        metadata: {
          auto_run: true,
          last_run_id: "run-exec",
          last_run_status: "running",
          last_run_outcome: "complete",
          last_run_decision_required: false,
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      reconciled: 1,
      checked: 1,
      results: [
        expect.objectContaining({
          taskId: "TASK-044",
          runId: "run-exec",
          newStatus: "audit_started",
          reason: "completion audit triggered",
        }),
      ],
    });
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-044",
      {
        metadata: expect.objectContaining({
          auto_run: true,
          last_run_id: "run-exec",
          last_run_status: "completed",
        }),
      },
      "default",
    );
    expect(mockStartTaskOutcomeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        namespaceId: "default",
        orgId: "default",
        taskId: "TASK-044",
        sourceRunId: "run-exec",
        runFingerprint: "completed:no-terminal-time",
      }),
    );
    expect(mockTaskClose).not.toHaveBeenCalled();
  });

  it("audits a blocked execution and preserves its exact reason for the task UI", async () => {
    const reason = "startup_recovery:unknown: CLI readiness unresolved after 90s";
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-blocked",
      taskId: "TASK-020",
      status: "blocked",
      completed: "2026-07-15T17:47:37.889Z",
      blockedReason: reason,
      chainId: "log-function-inspection-and-testing",
      metadata: {},
    }));
    mockCurrentRunTerminalFingerprint.mockReturnValue("blocked:2026-07-15T17:47:37.889Z");
    mockTaskList.mockReturnValue([
      {
        id: "TASK-020",
        title: "Investigate log routing",
        status: "in_progress",
        metadata: {
          auto_run: true,
          last_run_id: "run-blocked",
          last_run_status: "blocked",
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.results).toEqual([
      expect.objectContaining({
        taskId: "TASK-020",
        runId: "run-blocked",
        newStatus: "audit_started",
        reason: "completion audit triggered",
      }),
    ]);
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-020",
      {
        metadata: expect.objectContaining({
          last_run_blocked_reason: reason,
          last_run_error: reason,
        }),
      },
      "default",
    );
    expect(mockStartTaskOutcomeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "TASK-020",
        sourceRunId: "run-blocked",
        runFingerprint: "blocked:2026-07-15T17:47:37.889Z",
      }),
    );
  });

  it("does not close a completed auto-run task until completion proof metadata exists", async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-exec",
      taskId: "TASK-044",
      status: "completed",
      chainId: "release-review",
      metadata: {},
    }));
    mockTaskList.mockReturnValue([
      {
        id: "TASK-044",
        title: "Run recommended chain",
        status: "in_progress",
        metadata: {
          auto_run: true,
          last_run_id: "run-exec",
          last_run_status: "running",
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      reconciled: 1,
      checked: 1,
      results: [
        expect.objectContaining({
          taskId: "TASK-044",
          runId: "run-exec",
          newStatus: "audit_started",
        }),
      ],
    });
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-044",
      {
        metadata: expect.objectContaining({
          last_run_id: "run-exec",
          last_run_status: "completed",
        }),
      },
      "default",
    );
    expect(mockTaskClose).not.toHaveBeenCalled();
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("audits an open auto-run task whose execution metadata already completed", async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-exec",
      taskId: "TASK-044",
      status: "completed",
      chainId: "release-review",
      metadata: {},
    }));
    mockTaskList.mockReturnValue([
      {
        id: "TASK-044",
        title: "Run recommended chain",
        status: "open",
        metadata: {
          auto_run: true,
          last_run_id: "run-exec",
          last_run_status: "completed",
          last_run_outcome: "complete",
          last_run_decision_required: false,
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      reconciled: 1,
      checked: 1,
      results: [
        expect.objectContaining({
          taskId: "TASK-044",
          runId: "run-exec",
          previousStatus: "completed",
          newStatus: "audit_started",
          reason: "completion audit triggered",
        }),
      ],
    });
    expect(mockStartTaskOutcomeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        namespaceId: "default",
        orgId: "default",
        taskId: "TASK-044",
        sourceRunId: "run-exec",
        runFingerprint: "completed:no-terminal-time",
      }),
    );
    expect(mockTaskClose).not.toHaveBeenCalled();
  });

  it("audits a workspace-default auto-run task that carries no explicit auto_run flag", async () => {
    // ISSUE-006: decision-generated tasks inherit auto-run from the workspace
    // default and have no meta.auto_run — they must still be audit-eligible.
    mockResolveTaskAutoRunDefault.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-exec",
      taskId: "TASK-264",
      status: "completed",
      chainId: "property-photo-sourcing-scope-audit",
      metadata: {},
    }));
    mockTaskList.mockReturnValue([
      {
        id: "TASK-264",
        title: "Audit photo sourcing scope",
        status: "open",
        workspace_id: "/Users/example/realtor-website",
        metadata: {
          last_run_id: "run-exec",
          last_run_status: "completed",
          last_run_outcome: "complete",
          last_run_decision_required: false,
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      reconciled: 1,
      checked: 1,
      results: [
        expect.objectContaining({
          taskId: "TASK-264",
          runId: "run-exec",
          newStatus: "audit_started",
          reason: "completion audit triggered",
        }),
      ],
    });
    expect(mockResolveTaskAutoRunDefault).toHaveBeenCalledWith(
      expect.objectContaining({ workspacePath: "/Users/example/realtor-website" }),
    );
    expect(mockStartTaskOutcomeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "TASK-264", sourceRunId: "run-exec" }),
    );
  });

  it("does not audit a completed task when neither the explicit flag nor the workspace default enables auto-run", async () => {
    mockResolveTaskAutoRunDefault.mockReturnValue(false);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-exec",
      taskId: "TASK-264",
      status: "completed",
      chainId: "property-photo-sourcing-scope-audit",
      metadata: {},
    }));
    mockTaskList.mockReturnValue([
      {
        id: "TASK-264",
        title: "Audit photo sourcing scope",
        status: "open",
        workspace_id: "/Users/example/realtor-website",
        metadata: {
          last_run_id: "run-exec",
          last_run_status: "completed",
          last_run_decision_required: false,
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ reconciled: 0, results: [] });
    expect(mockStartTaskOutcomeAudit).not.toHaveBeenCalled();
  });

  it("does not close a completed analysis run while a generated chain is pending", async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-analysis",
      taskId: "TASK-044",
      status: "completed",
      chainId: "chain-recommendation",
      metadata: {},
    }));
    mockTaskList.mockReturnValue([
      {
        id: "TASK-044",
        title: "Generate then run the chain",
        status: "open",
        metadata: {
          auto_run: true,
          last_run_id: "run-analysis",
          last_run_status: "complete",
          last_run_outcome: "complete",
          last_run_decision_required: false,
          generation_job_id: "job-generation",
          generation_status: "complete",
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      reconciled: 0,
      results: [],
    });
    expect(mockTaskClose).not.toHaveBeenCalled();
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("audits a generated task when its terminal run points at the execution chain", async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-exec",
      taskId: "TASK-092",
      status: "completed",
      chainId: "nextjs-realtor-website-initializer",
      metadata: {},
    }));
    mockTaskList.mockReturnValue([
      {
        id: "TASK-092",
        title: "Initialize Next.js project",
        status: "open",
        metadata: {
          auto_run: true,
          generation_job_id: "job-generation",
          generation_status: "complete",
          chain_id: "nextjs-realtor-website-initializer",
          last_run_id: "run-exec",
          last_run_status: "completed",
          completion_audit_run_id: "run-exec",
          completion_audit_run_fingerprint: "running:no-terminal-time",
          completion_audit_apply_status: "applied",
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      reconciled: 1,
      checked: 1,
      results: [
        expect.objectContaining({
          taskId: "TASK-092",
          runId: "run-exec",
          newStatus: "audit_started",
        }),
      ],
    });
    expect(mockStartTaskOutcomeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        namespaceId: "default",
        orgId: "default",
        taskId: "TASK-092",
        sourceRunId: "run-exec",
        runFingerprint: "completed:no-terminal-time",
      }),
    );
  });

  it("does not mark a young real run stopped before its first session launches", async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-exec",
      taskId: "TASK-044",
      status: "running",
      started: new Date(Date.now() - 3_000).toISOString(),
      chainId: "smoke-test-suite-generator",
      metadata: {},
      agents: [
        { id: "codebase-explorer", status: "pending" },
      ],
    }));
    mockTaskList.mockReturnValue([
      {
        id: "TASK-044",
        title: "Run recommended chain",
        status: "in_progress",
        metadata: {
          auto_run: true,
          last_run_id: "run-exec",
          last_run_status: "running",
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      reconciled: 0,
      checked: 1,
      results: [],
    });
    expect(mockTaskUpdate).not.toHaveBeenCalled();
    expect(mockTaskClose).not.toHaveBeenCalled();
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("does not mark a real run stopped during the next-agent handoff window", async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-exec",
      taskId: "TASK-044",
      status: "running",
      started: new Date(Date.now() - 300_000).toISOString(),
      chainId: "smoke-test-suite-generator",
      metadata: {},
      agents: [
        {
          id: "codebase-explorer",
          status: "complete",
          session: "finished-session",
          completed: new Date(Date.now() - 3_000).toISOString(),
        },
        { id: "test-strategist", status: "pending" },
      ],
    }));
    mockTaskList.mockReturnValue([
      {
        id: "TASK-044",
        title: "Run recommended chain",
        status: "in_progress",
        metadata: {
          auto_run: true,
          last_run_id: "run-exec",
          last_run_status: "running",
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      reconciled: 0,
      checked: 1,
      results: [],
    });
    expect(mockTaskUpdate).not.toHaveBeenCalled();
    expect(mockTaskClose).not.toHaveBeenCalled();
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("marks an old orphaned real run stopped and schedules retry before auditing", async () => {
    mockCurrentRunTerminalFingerprint.mockReturnValue("stopped:no-terminal-time");
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-exec",
      taskId: "TASK-044",
      status: "running",
      started: new Date(Date.now() - 180_000).toISOString(),
      chainId: "smoke-test-suite-generator",
      metadata: {},
      agents: [
        { id: "codebase-explorer", status: "running", session: "missing-session" },
      ],
    }));
    mockTaskList.mockReturnValue([
      {
        id: "TASK-044",
        title: "Run recommended chain",
        status: "in_progress",
        metadata: {
          auto_run: true,
          last_run_id: "run-exec",
          last_run_status: "running",
          auto_run_retries: 99,
          execution_retries: 0,
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      reconciled: 1,
      checked: 1,
      results: [
        expect.objectContaining({
          taskId: "TASK-044",
          runId: "run-exec",
          newStatus: "retry_requested",
          reason: "execution retry scheduled before outcome summary: no live sessions found",
        }),
      ],
    });
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-044",
      {
        status: "open",
        metadata: expect.objectContaining({
          auto_run: true,
          last_run_id: undefined,
          last_run_status: "retry_requested",
          task_run_scope: undefined,
          retry_source_run_id: "run-exec",
          auto_run_retries: 99,
          execution_retries: 1,
          lifecycle_phase: "retrying",
          summarized_run_fingerprints: ["run-exec::stopped:no-terminal-time"],
        }),
      },
      "default",
    );
    expect(mockStartTaskOutcomeAudit).not.toHaveBeenCalled();
    expect(mockTaskClose).not.toHaveBeenCalled();
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      "/tmp/mentiko-test/runs/run-exec/run.json",
      expect.stringContaining('"status": "stopped"'),
    );
  });

  it("does not stop a run while a durable handoff process is launching its next agent", async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-exec",
      taskId: "TASK-044",
      status: "running",
      started: new Date(Date.now() - 900_000).toISOString(),
      agents: [
        { id: "diagnostician", status: "complete", completed: new Date(Date.now() - 600_000).toISOString() },
        { id: "fixer", status: "pending" },
      ],
      runnerV2: {
        pendingHandoffs: [{ pid: process.pid, targetAgentIds: ["fixer"], startedAt: new Date().toISOString() }],
      },
    }));

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.results).toEqual([]);
    expect(mockTaskUpdate).not.toHaveBeenCalled();
    expect(mockStartTaskOutcomeAudit).not.toHaveBeenCalled();
  });

  it("supersedes a completion-audit decision that conflicts with an active retry", async () => {
    const parent = {
      id: "BUG-002",
      title: "Fix ingestion",
      status: "open",
      workspace_id: "/repo/synthyo",
      metadata: {
        lifecycle_phase: "retrying",
        last_run_status: "retry_requested",
        last_run_decision_required: false,
        decision_subtask_id: "DEC-001",
      },
    };
    const decision = {
      id: "DEC-001",
      title: "Choose a recovery path",
      status: "open",
      issue_type: "decision",
      parent_id: "BUG-002",
      metadata: {
        decision_source: "completion-audit",
        completion_audit_source_run_id: "run-stale",
        completion_audit_run_fingerprint: "running:no-terminal-time",
      },
    };
    mockTaskList.mockReturnValue([parent, decision]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockSupersedeStaleCompletionAuditDecision).toHaveBeenCalledWith(expect.objectContaining({
      parentTask: parent,
      decisionTask: decision,
    }));
    expect(body.data.results).toEqual([
      expect.objectContaining({ newStatus: "stale_decision_superseded" }),
    ]);
  });

  it("audits a failed execution run after the retry budget is exhausted", async () => {
    mockCurrentRunTerminalFingerprint.mockReturnValue("failed:no-terminal-time");
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-exec",
      taskId: "TASK-044",
      status: "failed",
      chainId: "smoke-test-suite-generator",
      metadata: {},
    }));
    mockTaskList.mockReturnValue([
      {
        id: "TASK-044",
        title: "Run recommended chain",
        status: "open",
        metadata: {
          auto_run: true,
          last_run_id: "run-exec",
          last_run_status: "failed",
          auto_run_retries: 0,
          execution_retries: 2,
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.results).toEqual([
      expect.objectContaining({
        taskId: "TASK-044",
        runId: "run-exec",
        newStatus: "audit_started",
      }),
    ]);
    expect(mockStartTaskOutcomeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        namespaceId: "default",
        orgId: "default",
        taskId: "TASK-044",
        sourceRunId: "run-exec",
        runFingerprint: "failed:no-terminal-time",
      }),
    );
  });

  it("stops autonomous outcome-summary retries after two failures for the same execution", async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-exec",
      taskId: "TASK-079",
      status: "completed",
      chainId: "baseline-artifacts-copy-chain",
      metadata: {},
    }));
    mockTaskList.mockReturnValue([
      {
        id: "TASK-079",
        title: "Copy baseline findings",
        status: "open",
        metadata: {
          auto_run: true,
          last_run_id: "run-exec",
          last_run_status: "completed",
          chain_id: "baseline-artifacts-copy-chain",
          task_outcome_summary_status: "failed",
          task_outcome_summary_source_run_id: "run-exec",
          task_outcome_summary_failures: 2,
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.reconciled).toBe(0);
    expect(body.data.results).toEqual([]);
    expect(mockStartTaskOutcomeAudit).not.toHaveBeenCalled();
  });

  it("retries a missing execution run through the lifecycle reducer", async () => {
    mockExistsSync.mockReturnValue(false);
    mockCurrentRunTerminalFingerprint.mockReturnValue("deleted:no-terminal-time");
    mockTaskList.mockReturnValue([
      {
        id: "TASK-044",
        title: "Run recommended chain",
        status: "in_progress",
        metadata: {
          auto_run: true,
          last_run_id: "run-missing",
          last_run_status: "running",
          execution_retries: 0,
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.results).toEqual([
      expect.objectContaining({
        taskId: "TASK-044",
        runId: "run-missing",
        newStatus: "retry_requested",
        reason: "execution retry scheduled before outcome summary: run directory no longer exists",
      }),
    ]);
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-044",
      {
        status: "open",
        metadata: expect.objectContaining({
          lifecycle_phase: "retrying",
          execution_retries: 1,
          last_run_id: undefined,
          last_run_status: "retry_requested",
          summarized_run_fingerprints: ["run-missing::deleted:no-terminal-time"],
        }),
      },
      "default",
    );
    expect(mockStartTaskOutcomeAudit).not.toHaveBeenCalled();
  });

  it("audits a corrupt execution run through the lifecycle reducer after retry budget is exhausted", async () => {
    mockCurrentRunTerminalFingerprint.mockReturnValue("unknown:no-terminal-time");
    mockReadFileSync.mockImplementation(() => {
      throw new Error("bad json");
    });
    mockTaskList.mockReturnValue([
      {
        id: "TASK-044",
        title: "Run recommended chain",
        status: "in_progress",
        metadata: {
          auto_run: true,
          last_run_id: "run-corrupt",
          last_run_status: "running",
          execution_retries: 2,
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.results).toEqual([
      expect.objectContaining({
        taskId: "TASK-044",
        runId: "run-corrupt",
        newStatus: "audit_started",
      }),
    ]);
    expect(mockStartTaskOutcomeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "TASK-044",
        sourceRunId: "run-corrupt",
        runFingerprint: "unknown:no-terminal-time",
      }),
    );
  });

  it("recovers late completion events before terminal retry or audit handling", async () => {
    const stoppedRun = {
      id: "run-exec",
      taskId: "TASK-044",
      status: "stopped",
      chainId: "build-chain",
      workspacePath: "/workspace",
      metadata: {},
    };
    const chain = {
      id: "build-chain",
      name: "Build Chain",
      agents: [
        { id: "writer", emits: "draft-ready" },
        { id: "reviewer", triggers: ["draft-ready"] },
      ],
    };
    const event = [
      "event: draft-ready",
      "source: writer-run-exec",
      "run_id: run-exec",
      "timestamp: 2026-07-15T12:00:00.000Z",
      "processed: false",
      "data: ready",
      "",
    ].join("\n");
    mockReadFileSync.mockImplementation((path: unknown) => {
      const file = String(path);
      if (file.endsWith("/chain.json")) return JSON.stringify(chain);
      if (file.endsWith("/late.event")) return event;
      return JSON.stringify(stoppedRun);
    });
    mockReaddirSync.mockReturnValue(["late.event"]);
    const delivery = {
      deliveryId: "late-delivery-writer",
      agentId: "writer",
      event: { event: "draft-ready", source: "writer-run-exec", run_id: "run-exec", processed: true, path: "/tmp/late.event" },
      route: { action: "launch", agentIds: ["reviewer"], reason: "branch" },
    };
    mockRecoverLateCompletionEvents.mockReturnValue({
      recovered: [delivery],
      deliveries: [delivery],
      run: { ...stoppedRun, status: "running" },
    });
    mockBuildTypedExecutorPlan.mockReturnValue({ action: "route", effects: [{ type: "event-side-effects", plan: {} }], launches: [{ command: "launch reviewer" }] });
    mockTaskList.mockReturnValue([
      {
        id: "TASK-044",
        title: "Run recommended chain",
        status: "open",
        metadata: {
          auto_run: true,
          last_run_chain: "Build Chain",
          chain_id: "build-chain",
          last_run_id: "run-exec",
          last_run_status: "stopped",
          execution_retries: 2,
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.results).toEqual([
      expect.objectContaining({
        taskId: "TASK-044",
        runId: "run-exec",
        previousStatus: "stopped",
        newStatus: "running",
        reason: "late completion event recovered for writer",
      }),
    ]);
    expect(mockRecoverLateCompletionEvents).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-exec",
      chain,
      events: expect.arrayContaining([
        expect.objectContaining({ event: "draft-ready", source: "writer-run-exec" }),
      ]),
    }));
    expect(mockBuildTypedExecutorPlan).toHaveBeenCalledWith(expect.objectContaining({
      pipeline: expect.objectContaining({
        decision: expect.objectContaining({
          action: "route",
          event: expect.objectContaining({ event: "draft-ready" }),
          route: expect.objectContaining({ action: "launch", agentIds: ["reviewer"] }),
        }),
      }),
    }));
    expect(mockApplyTypedExecutorPlan).toHaveBeenCalled();
    expect(mockClaimLateCompletionDelivery).toHaveBeenCalledWith(expect.objectContaining({
      deliveryId: "late-delivery-writer",
    }));
    expect(mockAcknowledgeLateCompletionDelivery).toHaveBeenCalledWith(expect.objectContaining({
      deliveryId: "late-delivery-writer",
      evidence: "plan-applied",
    }));
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-044",
      { metadata: expect.objectContaining({ last_run_status: "running" }) },
      "default",
    );
    expect(mockStartTaskOutcomeAudit).not.toHaveBeenCalled();
  });

  it("resumes one pending delivery after a crash between event consumption and plan apply", async () => {
    const run = {
      id: "run-exec",
      taskId: "TASK-044",
      status: "stopped",
      chainId: "build-chain",
      workspacePath: "/workspace",
      agents: [
        { id: "writer", status: "complete" },
        { id: "reviewer", status: "pending" },
      ],
    };
    const chain = {
      id: "build-chain",
      name: "Build Chain",
      agents: [
        { id: "writer", emits: "draft-ready" },
        { id: "reviewer", triggers: ["draft-ready"] },
      ],
    };
    const delivery = {
      deliveryId: "late-delivery-crash-window",
      agentId: "writer",
      event: { event: "draft-ready", source: "writer-run-exec", runId: "run-exec", processed: true, path: "/tmp/late.event" },
      route: { action: "launch", agentIds: ["reviewer"], reason: "trigger match" },
    };
    mockReadFileSync.mockImplementation((path: unknown) => {
      const file = String(path);
      if (file.endsWith("/chain.json")) return JSON.stringify(chain);
      if (file.endsWith("/late.event")) return "event: draft-ready\nsource: writer-run-exec\nrun_id: run-exec\nprocessed: true\n";
      return JSON.stringify(run);
    });
    mockReaddirSync.mockReturnValue(["late.event"]);
    mockRecoverLateCompletionEvents
      .mockReturnValueOnce({ recovered: [delivery], deliveries: [delivery], run: { ...run, status: "running" } })
      .mockReturnValueOnce({ recovered: [], deliveries: [delivery], run: { ...run, status: "running" } })
      .mockReturnValueOnce({ recovered: [], deliveries: [], run });
    mockBuildTypedExecutorPlan
      .mockImplementationOnce(() => { throw new Error("injected crash before plan apply"); })
      .mockReturnValue({ action: "route", effects: [], launches: [{ command: "launch reviewer" }] });
    mockTaskList.mockReturnValue([{
      id: "TASK-044",
      title: "Recover late completion",
      status: "open",
      metadata: {
        auto_run: true,
        chain_id: "build-chain",
        last_run_id: "run-exec",
        last_run_status: "stopped",
        execution_retries: 2,
      },
    }]);

    const crashed = await GET(makeRequest() as never);
    expect(await crashed.json()).toMatchObject({
      data: {
        errors: [{ taskId: "TASK-044", error: "injected crash before plan apply" }],
      },
    });
    expect(mockClaimLateCompletionDelivery).toHaveBeenCalledTimes(1);
    expect(mockApplyTypedExecutorPlan).not.toHaveBeenCalled();
    expect(mockReleaseLateCompletionDelivery).toHaveBeenCalledTimes(1);

    const resumed = await GET(makeRequest() as never);
    expect(await resumed.json()).toMatchObject({
      data: {
        results: [expect.objectContaining({
          taskId: "TASK-044",
          newStatus: "running",
        })],
      },
    });
    expect(mockClaimLateCompletionDelivery).toHaveBeenCalledTimes(2);
    expect(mockApplyTypedExecutorPlan).toHaveBeenCalledTimes(1);
    expect(mockAcknowledgeLateCompletionDelivery).toHaveBeenCalledTimes(1);
    expect(mockAcknowledgeLateCompletionDelivery).toHaveBeenCalledWith(expect.objectContaining({
      deliveryId: delivery.deliveryId,
      evidence: "plan-applied",
    }));
    expect(mockBuildTypedExecutorPlan).toHaveBeenCalledWith(expect.objectContaining({
      routeContext: expect.objectContaining({
        fanGroupId: `late-recovery-${delivery.deliveryId}`,
        env: expect.objectContaining({ MENTIKO_RUNNER_V2_DELIVERY_ID: delivery.deliveryId }),
      }),
    }));
    expect(mockBuildTypedExecutorPlan.mock.calls[1][0]).toEqual(mockBuildTypedExecutorPlan.mock.calls[0][0]);

    await GET(makeRequest() as never);
    expect(mockApplyTypedExecutorPlan).toHaveBeenCalledTimes(1);
  });

  it("acknowledges downstream run evidence instead of duplicating a launch after apply", async () => {
    let run: Record<string, unknown> = {
      id: "run-exec",
      taskId: "TASK-044",
      status: "stopped",
      chainId: "build-chain",
      agents: [
        { id: "writer", status: "complete" },
        { id: "reviewer", status: "pending" },
      ],
    };
    const chain = {
      id: "build-chain",
      name: "Build Chain",
      agents: [
        { id: "writer", emits: "draft-ready" },
        { id: "reviewer", triggers: ["draft-ready"] },
      ],
    };
    const delivery = {
      deliveryId: "late-delivery-after-apply",
      agentId: "writer",
      event: { event: "draft-ready", source: "writer-run-exec", runId: "run-exec", processed: true, path: "/tmp/late.event" },
      route: { action: "launch", agentIds: ["reviewer"], reason: "trigger match" },
    };
    mockReadFileSync.mockImplementation((path: unknown) => {
      const file = String(path);
      if (file.endsWith("/chain.json")) return JSON.stringify(chain);
      if (file.endsWith("/late.event")) return "event: draft-ready\nsource: writer-run-exec\nrun_id: run-exec\nprocessed: true\n";
      return JSON.stringify(run);
    });
    mockReaddirSync.mockReturnValue(["late.event"]);
    mockRecoverLateCompletionEvents.mockImplementation(() => ({
      recovered: [],
      deliveries: [delivery],
      run: { ...run, status: "running" },
    }));
    mockAcknowledgeLateCompletionDelivery
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    mockTaskList.mockReturnValue([{
      id: "TASK-044",
      title: "Recover late completion",
      status: "open",
      metadata: {
        auto_run: true,
        chain_id: "build-chain",
        last_run_id: "run-exec",
        last_run_status: "stopped",
        execution_retries: 2,
      },
    }]);

    const unacknowledged = await GET(makeRequest() as never);
    expect(await unacknowledged.json()).toMatchObject({
      data: {
        errors: [{ taskId: "TASK-044", error: "late completion delivery acknowledgement failed: late-delivery-after-apply" }],
      },
    });
    expect(mockApplyTypedExecutorPlan).toHaveBeenCalledTimes(1);
    expect(mockReleaseLateCompletionDelivery).not.toHaveBeenCalled();

    run = {
      ...run,
      agents: [
        { id: "writer", status: "complete" },
        { id: "reviewer", status: "running", session: "reviewer-run-exec" },
      ],
    };
    const converged = await GET(makeRequest() as never);
    expect(await converged.json()).toMatchObject({
      data: { results: [expect.objectContaining({ newStatus: "running" })] },
    });
    expect(mockApplyTypedExecutorPlan).toHaveBeenCalledTimes(1);
    expect(mockClaimLateCompletionDelivery).toHaveBeenCalledTimes(1);
    expect(mockAcknowledgeLateCompletionDelivery).toHaveBeenLastCalledWith(expect.objectContaining({
      deliveryId: delivery.deliveryId,
      evidence: "downstream-state",
    }));
  });

  it("audits a late-recovered completed terminal run in the same reconcile pass", async () => {
    const completedRun = {
      id: "run-exec",
      taskId: "TASK-044",
      status: "stopped",
      chainId: "build-chain",
      workspacePath: "/workspace",
      metadata: {},
    };
    const chain = {
      id: "build-chain",
      name: "Build Chain",
      agents: [{ id: "writer", emits: "done" }],
    };
    const event = "event: done\nsource: writer-run-exec\nrun_id: run-exec\nprocessed: false\n";
    mockCurrentRunTerminalFingerprint.mockReturnValue("completed:late");
    mockReadFileSync.mockImplementation((path: unknown) => {
      const file = String(path);
      if (file.endsWith("/chain.json")) return JSON.stringify(chain);
      if (file.endsWith("/late.event")) return event;
      return JSON.stringify(completedRun);
    });
    mockReaddirSync.mockReturnValue(["late.event"]);
    const delivery = {
      deliveryId: "late-delivery-terminal",
      agentId: "writer",
      event: { event: "done", source: "writer-run-exec", run_id: "run-exec", processed: true, path: "/tmp/late.event" },
      route: { action: "wait", pending: false, reason: "done" },
    };
    mockRecoverLateCompletionEvents.mockReturnValue({
      recovered: [delivery],
      deliveries: [delivery],
      run: { ...completedRun, status: "completed" },
    });
    mockTaskList.mockReturnValue([
      {
        id: "TASK-044",
        title: "Run recommended chain",
        status: "open",
        metadata: {
          auto_run: true,
          last_run_chain: "Build Chain",
          chain_id: "build-chain",
          last_run_id: "run-exec",
          last_run_status: "stopped",
          execution_retries: 2,
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.results).toEqual([
      expect.objectContaining({
        taskId: "TASK-044",
        runId: "run-exec",
        newStatus: "audit_started",
        reason: "completion audit triggered after late recovery",
      }),
    ]);
    expect(mockStartTaskOutcomeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "TASK-044",
        sourceRunId: "run-exec",
        runFingerprint: "completed:late",
      }),
    );
  });

  it("does not emit followups.completed while any follow-up task is still open", async () => {
    mockTaskList.mockReturnValue([
      {
        id: "TASK-093",
        title: "Original task",
        status: "blocked",
        metadata: {
          lifecycle_phase: "followup_blocked",
          last_run_decision_required: true,
          followup_task_ids: ["TASK-100", "TASK-101"],
        },
      },
      { id: "TASK-100", title: "Done follow-up", status: "closed", metadata: {} },
      { id: "TASK-101", title: "Open follow-up", status: "open", metadata: {} },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      reconciled: 0,
      checked: 1,
      results: [],
    });
    expect(mockTaskUpdate).not.toHaveBeenCalledWith(
      "default",
      "TASK-093",
      expect.anything(),
      "default",
    );
  });

  it("emits followups.completed when every follow-up is closed and resumes the original task", async () => {
    mockTaskList.mockReturnValue([
      {
        id: "TASK-093",
        title: "Original task",
        status: "blocked",
        metadata: {
          lifecycle_phase: "followup_blocked",
          last_run_decision_required: true,
          decision_subtask_id: "DEC-1",
          followup_task_ids: ["TASK-100", "TASK-101"],
        },
      },
      { id: "TASK-100", title: "Done follow-up", status: "closed", metadata: {} },
      { id: "TASK-101", title: "Resolved follow-up", status: "resolved", metadata: {} },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      reconciled: 1,
      checked: 1,
      results: [
        expect.objectContaining({
          taskId: "TASK-093",
          newStatus: "followups_completed",
          reason: "all follow-up tasks are complete",
        }),
      ],
    });
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-093",
      {
        status: "open",
        metadata: expect.objectContaining({
          lifecycle_phase: "resuming",
          last_run_decision_required: false,
          decision_subtask_id: undefined,
          followup_task_ids: [],
        }),
      },
      "default",
    );
  });

  it("re-applies an audited close on a reopened task whose run evidence was wiped", async () => {
    // ISSUE-007 aftermath: the reopen actor wipes last_run_*, so the terminal
    // filter can't see the task; the durable completion_audit_* evidence must
    // drive a re-close (which restores metadata + fires the dependents nudge).
    mockTaskList.mockReturnValue([
      {
        id: "TASK-264",
        title: "Audit photo sourcing scope",
        status: "open",
        workspace_id: "/Users/example/realtor-website",
        metadata: {
          chain_id: "property-photo-sourcing-scope-audit",
          last_audit_verdict: "close",
          completion_audit_run_id: "run-exec",
          completion_audit_run_fingerprint: "completed:2026-07-11T20:26:38.669Z",
          completion_audit_apply_status: "applied",
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      reconciled: 1,
      checked: 1,
      results: [
        expect.objectContaining({
          taskId: "TASK-264",
          runId: "run-exec",
          newStatus: "reclose_closed",
          reason: "audited close re-applied after reopen wiped run evidence",
        }),
      ],
    });
    expect(mockApplyCompletionAudit).toHaveBeenCalledTimes(1);
    expect(mockApplyCompletionAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        namespaceId: "default",
        orgId: "default",
        runId: "run-exec",
        runFingerprint: "completed:2026-07-11T20:26:38.669Z",
        workspacePath: "/Users/example/realtor-website",
        audit: expect.objectContaining({ verdict: "close" }),
        task: expect.objectContaining({ id: "TASK-264" }),
      }),
    );
  });

  it("does not re-close when the durable audit verdict is not close", async () => {
    mockTaskList.mockReturnValue([
      {
        id: "TASK-264",
        title: "Audit photo sourcing scope",
        status: "open",
        metadata: {
          chain_id: "property-photo-sourcing-scope-audit",
          last_audit_verdict: "retry",
          completion_audit_run_id: "run-exec",
          completion_audit_apply_status: "applied",
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ reconciled: 0, results: [] });
    expect(mockApplyCompletionAudit).not.toHaveBeenCalled();
  });

  it("repairs stale source-run provenance for an already-applied decision from its exact terminal run without creating another decision", async () => {
    mockApplyCompletionAudit.mockResolvedValueOnce({
      action: "skipped",
      detail: "audit already applied for this run; repaired source execution metadata",
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-completed",
      taskId: "TASK-020",
      status: "blocked",
      started: "2026-07-15T23:10:01.000Z",
      completed: "2026-07-15T23:11:54.313Z",
      status_message: "agent summary status is blocked",
      chain: "task-020-execution",
      agents: [
        { id: "inspector", status: "complete" },
        { id: "updater", status: "failed" },
      ],
      artifacts: ["evidence.json"],
    }));
    mockTaskList.mockReturnValue([
      {
        id: "TASK-020",
        title: "Document log function behavior",
        status: "blocked",
        workspace_id: "/Users/example/synthyo",
        metadata: {
          chain_id: "task-020-execution",
          last_audit_verdict: "decision",
          completion_audit_run_id: "run-completed",
          completion_audit_run_fingerprint: "completed:2026-07-15T23:11:54.313Z",
          completion_audit_apply_status: "applied",
          last_run_id: "run-completed",
          last_run_status: "completed",
          last_run_blocked_reason: "startup_recovery:unknown",
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      reconciled: 1,
      checked: 1,
      results: [
        expect.objectContaining({
          taskId: "TASK-020",
          runId: "run-completed",
          newStatus: "repair_skipped",
          reason: "audited decision re-applied to repair stale execution provenance",
        }),
      ],
    });
    expect(mockApplyCompletionAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-completed",
        runFingerprint: "completed:2026-07-15T23:11:54.313Z",
        sourceTerminalMetadata: {
          last_run_id: "run-completed",
          last_run_status: "blocked",
          last_run_started: "2026-07-15T23:10:01.000Z",
          last_run_completed: "2026-07-15T23:11:54.313Z",
          last_run_chain: "task-020-execution",
          last_run_agents: "inspector|complete,updater|failed",
          last_run_artifacts: ["evidence.json"],
          last_run_error: "agent summary status is blocked",
          last_run_blocked_reason: "agent summary status is blocked",
        },
        audit: expect.objectContaining({ verdict: "decision" }),
        task: expect.objectContaining({ id: "TASK-020" }),
      }),
    );
  });

  it("does not repair an audited decision from a terminal run linked to another task", async () => {
    mockApplyCompletionAudit.mockResolvedValueOnce({
      action: "skipped",
      detail: "audit already applied for this run",
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-completed",
      taskId: "TASK-OTHER",
      status: "blocked",
      started: "2026-07-15T23:10:01.000Z",
      completed: "2026-07-15T23:11:54.313Z",
      status_message: "agent summary status is blocked",
    }));
    mockTaskList.mockReturnValue([
      {
        id: "TASK-020",
        title: "Document log function behavior",
        status: "blocked",
        metadata: {
          last_audit_verdict: "decision",
          completion_audit_run_id: "run-completed",
          completion_audit_apply_status: "applied",
          last_run_id: "run-completed",
          last_run_status: "completed",
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(200);
    expect(mockApplyCompletionAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-completed",
        sourceTerminalMetadata: undefined,
      }),
    );
  });

  it("does not fall back to config.runsDir when a scoped audited run is missing or mismatched", async () => {
    mockLocateTaskRun.mockImplementation(() => {
      throw new Error("persisted task run scope does not match the run record");
    });
    // If this were read, a legacy config-root fallback would fabricate valid
    // provenance. A scoped failure must leave it untouched.
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-completed",
      taskId: "TASK-020",
      status: "blocked",
      metadata: { taskExecution: true },
    }));
    mockTaskList.mockReturnValue([
      {
        id: "TASK-020",
        title: "Document log function behavior",
        status: "blocked",
        metadata: {
          last_audit_verdict: "decision",
          completion_audit_run_id: "run-completed",
          completion_audit_apply_status: "applied",
          task_run_scope: {
            version: 1,
            taskId: "TASK-020",
            runId: "run-completed",
            namespaceId: "other-namespace",
            orgId: "other-org",
          },
        },
      },
    ]);

    const res = await GET(makeRequest() as never);

    expect(res.status).toBe(200);
    expect(mockLocateTaskRun).toHaveBeenCalledWith({
      version: 1,
      taskId: "TASK-020",
      runId: "run-completed",
      namespaceId: "other-namespace",
      orgId: "other-org",
    });
    expect(mockReadFileSync).not.toHaveBeenCalled();
    expect(mockApplyCompletionAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-completed",
        sourceTerminalMetadata: undefined,
      }),
    );
  });

  it("leaves a task with intact terminal run evidence to the terminal sweep instead of re-closing", async () => {
    // A fresh terminal run deserves its own audit verdict; re-closing on the
    // stale completion_audit_* evidence would clobber the new run's outcome.
    mockResolveTaskAutoRunDefault.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-exec-2",
      taskId: "TASK-152",
      status: "completed",
      chainId: "ai-summary-implementation",
      metadata: {},
    }));
    mockTaskList.mockReturnValue([
      {
        id: "TASK-152",
        title: "Implement AI summary",
        status: "open",
        workspace_id: "/Users/example/realtor-website",
        metadata: {
          chain_id: "ai-summary-implementation",
          last_run_id: "run-exec-2",
          last_run_status: "completed",
          last_audit_verdict: "close",
          completion_audit_run_id: "run-exec-1",
          completion_audit_apply_status: "applied",
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockApplyCompletionAudit).not.toHaveBeenCalled();
    expect(body.data).toMatchObject({
      results: [
        expect.objectContaining({
          taskId: "TASK-152",
          runId: "run-exec-2",
          newStatus: "audit_started",
        }),
      ],
    });
  });

  it("does not consume a terminal run after another reconcile already cleared its task claim for retry", async () => {
    mockResolveTaskAutoRunDefault.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      id: "run-stopped",
      taskId: "BUG-002",
      status: "stopped",
      chainId: "bug-fix-chain",
      completed: "2026-07-12T04:03:37.733Z",
    }));
    const staleSnapshot = {
      id: "BUG-002",
      title: "Fix ingestion",
      status: "open",
      workspace_id: "/repo/synthyo",
      metadata: {
        auto_run: true,
        chain_id: "bug-fix-chain",
        last_run_id: "run-stopped",
        last_run_status: "stopped",
        execution_retries: 0,
      },
    };
    mockTaskList.mockReturnValue([staleSnapshot]);
    mockTaskGet.mockReturnValue({
      ...staleSnapshot,
      metadata: {
        ...staleSnapshot.metadata,
        last_run_id: undefined,
        last_run_status: "retry_requested",
        execution_retries: 1,
      },
    });

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockStartTaskOutcomeAudit).not.toHaveBeenCalled();
    expect(body.data.results).toEqual([]);
  });

  it("does not log warnings for a stable decision task whose execution provenance already matches the audited run", async () => {
    mockApplyCompletionAudit.mockResolvedValueOnce({
      action: "skipped",
      detail: "audit already applied for this run",
    });
    mockTaskList.mockReturnValue([
      {
        id: "TASK-003",
        title: "Deploy monitoring stack",
        status: "blocked",
        metadata: {
          last_audit_verdict: "decision",
          completion_audit_run_id: "run-1784513693715",
          completion_audit_run_fingerprint: "completed:2026-07-15T12:00:00.000Z",
          completion_audit_apply_status: "applied",
          last_run_id: "run-1784513693715",
          last_run_status: "completed",
          lifecycle_phase: "followup_blocked",
        },
      },
    ]);

    const res = await GET(makeRequest() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.results).toEqual([]);
    const warnCalls = mockWriteLog.mock.calls.filter((c) => c[2] === "warn");
    const infoCalls = mockWriteLog.mock.calls.filter((c) => c[2] === "info");
    expect(warnCalls.some((c) => String(c[4] || "").includes("TASK-003"))).toBe(false);
    expect(infoCalls.some((c) => String(c[4] || "").includes("TASK-003"))).toBe(true);
  });
});
