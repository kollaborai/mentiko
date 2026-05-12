import { NextRequest } from "next/server";
import { BadRequest, InternalServerError, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { getApiErrorMessage } from "@/lib/api-client";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { requirePermission } from "@/lib/rbac-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import { getNamespaceIdFromRequest, getNamespaceConfig, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getSchedule, incrementRunCount } from "@/lib/schedule-storage";
import { listWorkspaces } from "@/lib/workspace-storage";
import { normalizeScheduleTarget } from "@/lib/schedule-targets";
import { dispatchScheduleTarget, type ScheduleDispatchAdapters } from "@/lib/schedule-dispatcher";
import { mintSessionToken } from "@/lib/session-token";
import { getScheduledApplicationsFile, resolveScheduledApplicationRun } from "@/lib/scheduled-application-storage";

export const dynamic = "force-dynamic";

interface RunResult {
  success: boolean;
  runId?: string;
  error?: string;
  attempt: number;
}

async function executeChainRun(
  req: NextRequest,
  namespaceId: string,
  orgId: string,
  chain: unknown,
  chainId: string,
  goal: string,
  workspacePath: string,
  workspaceId?: string,
  taskId?: string,
): Promise<{ ok: boolean; data: Record<string, unknown>; status: number }> {
  const runUrl = `${req.nextUrl.origin}/api/chains/run`;

  const runRes = await fetch(runUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-namespace-id": namespaceId,
      "x-org-id": orgId,
      ...(req.headers.get("authorization") ? { authorization: req.headers.get("authorization")! } : {}),
      ...(req.headers.get("cookie") ? { cookie: req.headers.get("cookie")! } : {}),
    },
    body: JSON.stringify({
      chain,
      chainId,
      userPrompt: goal,
      workspacePath,
      ...(workspaceId ? { workspaceId } : {}),
      ...(taskId ? { taskId } : {}),
    }),
  });

  const data = await runRes.json();
  return { ok: runRes.ok, data, status: runRes.status };
}

// POST /api/schedules/run - trigger immediate run of a schedule (with retry)
export const POST = withErrorHandling(async (req: NextRequest) => {
  const perm = await requirePermission(req, "manage_chains");
  if (perm) return perm;

  const blockResult = await enforceGuestWrites(req);
  if (blockResult?.blocked) return blockResult.response;

  const namespaceId = await getNamespaceIdFromRequest(req);
  const orgId = await getOrgIdFromRequest(req);
  const body = await req.json();
  const { id, triggeredBy = "manual" } = body;

  if (!id) {
    throw new BadRequest("schedule id required", { field: "id" });
  }

  const schedule = await getSchedule(namespaceId, orgId, id);
  if (!schedule) {
    throw new NotFound("Schedule", id);
  }

  const target = normalizeScheduleTarget(schedule);

  if (target.type !== "chain_run") {
    const result = await dispatchScheduleTarget({
      target,
      payload: { triggeredAt: new Date().toISOString() },
      adapters: createManualRunAdapters(req, namespaceId, orgId),
    });

    if (!result.success) {
      throw new InternalServerError(result.error || "Schedule execution failed");
    }

    incrementRunCount(namespaceId, orgId, id).catch(() => {});

    return apiSuccess({
      success: true,
      scheduleId: schedule.id,
      targetType: result.kind,
      result,
    });
  }

  // resolve chain
  const namespaceConfig = await getNamespaceConfig(req);
  const chainPath = join(namespaceConfig.chainsDir, target.chainId, "chain.json");
  if (!existsSync(chainPath)) {
    throw new NotFound("Chain", target.chainId);
  }

  let chain;
  try {
    chain = JSON.parse(readFileSync(chainPath, "utf-8"));
  } catch {
    throw new InternalServerError("Failed to read chain");
  }

  // resolve workspace
  const workspaces = listWorkspaces(namespaceId, orgId);
  const workspace = workspaces.find((w) => w.id === schedule.workspaceId);
  if (!workspace) {
    throw new NotFound("Workspace", schedule.workspaceId || "");
  }

  const taskId = schedule.taskBinding?.taskId;
  const maxAttempts = Math.max(1, (schedule.retryCount || 0) + 1); // retryCount=0 means 1 attempt
  const results: RunResult[] = [];

  // record execution start via history API
  let executionId: string | undefined;
  try {
    const historyRes = await fetch(`${req.nextUrl.origin}/api/schedules/history`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(req.headers.get("cookie") ? { cookie: req.headers.get("cookie")! } : {}),
      },
      body: JSON.stringify({
        chainId: target.chainId,
        chainName: schedule.chainName || target.chainId,
        workspaceId: schedule.workspaceId,
        taskBinding: schedule.taskBinding,
        triggeredBy,
      }),
    });
    const historyData = await historyRes.json();
    executionId = historyData.data?.execution?.id || historyData.execution?.id;
  } catch {
    // non-fatal: history recording is best-effort
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { ok, data, status } = await executeChainRun(
        req, namespaceId, orgId, chain,
        target.chainId, target.goal || schedule.goal || "",
        workspace.path, schedule.workspaceId, taskId,
      );

      if (ok) {
        const inner = data.data as Record<string, unknown> | undefined;
        const runId = (inner?.runId || data.runId) as string;
        results.push({ success: true, runId, attempt });

        // increment run count + update history in background
        incrementRunCount(namespaceId, orgId, id).catch(() => {});
        if (executionId) {
          updateExecutionHistory(req, target.chainId, executionId, "completed").catch(() => {});
        }

        return apiSuccess({
          success: true,
          runId,
          scheduleId: schedule.id,
          chainId: target.chainId,
          workspaceId: schedule.workspaceId,
          taskBinding: schedule.taskBinding,
          attempt,
          totalAttempts: attempt,
        });
      }

      // run API returned error - record and maybe retry
      const error = getApiErrorMessage(data, "Failed to start chain");
      results.push({ success: false, error, attempt });

      // don't retry on 4xx (client errors) - only on 5xx (server errors)
      if (status < 500) {
        if (executionId) {
          updateExecutionHistory(req, target.chainId, executionId, "failed", error).catch(() => {});
        }
        // propagate 4xx errors as-is
        throw new BadRequest(error, { attempts: results });
      }

      // wait before retry (exponential backoff: 2s, 4s, 8s)
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt - 1)));
      }
    } catch (err) {
      if (err instanceof BadRequest) {
        // re-throw BadRequest (4xx errors)
        throw err;
      }
      const msg = err instanceof Error ? err.message : "Failed to trigger run";
      results.push({ success: false, error: msg, attempt });

      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt - 1)));
      }
    }
  }

  // all attempts failed
  const lastError = results[results.length - 1]?.error || "All retry attempts failed";
  if (executionId) {
    updateExecutionHistory(
      req, target.chainId, executionId, "failed",
      `${lastError} (after ${maxAttempts} attempt${maxAttempts > 1 ? "s" : ""})`
    ).catch(() => {});
  }

  throw new InternalServerError(lastError, { attempts: results, retryExhausted: maxAttempts > 1 });
});

