import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getJob, deleteJob } from "@/lib/job-store";
import { taskGet, taskUpdate } from "@/lib/task-store";
import { getOrgIdFromRequest, getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { Unauthorized, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const runtime = "nodejs";

export const GET = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { id } = await params;
  const namespaceId = await getNamespaceIdFromRequest(request);
  const job = getJob(id, namespaceId);

  if (!job) {
    throw new NotFound("Job", id);
  }

  return apiSuccess(job);
});

export const DELETE = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { id } = await params;
  const orgId = await getOrgIdFromRequest(request);
  const namespaceId = await getNamespaceIdFromRequest(request);

  // get job first to find associated task/decision
  const job = getJob(id, namespaceId);
  if (!job) {
    throw new NotFound("Job", id);
  }

  // clear task metadata if this was a task job
  if (job.taskId) {
    try {
      const task = taskGet(orgId, job.taskId, namespaceId);
      if (task) {
        const existing = typeof task?.metadata === "string"
          ? JSON.parse(task.metadata as string)
          : (task?.metadata as Record<string, unknown>) || {};

        // determine which metadata key to clear
        let metadataKey = "";
        if (job.type === "recommend" || job.type === "decision_research" || job.type === "decision_steering") {
          metadataKey = "analysis_job_id";
        } else if (job.type === "generate") {
          metadataKey = "generation_job_id";
        }

        if (metadataKey && existing[metadataKey] === id) {
          taskUpdate(orgId, job.taskId, {
            metadata: {
              ...existing,
              [metadataKey]: undefined,
              [`${metadataKey.replace("_id", "")}_status`]: undefined,
            },
          }, namespaceId);
        }
      }
    } catch (e) {
      // log but don't fail - job deletion is primary goal
      console.error("Failed to clear task metadata:", e);
    }
  }

  // clear decision metadata if this was a decision job
  if (job.decisionId) {
    try {
      const { getDecision, updateDecision } = await import("@/lib/decision-storage");
      const jobWorkspacePath =
        typeof job.input?.workspacePath === "string"
          ? job.input.workspacePath
          : typeof job.input?.workspaceId === "string"
            ? job.input.workspaceId
            : typeof job.input?.workspaceCwd === "string"
              ? job.input.workspaceCwd
              : undefined;
      const decision =
        getDecision(namespaceId, orgId, job.decisionId, jobWorkspacePath) ??
        getDecision(namespaceId, orgId, job.decisionId);
      const decisionWs = decision?.workspacePath ?? jobWorkspacePath;
      if (decision) {
        const isResearch = job.type === "decision_research" || job.type === "decision_steering";
        const isRetro = job.type === "decision_retrospective";

        if (isResearch && decision.activeJobId === id) {
          await updateDecision(namespaceId, orgId, job.decisionId, {
            status: "pending",
            activeJobId: undefined,
          }, decisionWs);
        } else if (isRetro && decision.retroJobId === id) {
          await updateDecision(namespaceId, orgId, job.decisionId, {
            retroJobId: undefined,
          }, decisionWs);
        }
      }
    } catch (e) {
      console.error("Failed to clear decision metadata:", e);
    }
  }

  // delete the job file
  const deleted = deleteJob(id, namespaceId);

  return apiSuccess({
    success: deleted,
    message: deleted ? "Job deleted" : "Job not found"
  });
});
