import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { createJob, deleteJob } from "@/lib/job-store";
import { getSessionUser } from "@/lib/auth-bridge";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getChainSchema } from "@/lib/schema-loader";
import { getTemplate } from "@/lib/generation-template-storage";
import { resolveTemplate } from "@/lib/template-resolver";
import { taskUpdate, taskGet } from "@/lib/task-store";
import { buildAgentCatalog } from "@/lib/agent-catalog";
import { buildProfileCatalog } from "@/lib/profile-catalog";
import { BadRequest, NotFound, Unauthorized, InternalServerError } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { launchJobRunner } from "@/lib/job-runner-launch";
import { resolveAuthorizedWorkspacePath } from "@/lib/workspace-auth";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { prompt, taskId, workspacePath: directWorkspacePath } = await request.json();
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const session = await getSessionUser(request);
  const userId = session?.id;

  if (!prompt || typeof prompt !== "string") {
    throw new BadRequest("prompt is required", { field: "prompt" });
  }

  const currentTask = taskId ? taskGet(orgId, taskId, namespaceId) : null;
  let existingMetadata: Record<string, unknown> = {};
  if (currentTask?.metadata) {
    try {
      existingMetadata = typeof currentTask.metadata === "string"
        ? JSON.parse(currentTask.metadata)
        : currentTask.metadata;
    } catch {
      existingMetadata = {};
    }
  }
  const requestedWorkspacePath = directWorkspacePath
    || (typeof existingMetadata.workspace_path === "string"
      ? existingMetadata.workspace_path
      : typeof existingMetadata.workspace_id === "string"
        ? existingMetadata.workspace_id
        : undefined);
  const workspacePath = resolveAuthorizedWorkspacePath(namespaceId, orgId, requestedWorkspacePath, userId);

  const workspaceContext = workspacePath
    ? `\nWORKSPACE CONTEXT: The chain will execute in "${workspacePath}". Tailor agent roles and tasks to this specific codebase.\n`
    : "";
  const schema = getChainSchema();
  const template = getTemplate(namespaceId, orgId, "chain_generation");
  const generationPrompt = resolveTemplate(template.content, {
    USER_PROMPT: prompt,
    SCHEMA: schema,
    AGENT_CATALOG: buildAgentCatalog(namespaceId, orgId),
    PROFILE_CATALOG: buildProfileCatalog(namespaceId, orgId),
    WORKSPACE_CONTEXT: workspaceContext,
  });

  // ================================================================
  // ATOMIC OPERATION BOUNDARY
  // ================================================================
  // The following two operations MUST succeed together or fail together:
  // 1. Job creation (job file in jobs directory)
  // 2. Task metadata update (generationJobId tracking)
  //
  // If the task update fails, we MUST roll back job creation to prevent
  // orphaned jobs that exist but have no task reference.
  // ================================================================

  // step 1: create job (writes to jobs directory atomically)
  const job = createJob("generate", { prompt: generationPrompt, namespaceId, orgId, workspacePath }, taskId, undefined, userId, namespaceId);

  // step 2: atomically persist generationJobId to task metadata
  // this is the critical atomic operation - both job and task update must succeed
  if (taskId) {
    try {
      // read current task to get existing chainBinding data (preserve analysis_job_id, last_run_id, etc)
      if (!currentTask) {
        // task doesn't exist - rollback job creation
        const deleted = deleteJob(job.id, namespaceId);
        if (!deleted) {
          console.error(`CRITICAL: Failed to rollback job ${job.id} after task not found - orphaned job may exist`);
        }
        throw new NotFound("Task", taskId);
      }

      // parse existing metadata to extract current chain-binding-like fields
      // fields: chain_id, analysis_job_id, last_run_id, last_run_status, etc
      // merge existing chainBinding with new generationJobId
      // this preserves analysis_job_id, last_run_id, chain_id, etc
      const updatedMetadata = {
        ...existingMetadata,
        generation_job_id: job.id,
        generation_status: "running" as const,
      };

      // update task with merged metadata (taskUpdate is atomic)
      taskUpdate(orgId, taskId, { metadata: updatedMetadata }, namespaceId);

      // verification: re-read task to confirm generationJobId was persisted
      const verificationTask = taskGet(orgId, taskId, namespaceId);
      if (!verificationTask) {
        throw new InternalServerError("Task disappeared after update");
      }

      const verificationMetadata = verificationTask.metadata ?
        (typeof verificationTask.metadata === "string" ? JSON.parse(verificationTask.metadata) : verificationTask.metadata)
        : {};

      if (verificationMetadata.generation_job_id !== job.id) {
        // task update didn't persist - rollback job creation
        throw new InternalServerError(`generationJobId not persisted to task ${taskId}`);
      }

    } catch (e) {
      // ATOMIC ROLLBACK: if task update fails, delete the job we just created
      // this ensures job never exists without task having the generationJobId reference
      const deleted = deleteJob(job.id, namespaceId);
      if (!deleted) {
        console.error(`CRITICAL: Failed to rollback job ${job.id} after task update failure - orphaned job may exist`);
      }

      const errorMsg = e instanceof Error ? e.message : "Failed to update task with generationJobId";
      console.error("Atomic persistence failed - rolled back job creation:", errorMsg, { taskId, jobId: job.id });

      if (e instanceof NotFound || e instanceof InternalServerError) {
        throw e;
      }
      throw new InternalServerError("Failed to persist generation job ID to task", { details: errorMsg });
    }
  }

  // ================================================================
  // END ATOMIC OPERATION BOUNDARY
  // ================================================================
  // At this point, both job creation and task update have succeeded.
  // We can now safely spawn the job runner process.
  // ================================================================

  // step 3: only spawn job runner after both job creation and task update succeed
  launchJobRunner({ job, namespaceId, orgId, origin: request.nextUrl.origin });

  return apiSuccess({ jobId: job.id, status: job.status });
});
