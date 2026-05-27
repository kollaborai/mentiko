import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { createJob, listJobs, cleanupOldJobs, type JobType } from "@/lib/job-store";
import { getSessionUser } from "@/lib/auth-bridge";
import config from "@/lib/config";
import { join } from "node:path";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getTemplate } from "@/lib/generation-template-storage";
import { resolveTemplate } from "@/lib/template-resolver";
import { getChainSchema } from "@/lib/schema-loader";
import { taskGet, taskUpdate } from "@/lib/task-store";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveJobWorkspaceCwd } from "@/lib/job-runner-launch";
import { resolveAuthorizedWorkspacePath } from "@/lib/workspace-auth";
import { startGenerationChainRun } from "@/lib/generation-chain-dispatch";

export const dynamic = "force-dynamic";

function auditRunMetadataForJob(type: string, runId: string, chainId?: string): Record<string, string> {
  if (type === "recommend") {
    return {
      recommendation_run_id: runId,
      ...(chainId ? { recommendation_chain_id: chainId } : {}),
    };
  }

  return {
    generated_chain_run_id: runId,
    ...(chainId ? { generated_chain_source_chain_id: chainId } : {}),
  };
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

export const runtime = "nodejs";

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const body = await request.json();
  const { type, taskId, input } = body;

  if (!type || !input) {
    throw new BadRequest("type and input are required");
  }

  if (type !== "recommend" && type !== "generate") {
    throw new BadRequest('type must be "recommend" or "generate"');
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const session = await getSessionUser(request);
  const userId = session?.id;
  const requestedWorkspace =
    resolveJobWorkspaceCwd(input) ||
    new URL(request.url).searchParams.get("workspace") ||
    undefined;
  const authorizedWorkspacePath = resolveAuthorizedWorkspacePath(namespaceId, orgId, requestedWorkspace, userId);
  if (authorizedWorkspacePath) {
    input.workspacePath = authorizedWorkspacePath;
  } else {
    delete input.workspacePath;
    delete input.workspaceCwd;
    delete input.workspaceId;
    delete input.workspace;
  }
  const workspaceContext = authorizedWorkspacePath
    ? `\nWORKSPACE CONTEXT: This job belongs to the project in "${authorizedWorkspacePath}". Tailor the output to that specific codebase.\n`
    : "";

  // lazy cleanup: delete jobs older than 24h
  cleanupOldJobs(24 * 60 * 60 * 1000, namespaceId);

  // build chain catalog for recommend jobs so the LLM knows what's available
  if (type === "recommend" && !input.chainCatalog) {
    try {
      const chainsDir = config.chainsDir;
      if (existsSync(chainsDir)) {
        const entries = readdirSync(chainsDir, { withFileTypes: true });
        const summaries: string[] = [];
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const chainFile = join(chainsDir, entry.name, "chain.json");
          if (!existsSync(chainFile)) continue;
          try {
            const raw = readFileSync(chainFile, "utf-8");
            const chain = JSON.parse(raw);
            const agents = (chain.agents || [])
              .map((a: { name?: string; role?: string; $ref?: string }) => {
                const label = a.name || (a.$ref ? a.$ref : "unknown");
                return `    - ${label}${a.role ? ` (${a.role})` : ""}`;
              })
              .join("\n");
            summaries.push(
              `chain_id: ${entry.name}\n  name: ${chain.name || entry.name}\n  description: ${chain.description || "none"}\n  agents:\n${agents}`
            );
          } catch {
            // skip unparseable chain files
          }
        }
        input.chainCatalog = summaries.join("\n\n") || "No chains available.";
      }
    } catch {
      input.chainCatalog = "Failed to load chain catalog.";
    }
  }

  // resolve generation template into input.prompt so job-runner can use it
  if (type === "recommend") {
    const task = input.task as Record<string, unknown> | undefined;
    const taskContext = task ? [
      task.title ? `title: ${task.title}` : null,
      task.description ? `description: ${task.description}` : null,
      task.type ? `type: ${task.type}` : null,
      task.priority !== undefined ? `priority: ${task.priority} (0=critical, 4=backlog)` : null,
      task.rawPriority !== undefined ? `priority: ${task.rawPriority} (0=critical, 4=backlog)` : null,
      task.acceptance ? `acceptance criteria: ${task.acceptance}` : null,
      task.design ? `design notes: ${task.design}` : null,
      task.notes ? `notes: ${task.notes}` : null,
    ].filter(Boolean).join("\n") : "";

    // ensure chainCatalog exists (might not have been built above if chainsDir missing)
    if (!input.chainCatalog) {
      input.chainCatalog = "No chains available.";
    }

    const template = getTemplate(namespaceId, orgId, "chain_recommendation");
    const prompt = resolveTemplate(template.content, {
      TASK_CONTEXT: taskContext,
      CHAIN_CATALOG: String(input.chainCatalog),
      WORKSPACE_CONTEXT: workspaceContext,
    });

    input.prompt = prompt;
  }

  if (type === "generate" && !input.prompt) {
    // raw user prompt — wrap it in the chain_generation template
    const schema = getChainSchema();
    const template = getTemplate(namespaceId, orgId, "chain_generation");
    input.prompt = resolveTemplate(template.content, {
      USER_PROMPT: String(input.userPrompt || ""),
      SCHEMA: schema,
      AGENT_CATALOG: "",
      WORKSPACE_CONTEXT: workspaceContext,
    });
  } else if (type === "generate" && input.prompt) {
    // prompt already provided (e.g. generation_prompt from recommendation)
    // wrap it in the chain_generation template as USER_PROMPT
    const schema = getChainSchema();
    const template = getTemplate(namespaceId, orgId, "chain_generation");
    input.prompt = resolveTemplate(template.content, {
      USER_PROMPT: String(input.prompt),
      SCHEMA: schema,
      AGENT_CATALOG: "",
      WORKSPACE_CONTEXT: workspaceContext,
    });
  }

  // create job first
  const job = createJob(type as JobType, input, taskId, undefined, userId, namespaceId);

  // persist jobId to task metadata
  if (taskId) {
    try {
      const task = taskGet(orgId, taskId, namespaceId);
      if (task) {
        const existing = typeof task?.metadata === "string"
          ? JSON.parse(task.metadata as string)
          : (task?.metadata as Record<string, unknown>) || {};

        const metadataKey = type === "recommend" ? "analysis_job_id" : "generation_job_id";
        const statusKey = type === "recommend" ? "analysis_status" : "generation_status";

        taskUpdate(orgId, taskId, {
          metadata: {
            ...existing,
            [metadataKey]: job.id,
            [statusKey]: "running",
          },
        }, namespaceId);
      } else {
        console.warn(`Task ${taskId} not found. Job will run but metadata won't persist.`);
      }
    } catch (e) {
      console.error("Failed to update task metadata:", e);
    }
  }

  const run = await startGenerationChainRun({
    request,
    namespaceId,
    orgId,
    kind: type === "recommend" ? "chain_recommendation" : "chain_generation",
    job,
    prompt: String(input.prompt || ""),
    workspacePath: authorizedWorkspacePath,
    taskId,
  });

  if (taskId) {
    try {
      const task = taskGet(orgId, taskId, namespaceId);
      if (task) {
        taskUpdate(orgId, taskId, {
          metadata: {
            ...metadataRecord(task.metadata),
            ...auditRunMetadataForJob(type, run.runId, run.chainId),
          },
        }, namespaceId);
      }
    } catch (e) {
      console.error("Failed to update task audit run metadata:", e);
    }
  }

  return apiSuccess({ jobId: job.id, runId: run.runId, chainId: run.chainId, status: job.status });
});

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const url = new URL(request.url);
  const taskId = url.searchParams.get("taskId") || undefined;
  const status = url.searchParams.get("status") as
    | "pending"
    | "running"
    | "complete"
    | "failed"
    | undefined;
  const since = url.searchParams.get("since") || undefined;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const jobs = listJobs({ taskId, status, since }, namespaceId);
  return apiSuccess({ jobs });
});
