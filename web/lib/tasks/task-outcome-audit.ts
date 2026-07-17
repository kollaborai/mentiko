// Shared trigger for the run-summary / completion-audit agent. Assembles the
// task + run context, creates a `task_run_summary` job, and starts the
// `run-summary-generation` chain. The agent writes both a narrative summary and
// a triage verdict (consumed in /api/jobs/[id]/complete). Called on-demand from
// /api/tasks/[id]/outcome-summary and autonomously from the reconcile sweep.

import { getTemplate, DEFAULT_TASK_RUN_SUMMARY_TEMPLATE } from "@/lib/generation/generation-template-storage";
import { resolveTemplate } from "@/lib/system/template-resolver";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createJob, getJob, listJobs, updateJob } from "@/lib/runs/job-store";
import { taskGet, taskUpdate, validateTaskId } from "@/lib/tasks/task-store";
import {
  currentRunArtifacts,
  currentRunSummary,
  currentRunStatus,
  currentRunTerminalFingerprint,
  isOutcomeSummaryTerminalStatus,
  isOutcomeSummaryExecutionSource,
  metadataRecord,
  outcomeSummarySourceEligibility,
} from "@/lib/tasks/run-outcome-evidence";
import { hasExecutionRetriesRemaining } from "@/lib/tasks/execution-retry-policy";
import { taskLifecycleRunFingerprintKey } from "@/lib/orchestration/task-lifecycle-types";
import { isPayloadCompatibleWithKind } from "@/lib/generation/payload-contract";
import { extractCompletionAudit } from "@/lib/tasks/completion-audit-schema";
import { applyCompletionAudit } from "@/lib/tasks/completion-audit-apply";
import { enforceDeliveryGate } from "@/lib/tasks/completion-audit-delivery-gate";

export interface StartTaskOutcomeAuditInput {
  request: Request;
  namespaceId: string;
  orgId: string;
  taskId: string;
  /** Explicit source execution run. Authoritative when provided by lifecycle effects. */
  sourceRunId?: string;
  /** Explicit terminal fingerprint for sourceRunId. Authoritative when provided by lifecycle effects. */
  runFingerprint?: string;
  /** Optional acting user id (omitted for autonomous/system triggers). */
  userId?: string;
}

export interface StartTaskOutcomeAuditResult {
  status: "no_run" | "not_terminal" | "retry_pending" | "already_exists" | "running" | "started";
  jobId?: string;
  runId?: string;
  sourceRunId?: string;
}

export interface RecoverTaskOutcomeAuditResult {
  status: "not_recoverable" | "recovered" | "superseded";
  jobId?: string;
  sourceRunId?: string;
}

/**
 * Recover the exact import failure that can occur after a run-summary agent
 * has already persisted its generation-result artifact. The worker marks that
 * run failed so it cannot be mistaken for live work, but the failed job used
 * to leave its source task in `summarizing` forever. Recovery accepts only the
 * canonical artifact from that job's own generation run, re-validates the
 * source-run fingerprint, and then applies the same summary/audit state that
 * the normal completion endpoint would have applied.
 */
export async function recoverTaskOutcomeAudit(
  input: StartTaskOutcomeAuditInput,
): Promise<RecoverTaskOutcomeAuditResult> {
  const taskId = validateTaskId(input.taskId);
  const task = taskGet(input.orgId, taskId, input.namespaceId);
  if (!task) return { status: "not_recoverable" };
  const metadata = metadataRecord(task.metadata);
  const jobId = typeof metadata.task_outcome_summary_job_id === "string"
    ? metadata.task_outcome_summary_job_id
    : "";
  if (!jobId) return { status: "not_recoverable" };

  const job = getJob(jobId, input.namespaceId);
  if (
    !job ||
    job.status !== "failed" ||
    job.type !== "task_run_summary" ||
    job.taskId !== taskId ||
    !job.runId
  ) return { status: "not_recoverable" };

  const sourceRunId = typeof job.input.sourceRunId === "string" ? job.input.sourceRunId : "";
  const expectedFingerprint = typeof job.input.runFingerprint === "string" ? job.input.runFingerprint : undefined;
  if (!sourceRunId || metadata.task_outcome_summary_source_run_id !== sourceRunId) {
    return { status: "not_recoverable" };
  }
  const eligibility = outcomeSummarySourceEligibility(
    input.namespaceId,
    input.orgId,
    sourceRunId,
    expectedFingerprint,
    metadata,
  );
  if (!eligibility.eligible) return { status: "superseded", jobId, sourceRunId };

  const { resolveLinkRunPaths } = await import("@/lib/links/link-run-runtime");
  const { runDir } = resolveLinkRunPaths(input.namespaceId, input.orgId, job.runId);
  const resultPath = join(runDir, "artifacts", "generation-result.json");
  if (!existsSync(resultPath)) return { status: "not_recoverable" };

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(readFileSync(resultPath, "utf8"));
    if (!isPayloadCompatibleWithKind(parsed, "run_summary")) return { status: "not_recoverable" };
    payload = parsed as Record<string, unknown>;
  } catch {
    return { status: "not_recoverable" };
  }

  const rawAudit = extractCompletionAudit(payload);
  if (!rawAudit) return { status: "not_recoverable" };

  const result = { output: JSON.stringify(payload) };
  updateJob(job.id, {
    status: "complete",
    result,
    error: undefined,
    completedAt: new Date().toISOString(),
  }, input.namespaceId);

  taskUpdate(input.orgId, taskId, {
    metadata: {
      ...metadata,
      task_outcome_summary_status: "complete",
      task_outcome_summary_job_id: job.id,
      task_outcome_summary_run_id: job.runId,
      task_outcome_summary_chain_id: job.chainId,
      task_outcome_summary_source_run_id: sourceRunId,
      task_outcome_summary_run_fingerprint: eligibility.fingerprint,
      task_outcome_summary: payload,
      task_outcome_summary_completed_at: new Date().toISOString(),
      task_outcome_summary_error: undefined,
    },
  }, input.namespaceId);

  const freshTask = taskGet(input.orgId, taskId, input.namespaceId);
  if (!freshTask) return { status: "not_recoverable" };
  const audit = enforceDeliveryGate(rawAudit, freshTask, input.namespaceId, input.orgId, sourceRunId);
  await applyCompletionAudit({
    request: input.request,
    namespaceId: input.namespaceId,
    orgId: input.orgId,
    task: freshTask,
    audit,
    runId: sourceRunId,
    runFingerprint: eligibility.fingerprint,
    workspacePath: freshTask.workspace_id || undefined,
    metadata: metadataRecord(freshTask.metadata),
  });
  return { status: "recovered", jobId, sourceRunId };
}

