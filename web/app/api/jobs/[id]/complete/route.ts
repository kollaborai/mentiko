import { NextRequest } from "next/server";
import { getJob, updateJob } from "@/lib/job-store";
import { taskGet, taskUpdate } from "@/lib/task-store";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getDecision, updateDecision } from "@/lib/decision-storage";
import { postProcessChain } from "@/lib/chain-postprocessor";
import { Unauthorized, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { hasInternalAuth } from "@/lib/internal-api-auth";
import { internalApiUrl } from "@/lib/internal-web-origin";
import { applyDecisionRunResult, type DecisionRunPhase } from "@/lib/decision-run-results";
import { importGeneratedTaskTree, type GeneratedTask } from "@/lib/generated-task-import";

export const dynamic = "force-dynamic";

export const runtime = "nodejs";

async function triggerAutoRunContinuation(
  request: NextRequest,
  namespaceId: string,
  orgId: string,
  taskId: string
) {
  const secret = process.env.BETTER_AUTH_SECRET || "";
  try {
    await fetch(internalApiUrl("/api/tasks/auto-run", request.url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
        "x-namespace-id": namespaceId,
        "x-org-id": orgId,
      },
      body: JSON.stringify({ taskId }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (err) {
    console.warn("[auto-run] failed to continue after job completion:", err);
  }
}

function decisionPhaseForJobType(type: string): DecisionRunPhase | null {
  if (type === "decision_research" || type === "decision_steering") return "research";
  if (type === "decision_retrospective") return "retrospective";
  if (type === "decision_guided_questions") return "questions";
  if (type === "preference_synthesis") return "synthesis";
  if (type === "decision_guided_options") return "options";
  if (type === "decision_guided_plan") return "plan";
  return null;
}

function workspacePathFromJobInput(input: Record<string, unknown>): string | undefined {
  if (typeof input.workspacePath === "string") return input.workspacePath;
  if (typeof input.workspaceId === "string") return input.workspaceId;
  if (typeof input.workspaceCwd === "string") return input.workspaceCwd;
  return undefined;
}

function taskGenerationMetadataFromJobInput(input: Record<string, unknown>): Record<string, unknown> | undefined {
  const metadata = input.taskGenerationMetadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  return metadata as Record<string, unknown>;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function chainAssignmentAuditMetadata(
  jobType: string,
  status: string,
  runId?: string,
  chainId?: string
): Record<string, unknown> | null {
  if (jobType === "recommend") {
    return {
      analysis_status: status,
      ...(runId ? { recommendation_run_id: runId } : {}),
      ...(chainId ? { recommendation_chain_id: chainId } : {}),
    };
  }

  if (jobType === "generate") {
    return {
      generation_status: status,
      ...(runId ? { generated_chain_run_id: runId } : {}),
      ...(chainId ? { generated_chain_source_chain_id: chainId } : {}),
    };
  }

  return null;
}

function removeAuditRunFromExecutionMetadata(
  metadata: Record<string, unknown>,
  auditRunId?: string
): Record<string, unknown> {
  if (!auditRunId || metadata.last_run_id !== auditRunId) return metadata;

  const cleaned = { ...metadata };
  delete cleaned.last_run_id;
  delete cleaned.last_run_status;
  delete cleaned.last_run_outcome;
  delete cleaned.last_run_decision_required;
  delete cleaned.last_run_error;
  delete cleaned.last_run_completed;
  return cleaned;
}

/**
 * POST /api/jobs/[id]/complete
 *
 * Internal endpoint called by job-runner.mjs when a job completes.
 * Updates job status and linked entity metadata (task or decision).
 *
 * Auth: uses BETTER_AUTH_SECRET. Unconfigured local dev may use loopback.
 */
export const POST = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const { id } = await context.params;
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  if (!hasInternalAuth(request, "jobs-complete")) {
    throw new Unauthorized();
  }

  const body = await request.json();
  const { status, error } = body as {
    status?: "complete" | "failed";
    result?: Record<string, unknown>;
    error?: string;
    runId?: string;
    chainId?: string;
  };
  let { result } = body as { result?: Record<string, unknown> };

  // get current job state
  const job = getJob(id, namespaceId);
  if (!job) {
    throw new NotFound("Job", id);
  }

  // update job
  const jobStatus = status || (error ? "failed" : "complete");
  updateJob(id, {
    status: jobStatus,
    result: result || job.result,
    error: jobStatus === "failed" ? error || job.error : undefined,
    runId: typeof body.runId === "string" ? body.runId : job.runId,
    chainId: typeof body.chainId === "string" ? body.chainId : job.chainId,
    completedAt: jobStatus === "complete" || jobStatus === "failed" ? new Date().toISOString() : job.completedAt,
  }, namespaceId);

  // post-process chain generation: extract inline agents -> write to registry -> rewrite with $refs
  if (status === "complete" && result && job.type === "generate") {
    try {
      const nsId = (job.input.namespaceId as string) || "default";
      const oId = (job.input.orgId as string) || "default";
      const rawOutput = (result.output as string) || "";

      // try to parse the chain JSON from the output
      let chainJson: Record<string, unknown> | null = null;
      try {
        // output might be a JSON string directly or wrapped in ```json blocks
        const cleaned = rawOutput.replace(/^```(?:json)?\n?/m, "").replace(/\n?```\s*$/m, "").trim();
        chainJson = JSON.parse(cleaned);
      } catch {
        // not parseable, skip post-processing
      }

      if (chainJson && Array.isArray(chainJson.agents)) {
        const processed = await postProcessChain(chainJson, nsId, oId);
        // update result with processed chain
        result = {
          ...result,
          output: JSON.stringify(processed.chain, null, 2),
          createdAgents: processed.createdAgents,
          extractedCount: processed.extractedCount,
        };
        updateJob(id, { result }, namespaceId);
      }
    } catch (e) {
      console.error("Chain post-processing failed:", e);
      // don't fail the whole callback - chain is still usable inline
    }
  }

  // re-fetch to get updated state
  let updatedJob = getJob(id, namespaceId);

  if (updatedJob?.type === "task" && updatedJob.status === "complete" && updatedJob.result && !updatedJob.taskId) {
    try {
      const workspacePath = workspacePathFromJobInput(updatedJob.input);
      const parentId = typeof updatedJob.input.parentId === "string"
        ? updatedJob.input.parentId
        : undefined;
      const autoRun = updatedJob.input.autoRun === true;
      const importResult = importGeneratedTaskTree({
        namespaceId,
        orgId,
        generated: updatedJob.result as unknown as GeneratedTask,
        workspacePath,
        parentId,
        createdBy: "mentiko-generation",
        generationJobId: updatedJob.id,
        generationRunId: updatedJob.runId,
        generationChainId: updatedJob.chainId,
        autoRun,
        metadata: taskGenerationMetadataFromJobInput(updatedJob.input),
      });
      const enrichedResult = {
        ...updatedJob.result,
        taskId: importResult.parentId,
        createdTaskIds: importResult.createdTaskIds,
        createdTasks: importResult.tasks,
      };
      updateJob(id, {
        taskId: importResult.parentId,
        result: enrichedResult,
      }, namespaceId);
      updatedJob = getJob(id, namespaceId);

      if (autoRun) {
        await triggerAutoRunContinuation(request, namespaceId, orgId, importResult.parentId);
      }
    } catch (e) {
      updateJob(id, {
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
        completedAt: new Date().toISOString(),
      }, namespaceId);
      throw e;
    }
  }

  // update task metadata if linked
  if (updatedJob?.taskId) {
    try {
      const orgId = await getOrgIdFromRequest(request);
      const task = taskGet(orgId, updatedJob.taskId, namespaceId);

      if (task) {
        const existing = metadataRecord(task.metadata);

        const auditMetadata = chainAssignmentAuditMetadata(
          updatedJob.type,
          updatedJob.status,
          updatedJob.runId,
          updatedJob.chainId
        );

        if (auditMetadata) {
          const cleanedExisting = removeAuditRunFromExecutionMetadata(existing, updatedJob.runId);
          taskUpdate(orgId, updatedJob.taskId, {
            metadata: {
              ...cleanedExisting,
              ...auditMetadata,
            },
          }, namespaceId);
        }

        const shouldContinueAutoRun =
          updatedJob.status === "complete" &&
          (updatedJob.type === "recommend" || updatedJob.type === "generate") &&
          existing.auto_run === true;

        if (shouldContinueAutoRun) {
          await triggerAutoRunContinuation(request, namespaceId, orgId, updatedJob.taskId);
        }
      } else {
        console.warn(`Task ${updatedJob.taskId} not found. Job completed but task metadata not updated.`);
      }
    } catch (e) {
      console.error("Failed to update task metadata:", e);
    }
  }

  // update decision job references if linked.
  if (updatedJob?.decisionId) {
    try {
      const jobWorkspacePath =
        typeof updatedJob.input?.workspacePath === "string"
          ? updatedJob.input.workspacePath
          : typeof updatedJob.input?.workspaceId === "string"
            ? updatedJob.input.workspaceId
            : typeof updatedJob.input?.workspaceCwd === "string"
              ? updatedJob.input.workspaceCwd
              : undefined;
      const decision =
        getDecision(namespaceId, orgId, updatedJob.decisionId, jobWorkspacePath) ??
        getDecision(namespaceId, orgId, updatedJob.decisionId);
      const decisionWs = decision?.workspacePath ?? jobWorkspacePath;
      if (decision) {
        const phase = decisionPhaseForJobType(updatedJob.type);
        const isComplete = updatedJob.status === "complete";

        if (phase && isComplete && updatedJob.result) {
          await applyDecisionRunResult({
            namespaceId,
            orgId,
            decisionId: updatedJob.decisionId,
            phase,
            result: updatedJob.result,
            workspacePath: decisionWs,
            selectedOptionId: typeof updatedJob.input?.selectedOptionId === "string"
              ? updatedJob.input.selectedOptionId
              : undefined,
          });
        } else if (phase === "research") {
          // job failed or no result - just clear the pointer
          await updateDecision(namespaceId, orgId, updatedJob.decisionId, {
            activeJobId: undefined,
          }, decisionWs);
        } else if (phase === "retrospective") {
          // failed - leave retroJobId so user can retry
        } else if (phase === "questions") {
          // failed - clear generationJobId
          if (decision.guidedFlow) {
            decision.guidedFlow.round1.generationJobId = undefined;
            await updateDecision(namespaceId, orgId, updatedJob.decisionId, { guidedFlow: decision.guidedFlow }, decisionWs);
          }
        } else if (phase === "synthesis") {
          // failed - clear synthesisJobId
          if (decision.guidedFlow) {
            decision.guidedFlow.round1.synthesisJobId = undefined;
            decision.guidedFlow.round1.status = "in_progress";
            await updateDecision(namespaceId, orgId, updatedJob.decisionId, { guidedFlow: decision.guidedFlow }, decisionWs);
          }
        } else if (phase === "options") {
          // failed - clear generationJobId
          if (decision.guidedFlow) {
            decision.guidedFlow.round2.generationJobId = undefined;
            decision.guidedFlow.round2.status = "pending";
            await updateDecision(namespaceId, orgId, updatedJob.decisionId, { guidedFlow: decision.guidedFlow }, decisionWs);
          }
        } else if (phase === "plan") {
          // failed - clear generationJobId
          if (decision.guidedFlow) {
            decision.guidedFlow.round3.generationJobId = undefined;
            decision.guidedFlow.round3.status = "pending";
            await updateDecision(namespaceId, orgId, updatedJob.decisionId, { guidedFlow: decision.guidedFlow }, decisionWs);
          }
        }
      }
    } catch (e) {
      console.error("Failed to update decision job reference:", e);
    }
  }

  // link summary: write result to run directory
  if (status === "complete" && updatedJob?.type === "link_summary" && updatedJob.result) {
    try {
      const runId = updatedJob.input?.runId as string | undefined;
      if (runId) {
        const { resolveLinkRunPaths } = await import("@/lib/link-run-runtime");
        const { runDir } = resolveLinkRunPaths(namespaceId, orgId, runId);
        const { writeFileSync } = await import("fs");
        const { join } = await import("path");
        writeFileSync(join(runDir, "summary.json"), JSON.stringify(updatedJob.result, null, 2), "utf-8");
      }
    } catch (e) {
      console.error("Failed to write link summary:", e);
    }
  }

  return apiSuccess({ success: true, job: updatedJob });
});
