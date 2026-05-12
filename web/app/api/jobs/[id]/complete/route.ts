import { NextRequest } from "next/server";
import { getJob, updateJob } from "@/lib/job-store";
import { taskGet, taskUpdate } from "@/lib/task-store";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getDecision, updateDecision } from "@/lib/decision-storage";
import { postProcessChain } from "@/lib/chain-postprocessor";
import type { GuidedFlow, TradeoffQuestion, TailoredOption, Recommendation, ExecutionPlan } from "@/lib/decision-types";
import { Unauthorized, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { hasInternalAuth } from "@/lib/internal-api-auth";

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
    await fetch(`${request.nextUrl.origin}/api/tasks/auto-run`, {
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
    error: error || job.error,
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
  const updatedJob = getJob(id, namespaceId);

  // update task metadata if linked
  if (updatedJob?.taskId) {
    try {
      const orgId = await getOrgIdFromRequest(request);
      const task = taskGet(orgId, updatedJob.taskId, namespaceId);

      if (task) {
        const existing = task.metadata || {};

        // determine which job type based on job.type
        const isAnalysis = updatedJob.type === "recommend";
        const statusKey = isAnalysis ? "analysis_status" : "generation_status";

        taskUpdate(orgId, updatedJob.taskId, {
          metadata: {
            ...existing,
            [statusKey]: updatedJob.status,
          },
        }, namespaceId);

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

  // update decision job references if linked (research/retrospective jobs)
  // note: we only clear the jobId pointer so ui knows job is no longer running.
  // the phase2 endpoints (research/retrospective with jobId body) handle status
  // updates and result application.
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
        const isResearch = updatedJob.type === "decision_research" || updatedJob.type === "decision_steering";
        const isRetro = updatedJob.type === "decision_retrospective";
        const isGuidedQuestions = updatedJob.type === "decision_guided_questions";
        const isGuidedOptions = updatedJob.type === "decision_guided_options";
        const isGuidedPlan = updatedJob.type === "decision_guided_plan";
        const isComplete = updatedJob.status === "complete";

        if (isResearch && isComplete && updatedJob.result) {
          // auto-apply research results directly so UI doesn't need a second round-trip
          const parsed = updatedJob.result as Record<string, unknown>;
          await updateDecision(namespaceId, orgId, updatedJob.decisionId, {
            title: (parsed.title as string) || decision.prompt,
            priority: parsed.priority as string,
            category: parsed.category as string,
            context: parsed.context as typeof decision.context,
            options: (parsed.options as typeof decision.options) || [],
            recommendation: parsed.recommendation as typeof decision.recommendation,
            status: "pending",
            activeJobId: undefined,
          }, decisionWs);
        } else if (isResearch) {
          // job failed or no result - just clear the pointer
          await updateDecision(namespaceId, orgId, updatedJob.decisionId, {
            activeJobId: undefined,
          }, decisionWs);
        } else if (isRetro && isComplete && updatedJob.result) {
          // auto-apply retrospective results - normalize shape to match retrospective/route.ts
          const retroParsed = updatedJob.result as Record<string, unknown>;
          await updateDecision(namespaceId, orgId, updatedJob.decisionId, {
            retrospective: {
              summary: (retroParsed.summary as string) || "",
              outcome: (retroParsed.outcome as string) || "",
              lessonsLearned: (retroParsed.lessonsLearned as string[]) || [],
              completedAt: new Date().toISOString(),
            },
            status: "done",
            retroJobId: undefined,
          }, decisionWs);
        } else if (isRetro) {
          // failed - leave retroJobId so user can retry
        } else if (isGuidedQuestions && isComplete && updatedJob.result) {
          // auto-apply guided questions to round1
          const parsed = updatedJob.result as { questions?: TradeoffQuestion[] };
          const guidedFlow: GuidedFlow = decision.guidedFlow || {
            currentRound: 1,
            round1: { status: "in_progress", questions: [], answers: [] },
            round2: { status: "pending", tailoredOptions: [] },
            round3: { status: "pending" },
          };
          guidedFlow.currentRound = 1;
          guidedFlow.round1.status = "in_progress";
          guidedFlow.round1.questions = parsed.questions || [];
          guidedFlow.round1.generationJobId = undefined;
          guidedFlow.startedAt = guidedFlow.startedAt || new Date().toISOString();
          await updateDecision(namespaceId, orgId, updatedJob.decisionId, {
            guidedFlow,
            mode: "guided",
          }, decisionWs);
        } else if (isGuidedQuestions) {
          // failed - clear generationJobId
          if (decision.guidedFlow) {
            decision.guidedFlow.round1.generationJobId = undefined;
            await updateDecision(namespaceId, orgId, updatedJob.decisionId, { guidedFlow: decision.guidedFlow }, decisionWs);
          }
        } else if (isGuidedOptions && isComplete && updatedJob.result) {
          // auto-apply tailored options to round2
          const parsed = updatedJob.result as { options?: TailoredOption[]; recommendation?: Recommendation };
          const guidedFlow = decision.guidedFlow as GuidedFlow;
          if (guidedFlow) {
            guidedFlow.currentRound = 2;
            guidedFlow.round2.status = "ready";
            guidedFlow.round2.tailoredOptions = parsed.options || [];
            guidedFlow.round2.generationJobId = undefined;
            await updateDecision(namespaceId, orgId, updatedJob.decisionId, {
              guidedFlow,
              options: (parsed.options || []).map((o) => ({
                id: o.id,
                letter: o.letter,
                name: o.name,
                description: o.description,
                pros: o.pros,
                cons: o.cons,
                effort: o.effort,
                risk: o.risk,
              })),
              recommendation: parsed.recommendation,
            }, decisionWs);
          }
        } else if (isGuidedOptions) {
          // failed - clear generationJobId
          if (decision.guidedFlow) {
            decision.guidedFlow.round2.generationJobId = undefined;
            decision.guidedFlow.round2.status = "pending";
            await updateDecision(namespaceId, orgId, updatedJob.decisionId, { guidedFlow: decision.guidedFlow }, decisionWs);
          }
        } else if (isGuidedPlan && isComplete && updatedJob.result) {
          // auto-apply execution plan to round3
          const parsed = updatedJob.result as unknown as ExecutionPlan;
          const guidedFlow = decision.guidedFlow as GuidedFlow;
          if (guidedFlow) {
            guidedFlow.currentRound = 3;
            guidedFlow.round3.status = "ready";
            guidedFlow.round3.plan = parsed;
            guidedFlow.round3.generationJobId = undefined;
            await updateDecision(namespaceId, orgId, updatedJob.decisionId, { guidedFlow }, decisionWs);
          }
        } else if (isGuidedPlan) {
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
