import { NextRequest } from "next/server";
import { getJob, updateJob } from "@/lib/runs/job-store";
import { taskGet, taskUpdate } from "@/lib/tasks/task-store";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getDecision, updateDecision } from "@/lib/decisions/decision-storage";
import { postProcessChain } from "@/lib/chains/chain-postprocessor";
import { Unauthorized, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { hasInternalAuth } from "@/lib/auth/internal-api-auth";
import { internalApiUrl } from "@/lib/auth/internal-web-origin";
import { applyDecisionRunResult, type DecisionRunPhase } from "@/lib/decisions/decision-run-results";
import { advanceDecisionAfterPhase } from "@/lib/decisions/decision-auto-advance";
import { processTaskGenerationResult } from "@/lib/tasks/generated-task-import";
import { resolveTaskAutoRunDefault } from "@/lib/tasks/task-auto-run-default";
import { extractCompletionAudit } from "@/lib/tasks/completion-audit-schema";
import { applyCompletionAudit } from "@/lib/tasks/completion-audit-apply";
import { enforceDeliveryGate } from "@/lib/tasks/completion-audit-delivery-gate";
import {
  outcomeSummarySourceEligibility,
} from "@/lib/tasks/run-outcome-evidence";
import { unwrapAgentJsonOutput } from "@/lib/tasks/agent-json-output";
import {
  GeneratedChainContractError,
  validateGeneratedChainDeliveryContract,
} from "@/lib/chains/generated-chain-delivery-contract";
import {
  buildGeneratedChainRejectionEnvelope,
  canonicalGeneratedChainHash,
  findGeneratedChainRejection,
  recordGeneratedChainRejection,
  type GeneratedChainRejectionEnvelope,
} from "@/lib/chains/generated-chain-rejections";
import { decideGenerationRejection } from "@/lib/tasks/generation-rejection-policy";
import { resolveChainAgents } from "@/lib/agents/agent-loader";
import {
  extractGeneratedChainResult,
  INVALID_GENERATED_CHAIN_RESULT_ERROR,
} from "@/lib/chains/generated-chain-result";
import { taskLifecycleRunFingerprintKey } from "@/lib/orchestration/task-lifecycle-types";

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

/**
 * Import-door rejection bookkeeping (A3/A4): persist the typed envelope and
 * the deterministic-fingerprint decision on the linked task, so the auto-run
 * retry path can branch on typed data instead of parsing the error message.
 * The stop decision itself (halt vs one guided regeneration) is applied by
 * /api/tasks/auto-run when it observes the failed job.
 */
function applyImportRejectionToTask(
  taskId: string | undefined,
  jobId: string,
  orgId: string,
  namespaceId: string,
  envelope: GeneratedChainRejectionEnvelope,
): void {
  if (!taskId) return;
  try {
    const task = taskGet(orgId, taskId, namespaceId);
    if (!task) return;
    const existing = metadataRecord(task.metadata);
    const decision = decideGenerationRejection({
      envelope,
      priorFingerprints: existing.generation_rejection_fingerprints,
    });
    taskUpdate(orgId, taskId, {
      metadata: {
        ...existing,
        generation_rejection: envelope,
        generation_rejection_job_id: jobId,
        generation_rejection_fingerprints: decision.fingerprints,
        ...(decision.stop ? { generation_stop_reason: decision.stopReason } : {}),
      },
    }, namespaceId);
  } catch (error) {
    console.error("Failed to persist generated-chain rejection on task:", error);
  }
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
 * Internal endpoint called by the compiled typed job worker when a job completes.
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

  // Completion can be called by both the agent and the orchestration backstop.
  // A prior call may have marked the job complete and then died before side
  // effects such as task import ran, so retries must keep repairing missing
  // side effects. Prefer the stored complete result over a retry body's result
  // to avoid re-processing already-normalized output.
  if (job.status === "complete" && job.result && typeof job.result === "object" && !Array.isArray(job.result)) {
    result = job.result as Record<string, unknown>;
  }

  // A core chain-generation run is not complete merely because its agent/run
  // reached a terminal marker. The handoff payload is part of the completion
  // contract. Fail closed here as a second producer boundary so a missing or
  // malformed generation-result can never persist as `complete + result:null`.
  let jobStatus = status || (error ? "failed" : "complete");
  let jobError = error;
  if (
    jobStatus === "complete"
    && job.type === "generate"
    && !extractGeneratedChainResult(result || job.result)
  ) {
    jobStatus = "failed";
    jobError = INVALID_GENERATED_CHAIN_RESULT_ERROR;
  }

  // update job
  updateJob(id, {
    status: jobStatus,
    result: result || job.result,
    error: jobStatus === "failed" ? jobError || job.error : undefined,
    runId: typeof body.runId === "string" ? body.runId : job.runId,
    chainId: typeof body.chainId === "string" ? body.chainId : job.chainId,
    completedAt: jobStatus === "complete" || jobStatus === "failed" ? new Date().toISOString() : job.completedAt,
  }, namespaceId);

  // post-process chain generation: extract inline agents -> write to registry -> rewrite with $refs
  if (jobStatus === "complete" && result && job.type === "generate" && !("createdAgents" in result)) {
    try {
      const nsId = typeof job.input.namespaceId === "string" ? job.input.namespaceId : namespaceId;
      const oId = typeof job.input.orgId === "string" ? job.input.orgId : orgId;
      const chainJson = extractGeneratedChainResult(result);

      if (chainJson) {
        // This is the import boundary for model output. Do not persist agents
        // from an activity-only chain and hope the later task audit infers an
        // outcome; every generated agent must declare its handoff and the last
        // one must assert the task contract from evidence.
        //
        // Validate what will actually RUN: a {"$ref": "id"} reuse entry carries
        // its declarations and authorities in the registry, not inline, so the
        // raw model output alone made a correct catalog-reuse chain look like it
        // had no deliverable and no edit_files agent. /api/chains/save has always
        // resolved before validating (save/route.ts) -- this boundary hadn't, and
        // the false rejection cost TASK-203 a regeneration round.
        const chainForContract = { ...chainJson };
        if (Array.isArray(chainJson.agents)) {
          try {
            chainForContract.agents = resolveChainAgents(chainJson.agents, nsId, oId) as unknown[];
          } catch {
            // Unresolvable $ref: validate the raw shape so the rejection names
            // the missing declarations rather than swallowing a broken chain.
            chainForContract.agents = chainJson.agents;
          }
        }
        // Deterministic-duplicate check FIRST (A4): an artifact already
        // rejected under the current validator revision fails identically, so
        // consult the shared rejection ledger before re-validating. Recovery
        // and save consult the same ledger -- one decision for every door.
        const artifactHash = canonicalGeneratedChainHash(chainJson);
        const priorRejection = findGeneratedChainRejection(nsId, oId, artifactHash);
        const contractErrors = priorRejection
          ? [priorRejection.message]
          : validateGeneratedChainDeliveryContract(chainForContract);
        if (contractErrors.length > 0) {
          // A rejected generated-chain payload is an expected outcome of model
          // generation, not an internal server error: mark the job failed and
          // let the rest of this handler run (task metadata + auto-run
          // continuation) -- CHOR-001 (2026-07-20) aborted with a 500 here and
          // nothing ever learned the generation failed. The typed envelope is
          // what the retry path branches on; the message is display-only.
          const envelope: GeneratedChainRejectionEnvelope = priorRejection
            ? { ...priorRejection, phase: "import", at: new Date().toISOString() }
            : buildGeneratedChainRejectionEnvelope({ phase: "import", chain: chainJson, errors: contractErrors });
          if (!priorRejection) recordGeneratedChainRejection(nsId, oId, envelope);
          updateJob(id, {
            status: "failed",
            error: new GeneratedChainContractError(contractErrors).message,
            completedAt: new Date().toISOString(),
          }, namespaceId);
          applyImportRejectionToTask(job.taskId, id, oId, namespaceId, envelope);
        } else {
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
      }
    } catch (e) {
      // Only unexpected failures (post-processing, storage) reach here now --
      // contract rejections are handled above without throwing.
      const message = e instanceof Error ? e.message : String(e);
      updateJob(id, {
        status: "failed",
        error: message,
        completedAt: new Date().toISOString(),
      }, namespaceId);
      throw e;
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
      const allowDecisionRouting = updatedJob.input.allowDecisionRouting !== false;
      const taskGenerationResult = unwrapAgentJsonOutput(updatedJob.result) ?? updatedJob.result;
      // Agent-as-gate: the generation agent decides task vs decision in its
      // output; processTaskGenerationResult honors that (route "decision" ->
      // createTaskDecision, otherwise import the task tree). Job runners may
      // persist the agent payload as { output: "<JSON>" }; unwrap that transport
      // envelope before applying the generation contract.
      const outcome = await processTaskGenerationResult({
        namespaceId,
        orgId,
        result: taskGenerationResult,
        workspacePath,
        parentId,
        createdBy: "mentiko-generation",
        generationJobId: updatedJob.id,
        generationRunId: updatedJob.runId,
        generationChainId: updatedJob.chainId,
        autoRun,
        allowDecisionRouting,
        metadata: taskGenerationMetadataFromJobInput(updatedJob.input),
      });

      if (outcome.kind === "decision") {
        const enrichedResult = {
          ...updatedJob.result,
          routedTo: "decision",
          decisionId: outcome.decisionId,
          taskId: outcome.taskId,
        };
        updateJob(id, {
          taskId: outcome.taskId,
          result: enrichedResult,
        }, namespaceId);
        updatedJob = getJob(id, namespaceId);
        // Decisions don't auto-run — the human steps through them in /decisions.
      } else {
        const enrichedResult = {
          ...updatedJob.result,
          taskId: outcome.parentId,
          createdTaskIds: outcome.createdTaskIds,
          createdTasks: outcome.tasks,
        };
        updateJob(id, {
          taskId: outcome.parentId,
          result: enrichedResult,
        }, namespaceId);
        updatedJob = getJob(id, namespaceId);

        if (autoRun) {
          await triggerAutoRunContinuation(request, namespaceId, orgId, outcome.parentId);
        }
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

        // Same auto-run resolution as the admission gate (explicit flag, else
        // workspace default): a workspace-default task has no meta.auto_run,
        // and gating on ===true stalled its recommend->generate continuation
        // until the 60s poller (ISSUE-006 sibling).
        const shouldContinueAutoRun =
          (updatedJob.status === "complete" || updatedJob.status === "failed") &&
          (updatedJob.type === "recommend" || updatedJob.type === "generate") &&
          resolveTaskAutoRunDefault({
            namespaceId,
            orgId,
            workspacePath: typeof task.workspace_id === "string" ? task.workspace_id : undefined,
            explicitAutoRun: typeof existing.auto_run === "boolean" ? existing.auto_run : undefined,
          });

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
          const advancedDecision = await applyDecisionRunResult({
            namespaceId,
            orgId,
            decisionId: updatedJob.decisionId,
            phase,
            result: updatedJob.result,
            runId: updatedJob.runId,
            workspacePath: decisionWs,
            selectedOptionId: typeof updatedJob.input?.selectedOptionId === "string"
              ? updatedJob.input.selectedOptionId
              : undefined,
          });
          // Drive the next generation step server-side (headless) up to the human
          // selection gate; auto-resolve after the plan. See lib/decisions/decision-auto-advance.
          advanceDecisionAfterPhase({ namespaceId, orgId, decision: advancedDecision });
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
  if (updatedJob?.status === "complete" && updatedJob.type === "link_summary" && updatedJob.result) {
    try {
      const runId = updatedJob.input?.runId as string | undefined;
      if (runId) {
        const { resolveLinkRunPaths } = await import("@/lib/links/link-run-runtime");
        const { runDir } = resolveLinkRunPaths(namespaceId, orgId, runId);
        const { writeFileSync } = await import("fs");
        const { join } = await import("path");
        writeFileSync(join(runDir, "summary.json"), JSON.stringify(updatedJob.result, null, 2), "utf-8");
      }
    } catch (e) {
      console.error("Failed to write link summary:", e);
    }
  }

  if (updatedJob?.type === "task_run_summary" && updatedJob.taskId) {
    try {
      const task = taskGet(orgId, updatedJob.taskId, namespaceId);
      if (task) {
        const existing = metadataRecord(task.metadata);
        const sourceRunId = typeof updatedJob.input?.sourceRunId === "string"
          ? updatedJob.input.sourceRunId
          : undefined;
        const expectedFingerprint = typeof updatedJob.input?.runFingerprint === "string"
          ? updatedJob.input.runFingerprint
          : undefined;
        const sourceEligibility = sourceRunId
          ? outcomeSummarySourceEligibility(namespaceId, orgId, sourceRunId, expectedFingerprint)
          : undefined;
        const runFingerprint = expectedFingerprint || sourceEligibility?.fingerprint;
        const summaryAccepted = sourceEligibility?.eligible === true;
        const summarySucceeded = summaryAccepted && updatedJob.status === "complete" && !!updatedJob.result;
        const summaryFingerprintKey = sourceRunId && runFingerprint
          ? taskLifecycleRunFingerprintKey(sourceRunId, runFingerprint)
          : undefined;
        const summarizedFingerprints = Array.isArray(existing.summarized_run_fingerprints)
          ? existing.summarized_run_fingerprints.filter(
              (value): value is string => typeof value === "string" && value.length > 0 && value !== summaryFingerprintKey,
            )
          : [];
        const summaryFailureAlreadyRecorded =
          existing.task_outcome_summary_job_id === updatedJob.id
          && existing.task_outcome_summary_status === "failed";
        const summaryFailures = summarySucceeded
          ? 0
          : summaryFailureAlreadyRecorded
            ? (typeof existing.task_outcome_summary_failures === "number" ? existing.task_outcome_summary_failures : 1)
            : (typeof existing.task_outcome_summary_failures === "number" ? existing.task_outcome_summary_failures : 0) + 1;
        taskUpdate(orgId, updatedJob.taskId, {
          metadata: {
            ...existing,
            task_outcome_summary_status: summaryAccepted ? updatedJob.status : "superseded",
            task_outcome_summary_job_id: updatedJob.id,
            task_outcome_summary_run_id: updatedJob.runId,
            task_outcome_summary_chain_id: updatedJob.chainId,
            task_outcome_summary_failures: summaryFailures,
            ...(sourceRunId ? { task_outcome_summary_source_run_id: sourceRunId } : {}),
            ...(summarySucceeded && runFingerprint
              ? { task_outcome_summary_run_fingerprint: runFingerprint }
              : {
                  task_outcome_summary_run_fingerprint: undefined,
                  summarized_run_fingerprints: summarizedFingerprints,
                }),
            ...(summarySucceeded
              ? {
                  // Store the auditor's canonical payload (headline, narrative,
                  // audit, ...), NOT the raw { output: "<json string>" } job
                  // envelope. The completion-audit path below already unwraps
                  // this same envelope via extractCompletionAudit; the summary
                  // read path (aiOutcomeSummary) expects the unwrapped object.
                  task_outcome_summary: unwrapAgentJsonOutput(updatedJob.result) ?? updatedJob.result,
                  task_outcome_summary_completed_at: updatedJob.completedAt || new Date().toISOString(),
                  task_outcome_summary_error: undefined,
                }
              : {
                  task_outcome_summary: undefined,
                  task_outcome_summary_completed_at: undefined,
                  task_outcome_summary_error: sourceEligibility?.reason
                    || updatedJob.error
                    || "Task outcome summary failed",
                }),
          },
        }, namespaceId);
      }
    } catch (e) {
      console.error("Failed to write task outcome summary:", e);
    }
  }

  // completion audit: the run-summary agent doubles as an auditor and embeds a
  // triage verdict (close | decision | retry) under result.audit. Apply it so a
  // completed task-backed run self-closes, escalates to a decision, or reopens
  // for a context-injected retry.
  if (
    updatedJob?.type === "task_run_summary" &&
    updatedJob.taskId &&
    updatedJob.status === "complete" &&
    updatedJob.result
  ) {
    try {
      const rawAudit = extractCompletionAudit(updatedJob.result);
      const sourceRunId = typeof updatedJob.input?.sourceRunId === "string"
        ? updatedJob.input.sourceRunId
        : undefined;
      const auditTask = taskGet(orgId, updatedJob.taskId, namespaceId);
      if (rawAudit && sourceRunId && auditTask) {
        const expectedFingerprint = typeof updatedJob.input?.runFingerprint === "string"
          ? updatedJob.input.runFingerprint
          : undefined;
        const sourceEligibility = outcomeSummarySourceEligibility(
          namespaceId,
          orgId,
          sourceRunId,
          expectedFingerprint,
        );
        if (!sourceEligibility.eligible) {
          console.log(
            `[completion-audit] task ${updatedJob.taskId} run ${sourceRunId}: skipped superseded audit (${sourceEligibility.reason})`,
          );
          return apiSuccess({ success: true, job: updatedJob });
        }
        // Deterministic backstop: the auditor is an LLM judgment call and can
        // be talked into "close" by a chain that never wrote anything (see
        // completion-audit-delivery-gate.ts — this is the exact bug that let
        // FEAT-014 close after a read-only, spec-only chain). Downgrades
        // "close" to "decision" for feature/task/bug work when no agent in
        // the audited chain had file-write authority; no-op otherwise.
        const audit = enforceDeliveryGate(rawAudit, auditTask, namespaceId, orgId, sourceRunId);
        const outcome = await applyCompletionAudit({
          request,
          namespaceId,
          orgId,
          task: auditTask,
          audit,
          runId: sourceRunId,
          runFingerprint: sourceEligibility.fingerprint,
          workspacePath: workspacePathFromJobInput(updatedJob.input || {}),
          metadata: metadataRecord(auditTask.metadata),
        });
        console.log(
          `[completion-audit] task ${updatedJob.taskId} run ${sourceRunId}: ${rawAudit.verdict}` +
          (audit.verdict !== rawAudit.verdict ? ` -> delivery-gate:${audit.verdict}` : "") +
          ` -> ${outcome.action}`,
        );
      }
    } catch (e) {
      console.error("Failed to apply completion audit:", e);
    }
  }

  return apiSuccess({ success: true, job: updatedJob });
});