function createManualRunAdapters(req: NextRequest, namespaceId: string, orgId: string): ScheduleDispatchAdapters {
  return {
    generateTasks: async ({ prompt, workspacePath, autoRun }) => {
      try {
        const token = await mintSessionToken({
          sub: "scheduler",
          jti: `manual-schedule-${Date.now()}`,
          ns: namespaceId,
          org: orgId,
          scopes: ["tasks:generate"],
        });
        const res = await fetch(`${req.nextUrl.origin}/api/mentiko-mcp/ops/tasks/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ description: prompt, workspacePath, autoRun }),
          signal: AbortSignal.timeout(130_000),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          return {
            success: false,
            error: typeof data?.error === "string" ? data.error : `generate_tasks failed with HTTP ${res.status}`,
          };
        }
        return { success: true, parentId: data.parentId };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    runTask: async ({ taskId, workspaceId, workspacePath }) => {
      try {
        const secret = process.env.BETTER_AUTH_SECRET;
        if (!secret) return { success: false, error: "BETTER_AUTH_SECRET is required to run scheduled tasks" };
        const res = await fetch(`${req.nextUrl.origin}/api/tasks/${encodeURIComponent(taskId)}/run-chain`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${secret}`,
            "x-namespace-id": namespaceId,
            "x-org-id": orgId,
          },
          body: JSON.stringify({
            ...(workspaceId ? { workspaceId } : {}),
            ...(workspacePath ? { workspacePath } : {}),
          }),
          signal: AbortSignal.timeout(30_000),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const error = data?.error?.message || data?.error || `run_task failed with HTTP ${res.status}`;
          return { success: false, error };
        }
        return { success: true, runId: data?.data?.runId || data?.runId };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    runRegisteredApp: async ({ appId, args }) => {
      try {
        const file = getScheduledApplicationsFile(namespaceId, orgId);
        const request = resolveScheduledApplicationRun(file, appId, args);
        const result = await dispatchScheduleTarget({
          target: { type: "raw_exec", ...request },
          payload: { triggeredAt: new Date().toISOString() },
        });
        return {
          success: result.success,
          error: result.error,
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

async function updateExecutionHistory(
  req: NextRequest,
  chainId: string,
  executionId: string,
  status: string,
  error?: string,
) {
  await fetch(`${req.nextUrl.origin}/api/schedules/history`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(req.headers.get("cookie") ? { cookie: req.headers.get("cookie")! } : {}),
    },
    body: JSON.stringify({ chainId, executionId, status, error }),
  });
}