/**
 * Kick off (or no-op) the run-summary/audit agent for a task's latest execution
 * run. Idempotent per source run terminal fingerprint: if a partial audit was
 * made before the run reached terminal/artifact-backed state, the final state
 * still gets audited.
 */
export async function startTaskOutcomeAudit(
  input: StartTaskOutcomeAuditInput,
): Promise<StartTaskOutcomeAuditResult> {
  const { request, namespaceId, orgId, userId } = input;
  const taskId = validateTaskId(input.taskId);

  const task = taskGet(orgId, taskId, namespaceId);
  if (!task) return { status: "no_run" };

  const metadata = metadataRecord(task.metadata);
  const sourceRunId =
    typeof input.sourceRunId === "string" && input.sourceRunId.length > 0
      ? input.sourceRunId
      : typeof metadata.last_run_id === "string"
        ? metadata.last_run_id
        : "";
  if (!sourceRunId) return { status: "no_run" };
  if (!isOutcomeSummaryExecutionSource(namespaceId, orgId, sourceRunId, metadata)) return { status: "no_run" };
  const runStatus = currentRunStatus(namespaceId, orgId, sourceRunId, metadata);
  if (!isOutcomeSummaryTerminalStatus(runStatus)) {
    return { status: "not_terminal", sourceRunId };
  }
  if (hasExecutionRetriesRemaining(metadata, runStatus)) {
    return { status: "retry_pending", sourceRunId };
  }
  const runFingerprint =
    typeof input.runFingerprint === "string" && input.runFingerprint.length > 0
      ? input.runFingerprint
      : currentRunTerminalFingerprint(namespaceId, orgId, sourceRunId, metadata);
  const auditedFingerprint =
    typeof metadata.task_outcome_summary_run_fingerprint === "string"
      ? metadata.task_outcome_summary_run_fingerprint
      : typeof metadata.completion_audit_run_fingerprint === "string"
        ? metadata.completion_audit_run_fingerprint
        : "";

  // Already audited this run.
  if (
    metadata.task_outcome_summary_source_run_id === sourceRunId &&
    auditedFingerprint === runFingerprint &&
    metadata.task_outcome_summary
  ) {
    taskUpdate(orgId, taskId, {
      metadata: outcomeAuditLifecycleMetadata(metadata, sourceRunId, runFingerprint),
    }, namespaceId);
    return { status: "already_exists", sourceRunId };
  }
  if (metadata.completion_audit_run_id === sourceRunId && auditedFingerprint === runFingerprint) {
    taskUpdate(orgId, taskId, {
      metadata: outcomeAuditLifecycleMetadata(metadata, sourceRunId, runFingerprint),
    }, namespaceId);
    return { status: "already_exists", sourceRunId };
  }

  // Audit already in flight for this run.
  const existingJob = listJobs({ taskId, status: "running" }, namespaceId)
    .find((job) => job.type === "task_run_summary" && job.input?.sourceRunId === sourceRunId);
  if (existingJob) {
    taskUpdate(orgId, taskId, {
      metadata: outcomeAuditLifecycleMetadata(metadata, sourceRunId, runFingerprint, {
        task_outcome_summary_job_id: existingJob.id,
        task_outcome_summary_status: "running",
        task_outcome_summary_run_id: existingJob.runId,
      }),
    }, namespaceId);
    return { status: "running", jobId: existingJob.id, runId: existingJob.runId, sourceRunId };
  }

  const workspacePath = task.workspace_id || (typeof metadata.workspace_path === "string" ? metadata.workspace_path : undefined);
  const runSummary = currentRunSummary(namespaceId, orgId, sourceRunId, metadata.last_run_summary, metadata);
  const runArtifacts = currentRunArtifacts(namespaceId, orgId, sourceRunId, metadata.last_run_artifacts, metadata);
  const generationFlow = {
    task_generation_run_id: metadata.task_generation_run_id,
    recommendation_run_id: metadata.recommendation_run_id,
    generated_chain_run_id: metadata.generated_chain_run_id,
    execution_run_id: sourceRunId,
    chain_id: metadata.chain_id,
    chain_name: metadata.chain_name,
    analysis_status: metadata.analysis_status,
    generation_status: metadata.generation_status,
    auto_run_retries: metadata.auto_run_retries,
    parent_id: task.parent_id,
  };

  const template = getTemplate(namespaceId, orgId, "task_run_summary");
  // Guarantee the auditor verdict instructions even if a stored namespace copy
  // predates the completion-audit upgrade.
  const templateContent = template.content.includes("COMPLETION AUDIT")
    ? template.content
    : DEFAULT_TASK_RUN_SUMMARY_TEMPLATE;
  const prompt = resolveTemplate(templateContent, {
    TASK_DATA: JSON.stringify({
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      type: task.issue_type,
      parent_id: task.parent_id,
      acceptance_criteria: task.acceptance_criteria,
      design: task.design,
      notes: task.notes,
    }, null, 2),
    RUN_SUMMARY: JSON.stringify(runSummary, null, 2),
    RUN_ARTIFACTS: JSON.stringify(runArtifacts, null, 2),
    GENERATION_FLOW: JSON.stringify(generationFlow, null, 2),
    WORKSPACE_CONTEXT: workspacePath || "(no workspace path)",
  });

  const job = createJob(
    "task_run_summary",
    { prompt, taskId, sourceRunId, runFingerprint, workspacePath, namespaceId, orgId },
    taskId,
    undefined,
    userId,
    namespaceId,
  );

  taskUpdate(orgId, taskId, {
    metadata: outcomeAuditLifecycleMetadata(metadata, sourceRunId, runFingerprint, {
      task_outcome_summary_job_id: job.id,
      task_outcome_summary_status: "running",
      task_outcome_summary: undefined,
      task_outcome_summary_completed_at: undefined,
      task_outcome_summary_error: undefined,
    }),
  }, namespaceId);

  try {
    // Lazy import keeps chain-run-service (ESM deps) out of callers' static graphs.
    const { startGenerationChainRun } = await import("@/lib/generation/generation-chain-dispatch");
    const run = await startGenerationChainRun({
      request,
      namespaceId,
      orgId,
      kind: "run_summary",
      job,
      prompt,
      workspacePath,
      taskId,
      metadata: { taskOutcomeSummary: true, taskOutcomeSourceRunId: sourceRunId },
    });

    const latest = taskGet(orgId, taskId, namespaceId);
    const latestMetadata = metadataRecord(latest?.metadata);
    taskUpdate(orgId, taskId, {
      metadata: outcomeAuditLifecycleMetadata(latestMetadata, sourceRunId, runFingerprint, {
        task_outcome_summary_job_id: job.id,
        task_outcome_summary_status: "running",
        task_outcome_summary_run_id: run.runId,
        task_outcome_summary_chain_id: run.chainId,
        task_outcome_summary: undefined,
        task_outcome_summary_completed_at: undefined,
      }),
    }, namespaceId);

    return { status: "started", jobId: job.id, runId: run.runId, sourceRunId };
  } catch (error) {
    const latest = taskGet(orgId, taskId, namespaceId);
    const latestMetadata = metadataRecord(latest?.metadata);
    taskUpdate(orgId, taskId, {
      metadata: outcomeAuditLifecycleMetadata(latestMetadata, sourceRunId, runFingerprint, {
        task_outcome_summary_job_id: job.id,
        task_outcome_summary_status: "failed",
        task_outcome_summary: undefined,
        task_outcome_summary_completed_at: undefined,
        task_outcome_summary_error: error instanceof Error ? error.message : String(error),
      }),
    }, namespaceId);
    throw error;
  }
}

function withLifecycleFingerprint(
  metadata: Record<string, unknown>,
  sourceRunId: string,
  runFingerprint: string,
): string[] {
  const existing = Array.isArray(metadata.summarized_run_fingerprints)
    ? metadata.summarized_run_fingerprints.filter((value): value is string => typeof value === "string" && value.length > 0)
    : [];
  const key = taskLifecycleRunFingerprintKey(sourceRunId, runFingerprint);
  return existing.includes(key) ? existing : [...existing, key];
}

function outcomeAuditLifecycleMetadata(
  metadata: Record<string, unknown>,
  sourceRunId: string,
  runFingerprint: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...metadata,
    ...extra,
    task_outcome_summary_source_run_id: sourceRunId,
    task_outcome_summary_run_fingerprint: runFingerprint,
    summarized_run_fingerprints: withLifecycleFingerprint(metadata, sourceRunId, runFingerprint),
    lifecycle_phase: "summarizing",
  };
}
