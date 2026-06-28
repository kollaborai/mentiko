// Shared trigger for the run-summary / completion-audit agent. Assembles the
// task + run context, creates a `task_run_summary` job, and starts the
// `run-summary-generation` chain. The agent writes both a narrative summary and
// a triage verdict (consumed in /api/jobs/[id]/complete). Called on-demand from
// /api/tasks/[id]/outcome-summary and autonomously from the reconcile sweep.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getTemplate, DEFAULT_TASK_RUN_SUMMARY_TEMPLATE } from "@/lib/generation/generation-template-storage";
import { resolveTemplate } from "@/lib/system/template-resolver";
import { createJob, listJobs } from "@/lib/runs/job-store";
import { resolveLinkRunsDir } from "@/lib/links/link-run-runtime";
import { taskGet, taskUpdate, validateTaskId } from "@/lib/tasks/task-store";

export interface StartTaskOutcomeAuditInput {
  request: Request;
  namespaceId: string;
  orgId: string;
  taskId: string;
  /** Optional acting user id (omitted for autonomous/system triggers). */
  userId?: string;
}

export interface StartTaskOutcomeAuditResult {
  status: "no_run" | "already_exists" | "running" | "started";
  jobId?: string;
  runId?: string;
  sourceRunId?: string;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readJsonFile(filePath: string): unknown {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function currentRunSummary(namespaceId: string, orgId: string, runId: string, fallback: unknown): unknown {
  const p = join(resolveLinkRunsDir(namespaceId, orgId), runId, "artifacts", "run-summary.json");
  return readJsonFile(p) || fallback || null;
}

function currentRunArtifacts(namespaceId: string, orgId: string, runId: string, fallback: unknown): unknown {
  const run = readJsonFile(join(resolveLinkRunsDir(namespaceId, orgId), runId, "run.json"));
  if (run && typeof run === "object" && !Array.isArray(run)) {
    return (run as Record<string, unknown>).artifacts || fallback || [];
  }
  return fallback || [];
}

/**
 * Kick off (or no-op) the run-summary/audit agent for a task's latest execution
 * run. Idempotent per source run: if an audit already exists or is running for
 * that run, returns without starting a new one.
 */
export async function startTaskOutcomeAudit(
  input: StartTaskOutcomeAuditInput,
): Promise<StartTaskOutcomeAuditResult> {
  const { request, namespaceId, orgId, userId } = input;
  const taskId = validateTaskId(input.taskId);

  const task = taskGet(orgId, taskId, namespaceId);
  if (!task) return { status: "no_run" };

  const metadata = metadataRecord(task.metadata);
  const sourceRunId = typeof metadata.last_run_id === "string" ? metadata.last_run_id : "";
  if (!sourceRunId) return { status: "no_run" };

  // Already audited this run.
  if (metadata.task_outcome_summary_source_run_id === sourceRunId && metadata.task_outcome_summary) {
    return { status: "already_exists", sourceRunId };
  }
  if (metadata.completion_audit_run_id === sourceRunId) {
    return { status: "already_exists", sourceRunId };
  }

  // Audit already in flight for this run.
  const existingJob = listJobs({ taskId, status: "running" }, namespaceId)
    .find((job) => job.type === "task_run_summary" && job.input?.sourceRunId === sourceRunId);
  if (existingJob) {
    return { status: "running", jobId: existingJob.id, runId: existingJob.runId, sourceRunId };
  }

  const workspacePath = typeof metadata.workspace_path === "string" ? metadata.workspace_path : undefined;
  const runSummary = currentRunSummary(namespaceId, orgId, sourceRunId, metadata.last_run_summary);
  const runArtifacts = currentRunArtifacts(namespaceId, orgId, sourceRunId, metadata.last_run_artifacts);
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
    { prompt, taskId, sourceRunId, workspacePath, namespaceId, orgId },
    taskId,
    undefined,
    userId,
    namespaceId,
  );

  taskUpdate(orgId, taskId, {
    metadata: {
      ...metadata,
      task_outcome_summary_job_id: job.id,
      task_outcome_summary_status: "running",
      task_outcome_summary_source_run_id: sourceRunId,
      task_outcome_summary_error: undefined,
    },
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
    taskUpdate(orgId, taskId, {
      metadata: {
        ...metadataRecord(latest?.metadata),
        task_outcome_summary_job_id: job.id,
        task_outcome_summary_status: "running",
        task_outcome_summary_run_id: run.runId,
        task_outcome_summary_chain_id: run.chainId,
        task_outcome_summary_source_run_id: sourceRunId,
      },
    }, namespaceId);

    return { status: "started", jobId: job.id, runId: run.runId, sourceRunId };
  } catch (error) {
    const latest = taskGet(orgId, taskId, namespaceId);
    taskUpdate(orgId, taskId, {
      metadata: {
        ...metadataRecord(latest?.metadata),
        task_outcome_summary_job_id: job.id,
        task_outcome_summary_status: "failed",
        task_outcome_summary_source_run_id: sourceRunId,
        task_outcome_summary_error: error instanceof Error ? error.message : String(error),
      },
    }, namespaceId);
    throw error;
  }
}
