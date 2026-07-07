import { NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import config from "@/lib/config";
import { requirePermission } from "@/lib/auth/api-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { taskGet, taskUpdate, taskGetComments, validateTaskId } from "@/lib/tasks/task-store";
import { createNotification } from "@/lib/notifications/notification-server";
import { apiError } from "@/lib/api-response";
import { NotFound, BadRequest, Conflict } from "@/lib/api-errors";
import { taskDetailHref } from "@/lib/tasks/task-routes";
import { internalApiUrl, forwardedHeaders } from "@/lib/auth/internal-web-origin";
import type { TaskChainBinding } from "@/lib/tasks/task-types";
import { executionStartedLifecycleMetadata } from "@/lib/orchestration/task-lifecycle-metadata";

export const dynamic = "force-dynamic";

// POST /api/tasks/[id]/run-chain - execute the assigned chain with task context (requires manage_tasks)
export const POST = requirePermission("manage_tasks")(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const blockResult = await enforceGuestWrites(request);
  if (blockResult?.blocked) return blockResult.response;

  try {
    const { id } = await context.params;
    const safeId = validateTaskId(decodeURIComponent(id));
    const orgId = await getOrgIdFromRequest(request);
    const namespaceId = await getNamespaceIdFromRequest(request);

    // parse optional body (workspacePath, workspaceId)
    let workspacePath: string | undefined;
    let workspaceId: string | undefined;
    try {
      const body = await request.json();
      workspacePath = body.workspacePath;
      workspaceId = body.workspaceId;
    } catch {
      // no body is fine
    }

    // 1. fetch the task
    const issue = taskGet(orgId, safeId, namespaceId);
    if (!issue) {
      return apiError(new NotFound("Task", safeId));
    }

    // 2. extract chain binding from metadata
    const metadata = typeof issue.metadata === "object" ? issue.metadata as Record<string, unknown> : undefined;

    if (!metadata?.chain_id) {
      return apiError(new BadRequest("No chain assigned to this task"));
    }

    // tied-run semantics: default to the task's own workspace when the caller
    // doesn't override. Only the task UI sends workspace in the body — MCP and
    // scheduler callers send none, and a run without a workspace loses its
    // project root end-to-end (agents write to the org root, completion
    // relaunches without --workspace and derives invalid session names).
    if (!workspacePath && !workspaceId) {
      const metaWorkspacePath =
        typeof metadata.workspace_path === "string" && metadata.workspace_path
          ? metadata.workspace_path
          : undefined;
      const taskWorkspaceId =
        typeof issue.workspace_id === "string" && issue.workspace_id
          ? issue.workspace_id
          : undefined;
      workspacePath = metaWorkspacePath || taskWorkspaceId;
    }

    // 2a. double-submit guard
    if (metadata.last_run_status === "running" && metadata.last_run_id) {
      const lastRunId = metadata.last_run_id as string;
      const runJsonPath = join(config.runsDir, lastRunId, "run.json");
      try {
        if (existsSync(runJsonPath)) {
          const runData = JSON.parse(readFileSync(runJsonPath, "utf-8"));
          if (runData.status === "running") {
            return apiError(new Conflict("Chain already running for this task", { runId: lastRunId }));
          }
        }
      } catch {
        // if run.json doesn't exist or is unreadable, allow proceeding
      }
    }

    const binding: TaskChainBinding = {
      chain_id: metadata.chain_id as string,
      chain_name: (metadata.chain_name as string) || undefined,
      auto_run: (metadata.auto_run as boolean) ?? false,
      run_config: metadata.run_config as
        | TaskChainBinding["run_config"]
        | undefined,
    };

    // 3. build task context for injection into agent prompts
    const taskContext = [
      `TASK ID: ${issue.id}`,
      `TITLE: ${issue.title}`,
      `TYPE: ${issue.issue_type}`,
      `PRIORITY: P${issue.priority}`,
      "",
      "DESCRIPTION:",
      issue.description || "(none)",
    ];
    if (issue.acceptance_criteria) {
      taskContext.push("", "ACCEPTANCE CRITERIA:", issue.acceptance_criteria);
    }
    if (issue.design) {
      taskContext.push("", "DESIGN NOTES:", issue.design);
    }
    if (issue.notes) {
      taskContext.push("", "NOTES:", issue.notes);
    }

    // fetch and append comments
    try {
      const comments = taskGetComments(orgId, safeId, namespaceId);
      if (comments.length > 0) {
        taskContext.push("", "COMMENTS:");
        for (const c of comments) {
          const date = new Date(c.created_at).toISOString().slice(0, 10);
          taskContext.push(`[${date}] ${c.author}: ${c.text}`);
        }
      }
    } catch {
      // non-fatal: comments unavailable
    }

    const taskContextStr = taskContext.join("\n");

    // 4. load the chain definition
    const chainUrl = internalApiUrl(`/api/chains/${encodeURIComponent(binding.chain_id)}`, request.url);
    const chainRes = await fetch(chainUrl, {
      headers: forwardedHeaders(request, namespaceId, orgId),
    });
    if (!chainRes.ok) {
      return apiError(new NotFound("Chain", binding.chain_id));
    }
    const chainData = await chainRes.json();
    // unwrap apiSuccess envelope: { success, data: { chain } }
    const chainDef = chainData.data?.chain || chainData.chain || chainData;

    // 5. pre-generate runId and update task status + metadata FIRST
    const runId = `run-${Date.now()}`;
    const updatedMeta = {
      ...executionStartedLifecycleMetadata({
        taskId: safeId,
        metadata,
        runId,
        chainId: binding.chain_id,
      }),
      auto_run_retries: 0,
    };
    taskUpdate(orgId, safeId, { status: "in_progress", metadata: updatedMeta }, namespaceId);

    // 6. delegate to existing chain run API with pre-generated runId
    const runUrl = internalApiUrl("/api/chains/run", request.url);
    const runRes = await fetch(runUrl, {
      method: "POST",
      headers: forwardedHeaders(request, namespaceId, orgId, {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        chain: chainDef,
        chainId: binding.chain_id,
        userPrompt: taskContextStr,
        debug: binding.run_config?.debug ?? false,
        taskId: safeId,
        runId,
        ...(workspacePath ? { workspacePath } : {}),
        ...(workspaceId ? { workspaceId } : {}),
      }),
    });

    const runData = await runRes.json();

    // 7. if chain start failed, update metadata and create notification
    if (!runRes.ok) {
      const rawError = runData.error;
      const errorMsg = typeof rawError === "string" ? rawError : rawError?.message || "Unknown error";
      const errorMeta = {
        ...metadata,
        last_run_id: runId,
        last_run_status: "failed",
        last_run_error: errorMsg,
      };
      taskUpdate(orgId, safeId, { metadata: errorMeta }, namespaceId);

      createNotification(namespaceId, {
        type: "chain_failed",
        title: `Chain failed to start: ${binding.chain_name || binding.chain_id}`,
        message: errorMsg,
        metadata: {
          chainId: binding.chain_id,
          runId,
          error: errorMsg,
          actionUrl: taskDetailHref(safeId),
          actionLabel: "View Task",
        },
      });

      // Return the error response from the chain run API
      return NextResponse.json(runData, { status: runRes.status });
    }

    // Successful chain start - return the run data
    // Note: runData may be in the old format { success: true, data: { ... } } or the new format
    // We'll pass it through as-is to maintain compatibility with the chain run API
    return NextResponse.json(runData, { status: runRes.status });
  } catch (error: unknown) {
    // create notification for unexpected errors too
    try {
      const nsId = await getNamespaceIdFromRequest(request);
      createNotification(nsId, {
        type: "error",
        title: "Chain run error",
        message: (error as Error).message,
        metadata: { error: (error as Error).message },
      });
    } catch {
      // notification creation itself failed - nothing we can do
    }
    return apiError(error);
  }
});
