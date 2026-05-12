import { NextRequest } from "next/server";
import { BadRequest, NotFound, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { readFileSync, mkdirSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { checkAuth } from "@/lib/api-auth";
import { requirePermission } from "@/lib/rbac-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import { orgPath } from "@/lib/config";
import { generateExecutionId, parseExecutionHistory } from "@/lib/schedule-utils";

export const dynamic = "force-dynamic";

const SAFE_HISTORY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function normalizeHistoryId(value: unknown): string {
  if (typeof value !== "string" || !SAFE_HISTORY_ID_RE.test(value)) {
    throw new BadRequest("Invalid chainId", { field: "chainId" });
  }
  return value;
}

async function getRequestSchedulesDir(req: Request): Promise<string> {
  const namespaceId = await getNamespaceIdFromRequest(req);
  const orgId = await getOrgIdFromRequest(req);
  return orgPath(namespaceId, orgId, "schedules");
}

async function requireHistoryMutation(req: NextRequest) {
  const perm = await requirePermission(req, "manage_chains");
  if (perm) return perm;

  const blockResult = await enforceGuestWrites(req);
  if (blockResult?.blocked) return blockResult.response;

  return null;
}

async function ensureHistoryDir(schedulesDir: string) {
  if (!existsSync(schedulesDir)) {
    mkdirSync(schedulesDir, { recursive: true });
  }
  const historyDir = join(schedulesDir, "history");
  if (!existsSync(historyDir)) {
    mkdirSync(historyDir, { recursive: true });
  }
}

// GET /api/schedules/history?chainId={id} - get execution history
export const GET = withErrorHandling(async (req: Request) => {
  if (!(await checkAuth(req))) {
    throw new Unauthorized();
  }

  const { searchParams } = new URL(req.url);
  const chainId = normalizeHistoryId(searchParams.get("chainId"));
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  const schedulesDir = await getRequestSchedulesDir(req);
  await ensureHistoryDir(schedulesDir);

  const historyFile = join(schedulesDir, "history", chainId + ".json");

  if (!existsSync(historyFile)) {
    return apiSuccess({ history: [] });
  }

  const content = readFileSync(historyFile, "utf-8");
  const history = parseExecutionHistory(JSON.parse(content));

  // sort by startedAt descending and limit
  const sorted = history
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, limit);

  return apiSuccess({ history: sorted });
});

// POST /api/schedules/history - record execution start
export const POST = withErrorHandling(async (req: NextRequest) => {
  const authError = await requireHistoryMutation(req);
  if (authError) return authError;

  const body = await req.json();
  const { chainName, triggeredBy = "manual", workspaceId, taskBinding, retryAttempt } = body;
  const chainId = normalizeHistoryId(body.chainId);

  const schedulesDir = await getRequestSchedulesDir(req);
  await ensureHistoryDir(schedulesDir);

  const historyFile = join(schedulesDir, "history", chainId + ".json");

  const execution: Record<string, unknown> = {
    id: generateExecutionId(),
    scheduleId: chainId,
    chainId,
    chainName: chainName || chainId,
    startedAt: new Date().toISOString(),
    status: "running" as const,
    triggeredBy,
  };

  if (workspaceId) execution.workspaceId = workspaceId;
  if (taskBinding) execution.taskBinding = taskBinding;
  if (typeof retryAttempt === "number") execution.retryAttempt = retryAttempt;

  let history: unknown[] = [];
  if (existsSync(historyFile)) {
    const content = readFileSync(historyFile, "utf-8");
    history = JSON.parse(content);
  }

  history.unshift(execution);

  // keep only last 100 entries
  if (history.length > 100) {
    history = history.slice(0, 100);
  }

  writeFileSync(historyFile, JSON.stringify(history, null, 2));

  return apiSuccess({ success: true, execution });
});

// PATCH /api/schedules/history - update execution status
export const PATCH = withErrorHandling(async (req: NextRequest) => {
  const authError = await requireHistoryMutation(req);
  if (authError) return authError;

  const body = await req.json();
  const { executionId, status, error, output } = body;
  const chainId = normalizeHistoryId(body.chainId);

  if (!executionId || !status) {
    throw new BadRequest("chainId, executionId, and status required");
  }

  const schedulesDir = await getRequestSchedulesDir(req);
  const historyFile = join(schedulesDir, "history", chainId + ".json");

  if (!existsSync(historyFile)) {
    throw new NotFound("Execution", executionId);
  }

  const content = readFileSync(historyFile, "utf-8");
  const history = JSON.parse(content);

  const execution = history.find((e: unknown) => (e as { id?: string }).id === executionId);
  if (!execution) {
    throw new NotFound("Execution", executionId);
  }

  execution.status = status;
  execution.completedAt = new Date().toISOString();
  execution.duration = new Date(execution.completedAt).getTime() - new Date(execution.startedAt).getTime();

  if (error) execution.error = error;
  if (output) execution.output = output;

  writeFileSync(historyFile, JSON.stringify(history, null, 2));

  return apiSuccess({ success: true, execution });
});
