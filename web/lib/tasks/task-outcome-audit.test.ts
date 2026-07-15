/**
 * @jest-environment node
 */

const getTemplate = jest.fn();
const createJob = jest.fn();
const listJobs = jest.fn();
const taskGet = jest.fn();
const taskUpdate = jest.fn();
const currentRunTerminalFingerprint = jest.fn();
const currentRunStatus = jest.fn();
const currentRunSummary = jest.fn();
const currentRunArtifacts = jest.fn();
const isOutcomeSummaryExecutionSource = jest.fn();
const startGenerationChainRun = jest.fn();

jest.mock("@/lib/generation/generation-template-storage", () => ({
  DEFAULT_TASK_RUN_SUMMARY_TEMPLATE: "COMPLETION AUDIT\n{{WORKSPACE_CONTEXT}}\n{{TASK_DATA}}\n{{RUN_SUMMARY}}\n{{RUN_ARTIFACTS}}\n{{GENERATION_FLOW}}",
  getTemplate: (...args: unknown[]) => getTemplate(...args),
}));

jest.mock("@/lib/system/template-resolver", () => ({
  resolveTemplate: (template: string, values: Record<string, string>) => (
    template.replace(/\{\{(\w+)\}\}/g, (_match, key) => values[key] ?? "")
  ),
}));

jest.mock("@/lib/runs/job-store", () => ({
  createJob: (...args: unknown[]) => createJob(...args),
  listJobs: (...args: unknown[]) => listJobs(...args),
}));

jest.mock("@/lib/tasks/task-store", () => ({
  taskGet: (...args: unknown[]) => taskGet(...args),
  taskUpdate: (...args: unknown[]) => taskUpdate(...args),
  validateTaskId: (taskId: string) => taskId,
}));

jest.mock("@/lib/tasks/run-outcome-evidence", () => ({
  currentRunArtifacts: (...args: unknown[]) => currentRunArtifacts(...args),
  currentRunSummary: (...args: unknown[]) => currentRunSummary(...args),
  currentRunStatus: (...args: unknown[]) => currentRunStatus(...args),
  currentRunTerminalFingerprint: (...args: unknown[]) => currentRunTerminalFingerprint(...args),
  isOutcomeSummaryTerminalStatus: (status: string) => [
    "completed", "complete", "failed", "stopped", "deleted", "unknown", "cancelled",
  ].includes(status),
  isOutcomeSummaryExecutionSource: (...args: unknown[]) => isOutcomeSummaryExecutionSource(...args),
  metadataRecord: (metadata: unknown) => (
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? metadata as Record<string, unknown>
      : {}
  ),
}));

jest.mock("@/lib/generation/generation-chain-dispatch", () => ({
  startGenerationChainRun: (...args: unknown[]) => startGenerationChainRun(...args),
}));

import { startTaskOutcomeAudit } from "./task-outcome-audit";

beforeEach(() => {
  jest.clearAllMocks();
  getTemplate.mockReturnValue({ content: "COMPLETION AUDIT\n{{WORKSPACE_CONTEXT}}" });
  createJob.mockReturnValue({ id: "job-audit" });
  listJobs.mockReturnValue([]);
  currentRunTerminalFingerprint.mockReturnValue("completed:f1");
  currentRunStatus.mockReturnValue("completed");
  currentRunSummary.mockReturnValue({ status: "failed" });
  currentRunArtifacts.mockReturnValue([]);
  isOutcomeSummaryExecutionSource.mockReturnValue(true);
  startGenerationChainRun.mockResolvedValue({ runId: "run-audit", chainId: "run-summary-generation" });
});

