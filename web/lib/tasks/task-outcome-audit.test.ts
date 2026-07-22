/**
 * @jest-environment node
 */

const getTemplate = jest.fn();
const createJob = jest.fn();
const listJobs = jest.fn();
const getJob = jest.fn();
const updateJob = jest.fn();
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
  getJob: (...args: unknown[]) => getJob(...args),
  updateJob: (...args: unknown[]) => updateJob(...args),
}));

const existsSync = jest.fn();
const readFileSync = jest.fn();
jest.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => existsSync(...args),
  readFileSync: (...args: unknown[]) => readFileSync(...args),
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
    "completed", "complete", "blocked", "failed", "stopped", "deleted", "unknown", "cancelled",
  ].includes(status),
  isOutcomeSummaryExecutionSource: (...args: unknown[]) => isOutcomeSummaryExecutionSource(...args),
  outcomeSummarySourceEligibility: () => ({ eligible: true, fingerprint: "completed:f1" }),
  metadataRecord: (metadata: unknown) => (
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? metadata as Record<string, unknown>
      : {}
  ),
}));

jest.mock("@/lib/generation/generation-chain-dispatch", () => ({
  startGenerationChainRun: (...args: unknown[]) => startGenerationChainRun(...args),
}));

const isPayloadCompatibleWithKind = jest.fn();
jest.mock("@/lib/generation/payload-contract", () => ({
  isPayloadCompatibleWithKind: (...args: unknown[]) => isPayloadCompatibleWithKind(...args),
}));

const extractCompletionAudit = jest.fn();
jest.mock("@/lib/tasks/completion-audit-schema", () => ({
  extractCompletionAudit: (...args: unknown[]) => extractCompletionAudit(...args),
}));

const enforceDeliveryGate = jest.fn();
jest.mock("@/lib/tasks/completion-audit-delivery-gate", () => ({
  enforceDeliveryGate: (...args: unknown[]) => enforceDeliveryGate(...args),
}));

const applyCompletionAudit = jest.fn();
jest.mock("@/lib/tasks/completion-audit-apply", () => ({
  applyCompletionAudit: (...args: unknown[]) => applyCompletionAudit(...args),
}));

jest.mock("@/lib/links/link-run-runtime", () => ({
  resolveLinkRunPaths: () => ({ runDir: "/tmp/run-summary" }),
}));

import { recoverTaskOutcomeAudit, startTaskOutcomeAudit } from "./task-outcome-audit";

beforeEach(() => {
  jest.clearAllMocks();
  getTemplate.mockReturnValue({ content: "COMPLETION AUDIT\n{{WORKSPACE_CONTEXT}}" });
  createJob.mockReturnValue({ id: "job-audit" });
  listJobs.mockReturnValue([]);
  getJob.mockReturnValue(null);
  existsSync.mockReturnValue(false);
  isPayloadCompatibleWithKind.mockReturnValue(true);
  extractCompletionAudit.mockReturnValue({ verdict: "close", reason: "verified" });
  enforceDeliveryGate.mockImplementation((audit) => audit);
  applyCompletionAudit.mockResolvedValue({ action: "closed" });
  currentRunTerminalFingerprint.mockReturnValue("completed:f1");
  currentRunStatus.mockReturnValue("completed");
  currentRunSummary.mockReturnValue({ status: "failed" });
  currentRunArtifacts.mockReturnValue([]);
  isOutcomeSummaryExecutionSource.mockReturnValue(true);
  startGenerationChainRun.mockResolvedValue({ runId: "run-audit", chainId: "run-summary-generation" });
});

