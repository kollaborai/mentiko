import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/api-auth";
import { apiSuccess, withErrorHandling } from "@/lib/api-response";
import { BadRequest, NotFound } from "@/lib/api-errors";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getTemplate, DEFAULT_TASK_RUN_SUMMARY_TEMPLATE } from "@/lib/generation/generation-template-storage";
import { startGenerationChainRun } from "@/lib/generation/generation-chain-dispatch";
import { resolveTemplate } from "@/lib/system/template-resolver";
import { createJob, listJobs } from "@/lib/runs/job-store";
import { taskGet, taskUpdate, validateTaskId } from "@/lib/tasks/task-store";
import {
  currentRunArtifacts,
  currentRunSummary,
  currentRunTerminalFingerprint,
  isOutcomeSummaryExecutionSource,
  metadataRecord,
} from "@/lib/tasks/run-outcome-evidence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = requirePermission("manage_tasks")(
  withErrorHandling(async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => {
    const namespaceId = await getNamespaceIdFromRequest(request);
    const orgId = await getOrgIdFromRequest(request);
    const session = await getSessionUser(request);
    const { id } = await context.params;
    const taskId = validateTaskId(decodeURIComponent(id));
    const task = taskGet(orgId, taskId, namespaceId);
    if (!task) throw new NotFound("Task", taskId);

    const metadata = metadataRecord(task.metadata);
    const sourceRunId = typeof metadata.last_run_id === "string" ? metadata.last_run_id : "";
    if (!sourceRunId) {
      throw new BadRequest("Task has no execution run to summarize");
    }
    if (!isOutcomeSummaryExecutionSource(namespaceId, orgId, sourceRunId)) {
      throw new BadRequest("Task outcome summary source must be an execution run");
    }
    const runFingerprint = currentRunTerminalFingerprint(namespaceId, orgId, sourceRunId);

    const currentSummary = metadata.task_outcome_summary;
    const currentSourceRunId = typeof metadata.task_outcome_summary_source_run_id === "string"
      ? metadata.task_outcome_summary_source_run_id
      : "";
    const currentFingerprint = typeof metadata.task_outcome_summary_run_fingerprint === "string"
      ? metadata.task_outcome_summary_run_fingerprint
      : "";
    if (
      currentSourceRunId === sourceRunId &&
      currentFingerprint === runFingerprint &&
      currentSummary &&
      typeof currentSummary === "object" &&
      !Array.isArray(currentSummary)
    ) {
      return apiSuccess({
        status: "already_exists",
        summary: currentSummary,
        sourceRunId,
      });
    }

    const existingJob = listJobs({ taskId, status: "running" }, namespaceId)
      .find((job) => job.type === "task_run_summary" && job.input?.sourceRunId === sourceRunId);
    if (existingJob) {
      return apiSuccess({
        status: "running",
        jobId: existingJob.id,
        runId: existingJob.runId,
        sourceRunId,
      });
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
    };

    const template = getTemplate(namespaceId, orgId, "task_run_summary");
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
      {
        prompt,
        taskId,
        sourceRunId,
        runFingerprint,
        workspacePath,
        namespaceId,
        orgId,
      },
      taskId,
      undefined,
      session?.id,
      namespaceId
    );

    taskUpdate(orgId, taskId, {
      metadata: {
        ...metadata,
        task_outcome_summary_job_id: job.id,
        task_outcome_summary_status: "running",
        task_outcome_summary_source_run_id: sourceRunId,
        task_outcome_summary_run_fingerprint: runFingerprint,
        task_outcome_summary: undefined,
        task_outcome_summary_completed_at: undefined,
        task_outcome_summary_error: undefined,
      },
    }, namespaceId);

    let run: Awaited<ReturnType<typeof startGenerationChainRun>>;
    try {
      run = await startGenerationChainRun({
        request,
        namespaceId,
        orgId,
        kind: "run_summary",
        job,
        prompt,
        workspacePath,
        taskId,
        metadata: {
          taskOutcomeSummary: true,
          taskOutcomeSourceRunId: sourceRunId,
        },
      });
    } catch (error) {
      const latest = taskGet(orgId, taskId, namespaceId);
      taskUpdate(orgId, taskId, {
        metadata: {
          ...metadataRecord(latest?.metadata),
          task_outcome_summary_job_id: job.id,
          task_outcome_summary_status: "failed",
          task_outcome_summary_source_run_id: sourceRunId,
          task_outcome_summary_run_fingerprint: runFingerprint,
          task_outcome_summary: undefined,
          task_outcome_summary_completed_at: undefined,
          task_outcome_summary_error: error instanceof Error ? error.message : String(error),
        },
      }, namespaceId);
      throw error;
    }

    const latest = taskGet(orgId, taskId, namespaceId);
    taskUpdate(orgId, taskId, {
      metadata: {
        ...metadataRecord(latest?.metadata),
        task_outcome_summary_job_id: job.id,
        task_outcome_summary_status: "running",
        task_outcome_summary_run_id: run.runId,
        task_outcome_summary_chain_id: run.chainId,
        task_outcome_summary_source_run_id: sourceRunId,
        task_outcome_summary_run_fingerprint: runFingerprint,
        task_outcome_summary: undefined,
        task_outcome_summary_completed_at: undefined,
      },
    }, namespaceId);

    return apiSuccess({
      status: "running",
      jobId: job.id,
      runId: run.runId,
      sourceRunId,
    });
  })
);