describe("startTaskOutcomeAudit", () => {
  it("does not start an audit while the execution run is still active", async () => {
    taskGet.mockReturnValue({
      id: "TASK-093",
      title: "Lead capture API",
      status: "in_progress",
      issue_type: "task",
      metadata: { last_run_id: "run-active" },
    });
    currentRunStatus.mockReturnValue("running");

    const result = await startTaskOutcomeAudit({
      request: {} as Request,
      namespaceId: "default",
      orgId: "default",
      taskId: "TASK-093",
    });

    expect(result).toEqual({ status: "not_terminal", sourceRunId: "run-active" });
    expect(createJob).not.toHaveBeenCalled();
    expect(startGenerationChainRun).not.toHaveBeenCalled();
  });

  it("uses explicit sourceRunId and runFingerprint instead of stale task metadata", async () => {
    taskGet.mockReturnValue({
      id: "TASK-093",
      title: "Lead capture API",
      description: "Build the endpoint",
      status: "in_progress",
      priority: 2,
      issue_type: "task",
      parent_id: null,
      acceptance_criteria: null,
      design: null,
      notes: null,
      workspace_id: "/repo/current",
      metadata: {
        last_run_id: "run-old",
        workspace_path: "/repo/stale",
      },
    });

    const result = await startTaskOutcomeAudit({
      request: {} as Request,
      namespaceId: "default",
      orgId: "default",
      taskId: "TASK-093",
      sourceRunId: "run-new",
      runFingerprint: "completed:explicit",
      userId: "user-1",
    });

    expect(result.status).toBe("started");
    expect(isOutcomeSummaryExecutionSource).toHaveBeenCalledWith("default", "default", "run-new");
    expect(currentRunTerminalFingerprint).not.toHaveBeenCalled();
    expect(createJob).toHaveBeenCalledWith(
      "task_run_summary",
      expect.objectContaining({
        sourceRunId: "run-new",
        runFingerprint: "completed:explicit",
      }),
      "TASK-093",
      undefined,
      "user-1",
      "default",
    );
    expect(taskUpdate).toHaveBeenLastCalledWith(
      "default",
      "TASK-093",
      {
        metadata: expect.objectContaining({
          task_outcome_summary_source_run_id: "run-new",
          task_outcome_summary_run_fingerprint: "completed:explicit",
          summarized_run_fingerprints: expect.arrayContaining(["run-new::completed:explicit"]),
        }),
      },
      "default",
    );
  });

  it("uses task.workspace_id before stale metadata workspace_path for the audit workspace", async () => {
    taskGet.mockReturnValue({
      id: "TASK-093",
      title: "Lead capture API",
      description: "Build the endpoint",
      status: "in_progress",
      priority: 2,
      issue_type: "task",
      parent_id: null,
      acceptance_criteria: null,
      design: null,
      notes: null,
      workspace_id: "/repo/current",
      metadata: {
        last_run_id: "run-source",
        workspace_path: "/repo/stale",
      },
    });

    const result = await startTaskOutcomeAudit({
      request: {} as Request,
      namespaceId: "default",
      orgId: "default",
      taskId: "TASK-093",
      userId: "user-1",
    });

    expect(result.status).toBe("started");
    expect(createJob).toHaveBeenCalledWith(
      "task_run_summary",
      expect.objectContaining({ workspacePath: "/repo/current" }),
      "TASK-093",
      undefined,
      "user-1",
      "default",
    );
    expect(startGenerationChainRun).toHaveBeenCalledWith(
      expect.objectContaining({ workspacePath: "/repo/current" }),
    );
  });

  it("records lifecycle metadata when the outcome summary already exists", async () => {
    taskGet.mockReturnValue({
      id: "TASK-093",
      title: "Lead capture API",
      description: "Build the endpoint",
      status: "in_progress",
      priority: 2,
      issue_type: "task",
      parent_id: null,
      acceptance_criteria: null,
      design: null,
      notes: null,
      workspace_id: "/repo/current",
      metadata: {
        last_run_id: "run-source",
        task_outcome_summary_source_run_id: "run-source",
        task_outcome_summary_run_fingerprint: "completed:f1",
        task_outcome_summary: { audit: { verdict: "close" } },
      },
    });
    currentRunTerminalFingerprint.mockReturnValue("completed:f1");

    const result = await startTaskOutcomeAudit({
      request: {} as Request,
      namespaceId: "default",
      orgId: "default",
      taskId: "TASK-093",
    });

    expect(result.status).toBe("already_exists");
    expect(createJob).not.toHaveBeenCalled();
    expect(taskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-093",
      {
        metadata: expect.objectContaining({
          lifecycle_phase: "summarizing",
          task_outcome_summary_source_run_id: "run-source",
          task_outcome_summary_run_fingerprint: "completed:f1",
          summarized_run_fingerprints: expect.arrayContaining(["run-source::completed:f1"]),
        }),
      },
      "default",
    );
  });

  it("records lifecycle metadata when an outcome summary job is already running", async () => {
    taskGet.mockReturnValue({
      id: "TASK-093",
      title: "Lead capture API",
      description: "Build the endpoint",
      status: "in_progress",
      priority: 2,
      issue_type: "task",
      parent_id: null,
      acceptance_criteria: null,
      design: null,
      notes: null,
      workspace_id: "/repo/current",
      metadata: {
        last_run_id: "run-source",
      },
    });
    currentRunTerminalFingerprint.mockReturnValue("completed:f1");
    listJobs.mockReturnValue([
      {
        id: "job-existing",
        type: "task_run_summary",
        runId: "run-summary",
        input: { sourceRunId: "run-source" },
      },
    ]);

    const result = await startTaskOutcomeAudit({
      request: {} as Request,
      namespaceId: "default",
      orgId: "default",
      taskId: "TASK-093",
    });

    expect(result.status).toBe("running");
    expect(createJob).not.toHaveBeenCalled();
    expect(taskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-093",
      {
        metadata: expect.objectContaining({
          lifecycle_phase: "summarizing",
          task_outcome_summary_job_id: "job-existing",
          task_outcome_summary_status: "running",
          task_outcome_summary_run_id: "run-summary",
          task_outcome_summary_source_run_id: "run-source",
          task_outcome_summary_run_fingerprint: "completed:f1",
          summarized_run_fingerprints: expect.arrayContaining(["run-source::completed:f1"]),
        }),
      },
      "default",
    );
  });
});