describe("startTaskOutcomeAudit", () => {
  it("releases the execution fingerprint when the summary chain cannot launch", async () => {
    taskGet.mockReturnValue({
      id: "TASK-079",
      title: "Copy baseline findings",
      status: "open",
      issue_type: "task",
      metadata: {
        last_run_id: "run-execution",
        summarized_run_fingerprints: ["run-older::completed:old"],
      },
    });
    startGenerationChainRun.mockRejectedValue(new Error("write EPIPE"));

    await expect(startTaskOutcomeAudit({
      request: {} as Request,
      namespaceId: "default",
      orgId: "default",
      taskId: "TASK-079",
    })).rejects.toThrow("write EPIPE");

    expect(taskUpdate).toHaveBeenLastCalledWith(
      "default",
      "TASK-079",
      {
        metadata: expect.objectContaining({
          task_outcome_summary_status: "failed",
          task_outcome_summary_error: "write EPIPE",
          task_outcome_summary_run_fingerprint: undefined,
          task_outcome_summary_failures: 1,
          summarized_run_fingerprints: ["run-older::completed:old"],
        }),
      },
      "default",
    );
  });

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

  it("starts exactly one outcome summary for a blocked execution source", async () => {
    taskGet.mockReturnValue({
      id: "TASK-020",
      title: "Investigate routing",
      description: "Inspect the log function",
      status: "in_progress",
      priority: 0,
      issue_type: "task",
      parent_id: null,
      acceptance_criteria: null,
      design: null,
      notes: null,
      workspace_id: "/repo/synthyo",
      metadata: {
        last_run_id: "run-blocked",
        last_run_status: "blocked",
        last_run_blocked_reason: "startup_recovery:unknown: CLI readiness unresolved after 90s",
      },
    });
    currentRunStatus.mockReturnValue("blocked");
    currentRunTerminalFingerprint.mockReturnValue("blocked:2026-07-15T17:47:37.889Z");

    const result = await startTaskOutcomeAudit({
      request: {} as Request,
      namespaceId: "default",
      orgId: "default",
      taskId: "TASK-020",
    });

    expect(result).toMatchObject({
      status: "started",
      sourceRunId: "run-blocked",
      jobId: "job-audit",
    });
    expect(createJob).toHaveBeenCalledWith(
      "task_run_summary",
      expect.objectContaining({
        taskId: "TASK-020",
        sourceRunId: "run-blocked",
        runFingerprint: "blocked:2026-07-15T17:47:37.889Z",
      }),
      "TASK-020",
      undefined,
      undefined,
      "default",
    );
    expect(startGenerationChainRun).toHaveBeenCalledTimes(1);
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
    expect(isOutcomeSummaryExecutionSource).toHaveBeenCalledWith(
      "default",
      "default",
      "run-new",
      expect.objectContaining({ last_run_id: "run-old" }),
    );
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

  it("uses the persisted task-run scope for every source-evidence read", async () => {
    const metadata = {
      last_run_id: "run-scoped",
      task_run_scope: {
        version: 1,
        taskId: "TASK-093",
        runId: "run-scoped",
        namespaceId: "persisted-namespace",
        orgId: "engineering",
      },
    };
    taskGet.mockReturnValue({
      id: "TASK-093",
      title: "Lead capture API",
      status: "in_progress",
      issue_type: "task",
      metadata,
    });

    await startTaskOutcomeAudit({
      request: {} as Request,
      namespaceId: "request-namespace",
      orgId: "default",
      taskId: "TASK-093",
    });

    expect(isOutcomeSummaryExecutionSource).toHaveBeenCalledWith(
      "request-namespace",
      "default",
      "run-scoped",
      metadata,
    );
    expect(currentRunStatus).toHaveBeenCalledWith(
      "request-namespace",
      "default",
      "run-scoped",
      metadata,
    );
    expect(currentRunTerminalFingerprint).toHaveBeenCalledWith(
      "request-namespace",
      "default",
      "run-scoped",
      metadata,
    );
    expect(currentRunSummary).toHaveBeenCalledWith(
      "request-namespace",
      "default",
      "run-scoped",
      undefined,
      metadata,
    );
    expect(currentRunArtifacts).toHaveBeenCalledWith(
      "request-namespace",
      "default",
      "run-scoped",
      undefined,
      metadata,
    );
  });

  it("embeds the self-locating artifacts root and source run id from currentRunArtifacts into the built prompt", async () => {
    taskGet.mockReturnValue({
      id: "TASK-050",
      title: "Audit backend microservices",
      status: "in_progress",
      issue_type: "task",
      metadata: { last_run_id: "run-abs" },
    });
    currentRunArtifacts.mockReturnValue({
      sourceRunId: "run-abs",
      artifactsRoot: "/Users/test/.mentiko/namespaces/default/runs/run-abs/artifacts",
      runJson: [],
      metadata: [],
      disk: [{
        path: "final-verifier-summary.json",
        absolutePath: "/Users/test/.mentiko/namespaces/default/runs/run-abs/artifacts/final-verifier-summary.json",
        name: "final-verifier-summary.json",
        size: 10,
        modifiedAt: "2026-01-01T00:00:00.000Z",
      }],
    });

    await startTaskOutcomeAudit({
      request: {} as Request,
      namespaceId: "default",
      orgId: "default",
      taskId: "TASK-050",
    });

    const jobInput = createJob.mock.calls[0][1] as { prompt: string };
    expect(jobInput.prompt).toContain("\"sourceRunId\": \"run-abs\"");
    expect(jobInput.prompt).toContain("/Users/test/.mentiko/namespaces/default/runs/run-abs/artifacts");
  });

  it("falls back to the default template when the stored copy predates the ARTIFACTS ROOT upgrade", async () => {
    taskGet.mockReturnValue({
      id: "TASK-060",
      title: "Legacy task",
      status: "in_progress",
      issue_type: "task",
      metadata: { last_run_id: "run-legacy" },
    });
    getTemplate.mockReturnValue({ content: "COMPLETION AUDIT\nstale stored copy {{TASK_DATA}}" });

    await startTaskOutcomeAudit({
      request: {} as Request,
      namespaceId: "default",
      orgId: "default",
      taskId: "TASK-060",
    });

    const jobInput = createJob.mock.calls[0][1] as { prompt: string };
    expect(jobInput.prompt).not.toContain("stale stored copy");
  });

  it("falls back to the default template when the stored copy predates the MOOT CRITERIA CLOSE RULE upgrade", async () => {
    taskGet.mockReturnValue({
      id: "TASK-062",
      title: "Legacy task",
      status: "in_progress",
      issue_type: "task",
      metadata: { last_run_id: "run-legacy2" },
    });
    getTemplate.mockReturnValue({ content: "COMPLETION AUDIT ARTIFACTS ROOT stale stored copy {{TASK_DATA}}" });

    await startTaskOutcomeAudit({
      request: {} as Request,
      namespaceId: "default",
      orgId: "default",
      taskId: "TASK-062",
    });

    const jobInput = createJob.mock.calls[0][1] as { prompt: string };
    expect(jobInput.prompt).not.toContain("stale stored copy");
  });

  it("keeps a stored template that has every current audit marker instead of falling back", async () => {
    taskGet.mockReturnValue({
      id: "TASK-061",
      title: "Current task",
      status: "in_progress",
      issue_type: "task",
      metadata: { last_run_id: "run-current" },
    });
    getTemplate.mockReturnValue({ content: "COMPLETION AUDIT ARTIFACTS ROOT MOOT CRITERIA CLOSE RULE OBSERVABLE END-STATE DELIVERY CHECK custom copy {{TASK_DATA}}" });

    await startTaskOutcomeAudit({
      request: {} as Request,
      namespaceId: "default",
      orgId: "default",
      taskId: "TASK-061",
    });

    const jobInput = createJob.mock.calls[0][1] as { prompt: string };
    expect(jobInput.prompt).toContain("custom copy");
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

describe("recoverTaskOutcomeAudit", () => {
  it("imports only the failed job's validated artifact and applies its audit", async () => {
    const task = {
      id: "TASK-107",
      title: "Verify MCP connectivity",
      issue_type: "task",
      status: "open",
      workspace_id: "/repo/synthyo",
      metadata: {
        lifecycle_phase: "summarizing",
        task_outcome_summary_status: "running",
        task_outcome_summary_job_id: "job-summary",
        task_outcome_summary_source_run_id: "run-execution",
        task_run_scope: { version: 1, taskId: "TASK-107", runId: "run-execution", namespaceId: "default", orgId: "default" },
      },
    };
    taskGet.mockReturnValue(task);
    getJob.mockReturnValue({
      id: "job-summary",
      type: "task_run_summary",
      status: "failed",
      taskId: "TASK-107",
      runId: "run-summary",
      chainId: "run-summary-generation",
      input: { sourceRunId: "run-execution", runFingerprint: "completed:f1" },
    });
    existsSync.mockReturnValue(true);
    const payload = {
      headline: "Connectivity restored",
      narrative: "All checks passed.",
      outcome: "complete",
      audit: { verdict: "close", reason: "all checks passed" },
    };
    readFileSync.mockReturnValue(JSON.stringify(payload));
    enforceDeliveryGate.mockReturnValue(payload.audit);

    const result = await recoverTaskOutcomeAudit({
      request: {} as Request,
      namespaceId: "default",
      orgId: "default",
      taskId: "TASK-107",
    });

    expect(result).toEqual({ status: "recovered", jobId: "job-summary", sourceRunId: "run-execution" });
    expect(updateJob).toHaveBeenCalledWith("job-summary", expect.objectContaining({
      status: "complete",
      result: { output: JSON.stringify(payload) },
      error: undefined,
    }), "default");
    expect(taskUpdate).toHaveBeenCalledWith("default", "TASK-107", {
      metadata: expect.objectContaining({
        task_outcome_summary_status: "complete",
        task_outcome_summary: payload,
        task_outcome_summary_error: undefined,
      }),
    }, "default");
    expect(applyCompletionAudit).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-execution",
      runFingerprint: "completed:f1",
      audit: payload.audit,
    }));
  });

  it("does not mutate when the failed summary artifact is not a valid audit payload", async () => {
    taskGet.mockReturnValue({
      id: "TASK-107",
      metadata: {
        task_outcome_summary_job_id: "job-summary",
        task_outcome_summary_source_run_id: "run-execution",
      },
    });
    getJob.mockReturnValue({
      id: "job-summary",
      type: "task_run_summary",
      status: "failed",
      taskId: "TASK-107",
      runId: "run-summary",
      input: { sourceRunId: "run-execution" },
    });
    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue("{}");
    isPayloadCompatibleWithKind.mockReturnValue(false);

    await expect(recoverTaskOutcomeAudit({
      request: {} as Request,
      namespaceId: "default",
      orgId: "default",
      taskId: "TASK-107",
    })).resolves.toEqual({ status: "not_recoverable" });
    expect(updateJob).not.toHaveBeenCalled();
    expect(taskUpdate).not.toHaveBeenCalled();
    expect(applyCompletionAudit).not.toHaveBeenCalled();
  });
});
