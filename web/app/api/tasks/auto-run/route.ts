/**
 * GET  /api/tasks/auto-run  — check & trigger auto-run for ready tasks
 * POST /api/tasks/auto-run  — force-trigger auto-run for a specific task
 */

import { NextRequest } from "next/server";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { checkAuth } from "@/lib/api-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import {
  getNamespaceIdFromRequest,
  getOrgIdFromRequest,
  getNamespaceConfig,
} from "@/lib/namespace-config";
import { readSystemSettings } from "@/lib/system-settings";
import {
  getAutoRunCandidates,
  isTaskReady,
  reconcileActiveAutoRunTasks,
  reconcileTaskActiveRun,
} from "@/lib/auto-run";
import { taskGet, taskUpdate } from "@/lib/task-store";
import { getWorkspace, resolveAutoRun } from "@/lib/workspace-storage";
import { getJob } from "@/lib/job-store";
import { getAllChains, buildChainSummary } from "@/lib/chain-utils";
import { getTemplate } from "@/lib/generation-template-storage";
import { resolveTemplate } from "@/lib/template-resolver";
import config, { nsPath } from "@/lib/config";
import { Unauthorized, Forbidden, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveAuthorizedWorkspacePath } from "@/lib/workspace-auth";

export const dynamic = "force-dynamic";

export const runtime = "nodejs";

const RESUMABLE_RUN_STATUSES = new Set(["stopped", "failed", "cancelled"]);

/** GET — dry-run scan, returns all ready candidates without triggering anything */
export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const settings = readSystemSettings();
  if (!settings.auto_run_enabled) {
    return apiSuccess({
      auto_run_enabled: false,
      candidates: [],
      message: "Auto-run is disabled in system settings",
    });
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const candidates = getAutoRunCandidates(orgId, undefined, namespaceId);
  const activeRuns = countActiveRuns(namespaceId);
  return apiSuccess({
    auto_run_enabled: true,
    max_concurrent_runs: settings.max_concurrent_runs,
    active_runs: activeRuns,
    available_slots: Math.max(0, settings.max_concurrent_runs - activeRuns),
    settings_url: "/settings/system",
    candidates: candidates.map((c) => ({
      taskId: c.taskId,
      title: c.title,
      chainId: c.chainId,
      chainName: c.chainName,
    })),
  });
});

/** POST — trigger auto-run check + execution for ready tasks */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const blockResult = await enforceGuestWrites(request);
  if (blockResult?.blocked) return blockResult.response;

  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const body = await request.json().catch(() => ({}));
  const taskId: string | undefined = body.taskId;

  const settings = readSystemSettings(namespaceId);
  if (!settings.auto_run_enabled) {
    throw new Forbidden("Auto-run is disabled in system settings");
  }

  const orgId = await getOrgIdFromRequest(request);
  const reconciledActiveRuns = reconcileActiveAutoRunTasks(orgId, namespaceId);

  // if taskId given, check/trigger just that task
  if (taskId) {
    // First fetch task to get workspace_path from metadata
    const task = taskGet(orgId, taskId, namespaceId);
    if (!task) {
      throw new NotFound("Task", taskId);
    }

    const metadata = parseTaskMetadata(task);
    const workspacePath = resolveTaskWorkspacePath(namespaceId, orgId, task, metadata);
    const activeRun = reconcileTaskActiveRun(orgId, task, namespaceId);
    if (activeRun.activeRun) {
      return apiSuccess({
        triggered: false,
        taskId,
        runId: activeRun.activeRun.id,
        action: "active_run_exists",
        reconciled: activeRun.reconciled,
      });
    }

    // Check readiness using task's workspace
    const readyCheck = isTaskReady(orgId, taskId, namespaceId);
    if (!readyCheck.ready) {
      return apiSuccess({
        triggered: false,
        taskId,
        reason: `${readyCheck.blockingDeps.length} unresolved dependencies`,
        blockingDeps: readyCheck.blockingDeps,
      });
    }

    const result = await triggerAutoRun(taskId, namespaceId, request, workspacePath, task, metadata);
    return apiSuccess(result);
  }

  // otherwise scan all candidates
  const candidates = getAutoRunCandidates(orgId, undefined, namespaceId);
  if (candidates.length === 0) {
    return apiSuccess({ triggered: 0, results: [], reconciled: reconciledActiveRuns });
  }

  // respect max_concurrent_runs -- only trigger up to available slots
  const activeCount = countActiveRuns(namespaceId);
  const maxConcurrent = settings.max_concurrent_runs;
  const availableSlots = Math.max(0, maxConcurrent - activeCount);

  if (availableSlots === 0) {
    return apiSuccess({
      triggered: 0,
      skipped: candidates.length,
      reconciled: reconciledActiveRuns,
      reason: `concurrent limit reached (${activeCount}/${maxConcurrent} active). Change at /settings/system.`,
      results: candidates.map((c) => ({
        triggered: false,
        taskId: c.taskId,
        reason: "concurrent_limit",
      })),
    });
  }

  // only trigger as many as we have slots for (priority order from getAutoRunCandidates)
  const toTrigger = candidates.slice(0, availableSlots);
  const deferred = candidates.slice(availableSlots);

  const results = await Promise.allSettled(
    toTrigger.map(async (c) => {
      const task = taskGet(orgId, c.taskId, namespaceId);
      if (!task) {
        return { triggered: false, taskId: c.taskId, error: "Task not found" };
      }
      const metadata = parseTaskMetadata(task);
      const workspacePath = resolveTaskWorkspacePath(namespaceId, orgId, task, metadata);

      return triggerAutoRun(c.taskId, namespaceId, request, workspacePath, task, metadata);
    })
  );

  const triggered = results.filter(
    (r) => r.status === "fulfilled" && r.value.triggered
  ).length;

  return apiSuccess({
    triggered,
    activeRuns: activeCount,
    maxConcurrent,
    reconciled: reconciledActiveRuns,
    deferred: deferred.length,
    results: [
      ...results.map((r, i) =>
        r.status === "fulfilled"
          ? r.value
          : {
              triggered: false,
              taskId: toTrigger[i].taskId,
              error: String(r.reason),
            }
      ),
      ...deferred.map((c) => ({
        triggered: false,
        taskId: c.taskId,
        reason: "deferred_concurrent_limit",
      })),
    ],
  });
});

interface TriggerResult {
  triggered: boolean;
  taskId: string;
  runId?: string;
  jobId?: string;
  action?: string;
  reason?: string;
  error?: string;
}

function readResumableRunId(
  taskId: string,
  chainId: string,
  namespaceId: string,
  metadata: Record<string, unknown>
): string | null {
  const runId = typeof metadata.last_run_id === "string" ? metadata.last_run_id : undefined;
  const lastRunStatus = typeof metadata.last_run_status === "string" ? metadata.last_run_status : undefined;
  if (!runId || !lastRunStatus || !RESUMABLE_RUN_STATUSES.has(lastRunStatus)) return null;

  const runJsonPath = join(nsPath(namespaceId, "runs"), runId, "run.json");
  if (!existsSync(runJsonPath)) return null;

  try {
    const run = JSON.parse(readFileSync(runJsonPath, "utf-8")) as {
      taskId?: string;
      chainId?: string;
      status?: string;
      agents?: Array<{ status?: string }>;
    };
    if (run.taskId !== taskId) return null;
    if (run.chainId && run.chainId !== chainId) return null;
    if (run.status === "running" || run.status === "pending") return null;
    if (!run.status || !RESUMABLE_RUN_STATUSES.has(run.status)) return null;
    const agents = run.agents || [];
    if (agents.length > 0 && agents.every((agent) => agent.status === "complete")) {
      return null;
    }
    return runId;
  } catch {
    return null;
  }
}

async function resumeExistingRun(
  taskId: string,
  runId: string,
  namespaceId: string,
  orgId: string,
  request: NextRequest,
  metadata: Record<string, unknown>
): Promise<TriggerResult> {
  const origin = new URL(request.url).origin;
  const resumeRes = await fetch(`${origin}/api/runs/${encodeURIComponent(runId)}/resume`, {
    method: "POST",
    headers: forwardedHeaders(request, namespaceId, orgId),
  });

  const resumeData = await resumeRes.json().catch(() => ({}));
  if (!resumeRes.ok) {
    const message =
      (resumeData as { error?: { message?: string } }).error?.message ||
      (resumeData as { error?: string }).error ||
      `Failed to resume run ${runId}`;
    return {
      triggered: false,
      taskId,
      runId,
      action: "resume_failed",
      error: message,
    };
  }

  try {
    const currentTask = taskGet(orgId, taskId, namespaceId);
    const existingMeta = currentTask?.metadata && typeof currentTask.metadata === "object"
      ? currentTask.metadata as Record<string, unknown>
      : metadata;
    taskUpdate(orgId, taskId, {
      status: "in_progress",
      metadata: {
        ...existingMeta,
        last_run_id: runId,
        last_run_status: "running",
        last_run_error: undefined,
        last_run_completed: null,
      },
    }, namespaceId);
  } catch {
    /* non-fatal */
  }

  return {
    triggered: true,
    taskId,
    runId,
    action: "chain_resume",
  };
}

function forwardedHeaders(
  request: NextRequest,
  namespaceId: string,
  orgId: string,
  extra?: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = {
    "x-namespace-id": namespaceId,
    "x-org-id": orgId,
    ...(extra || {}),
  };
  const cookie = request.headers.get("cookie");
  if (cookie) headers.cookie = cookie;
  const authorization = request.headers.get("authorization");
  if (authorization) headers.Authorization = authorization;
  return headers;
}

function slugifyChainName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "generated-chain";
}

function sanitizeGeneratedChain(chain: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = { ...chain };

  if (typeof sanitized.version === "string" && sanitized.version.trim()) {
    const parts = sanitized.version.split(".");
    while (parts.length < 3) parts.push("0");
    sanitized.version = parts.join(".");
  } else {
    sanitized.version = "1.0.0";
  }

  if (!sanitized.description) {
    sanitized.description = typeof sanitized.name === "string" ? sanitized.name : "Generated chain";
  }

  if (!sanitized.config || typeof sanitized.config !== "object" || Array.isArray(sanitized.config)) {
    sanitized.config = {};
  }

  if (Array.isArray(sanitized.agents)) {
    const agents = sanitized.agents as Array<Record<string, unknown>>;
    sanitized.agents = agents.map((agent, idx) => {
      if (!agent || typeof agent !== "object") return agent;
      const fixed: Record<string, unknown> = { ...agent };

      if (typeof fixed.retry === "number") {
        fixed.retry = { max_retries: fixed.retry };
      }

      if (!Array.isArray(fixed.triggers) || fixed.triggers.length === 0) {
        if (idx === 0) {
          fixed.triggers = ["chain_start"];
        } else {
          const prev = agents[idx - 1] || {};
          const prevEmit = typeof prev.emits === "string"
            ? prev.emits
            : `${String(prev.id || prev.name || `agent_${idx - 1}`).toLowerCase().replace(/[^a-z0-9]+/g, "_")}_complete`;
          fixed.triggers = [prevEmit];
        }
      }

      if (!fixed.emits || typeof fixed.emits !== "string") {
        const agentId = String(fixed.id || fixed.name || `agent_${idx}`).toLowerCase().replace(/[^a-z0-9]+/g, "_");
        fixed.emits = `${agentId}_complete`;
      }

      return fixed;
    });
  }

  return sanitized;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/^```(?:json)?\n?/m, "").replace(/\n?```\s*$/m, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }
}

function extractGeneratedChain(result: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!result) return null;
  const direct = result.chain && typeof result.chain === "object" && !Array.isArray(result.chain)
    ? result.chain as Record<string, unknown>
    : result;
  if (typeof direct.name === "string" && Array.isArray(direct.agents)) {
    return direct;
  }
  if (typeof result.output === "string") {
    const parsed = parseJsonObject(result.output);
    if (parsed && typeof parsed.name === "string" && Array.isArray(parsed.agents)) {
      return parsed;
    }
  }
  return null;
}

function parseTaskMetadata(
  task: ReturnType<typeof taskGet>
): Record<string, unknown> {
  return task?.metadata || {};
}

function resolveTaskWorkspacePath(
  namespaceId: string,
  orgId: string,
  task: NonNullable<ReturnType<typeof taskGet>>,
  metadata: Record<string, unknown>
): string | undefined {
  let workspacePath =
    typeof metadata.workspace_path === "string"
      ? metadata.workspace_path
      : typeof task.workspace_id === "string"
        ? task.workspace_id
        : undefined;

  const workspaceId = metadata.workspace_id as string | undefined;
  if (workspaceId) {
    const workspace = getWorkspace(namespaceId, orgId, workspaceId);
    if (workspace?.path) workspacePath = workspace.path;
  }

  return resolveAuthorizedWorkspacePath(namespaceId, orgId, workspacePath, undefined);
}

async function triggerAutoRun(
  taskId: string,
  namespaceId: string,
  request: NextRequest,
  workspacePath: string | undefined,
  task: NonNullable<ReturnType<typeof taskGet>>,
  metadata: Record<string, unknown>
): Promise<TriggerResult> {
  const chainId = metadata.chain_id as string | undefined;
  const orgId = await getOrgIdFromRequest(request);

  if (metadata.last_run_decision_required === true) {
    return {
      triggered: false,
      taskId,
      action: "decision_required",
      reason: "last run requires review",
    };
  }

  // resolve workspace if workspaceId provided but no workspacePath yet
  const workspaceId = metadata.workspace_id as string | undefined;
  if (workspaceId && !workspacePath) {
    const workspace = getWorkspace(namespaceId, orgId, workspaceId);
    if (workspace) {
      const settings = readSystemSettings();
      const allowed = resolveAutoRun(workspace, settings.auto_run_enabled);
      if (!allowed) {
        return {
          triggered: false,
          taskId,
          error: `Auto-run disabled for workspace '${workspace.name}'`,
        };
      }
      workspacePath = workspace.path;
    }
  }
  workspacePath = resolveAuthorizedWorkspacePath(namespaceId, orgId, workspacePath, undefined);

  // case 1: chain already assigned — start the run
  if (chainId) {
    return await startChainRun(
      taskId,
      chainId,
      task.title,
      namespaceId,
      orgId,
      request,
      workspacePath,
      metadata
    );
  }

  // case 2: generation job already running — check if it completed and auto-save/assign
  const generationJobId = metadata.generation_job_id as string | undefined;
  if (generationJobId) {
    const job = getJob(generationJobId, namespaceId);
    if (!job) return { triggered: false, taskId, action: "generation_pending" };

    if (job.status === "running" || job.status === "pending") {
      return {
        triggered: false,
        taskId,
        action: "generation_pending",
        jobId: generationJobId,
      };
    }

    if (job.status === "failed") {
      taskUpdate(orgId, taskId, {
        metadata: {
          ...metadata,
          generation_job_id: undefined,
          generation_status: "failed",
          auto_run_retries: ((metadata.auto_run_retries as number) || 0) + 1,
        },
      }, namespaceId);
      return {
        triggered: false,
        taskId,
        error: `Generation job failed: ${job.error}`,
      };
    }

    if (job.status === "complete") {
      return await autoAcceptGeneratedChain(
        taskId,
        task.title,
        metadata,
        job.result,
        namespaceId,
        orgId,
        request,
        workspacePath
      );
    }
  }

  // case 3: analysis job already running — check if it completed and auto-accept
  const analysisJobId = metadata.analysis_job_id as string | undefined;
  if (analysisJobId) {
    const job = getJob(analysisJobId, namespaceId);
    if (!job) return { triggered: false, taskId, action: "analysis_pending" };

    if (job.status === "running" || job.status === "pending") {
      return {
        triggered: false,
        taskId,
        action: "analysis_pending",
        jobId: analysisJobId,
      };
    }

    if (job.status === "failed") {
      // clear the failed job so next run tries again
      taskUpdate(orgId, taskId, {
        metadata: {
          ...metadata,
          analysis_job_id: undefined,
          analysis_status: "failed",
        },
      }, namespaceId);
      return {
        triggered: false,
        taskId,
        error: `Analysis job failed: ${job.error}`,
      };
    }

    if (job.status === "complete" && job.result?.recommendation) {
      // auto-accept: extract chain from recommendation
      return await autoAcceptRecommendation(
        taskId,
        task.title,
        metadata,
        job.result.recommendation as Record<string, unknown>,
        namespaceId,
        orgId,
        request,
        workspacePath
      );
    }
  }

  // case 4: no chain, no pending job — start analysis
  return await startAnalysisJob(taskId, namespaceId, orgId, request, workspacePath, task);
}

async function autoAcceptRecommendation(
  taskId: string,
  taskTitle: string,
  metadata: Record<string, unknown>,
  recommendation: Record<string, unknown>,
  namespaceId: string,
  orgId: string,
  request: NextRequest,
  workspacePath?: string
): Promise<TriggerResult> {
  const action = recommendation.action as string;

  if (action === "use_existing") {
    const chainId = recommendation.chain_id as string;
    if (!chainId)
      return { triggered: false, taskId, error: "Recommendation missing chain_id" };

    // assign chain to task
    const updated = {
      ...metadata,
      chain_id: chainId,
      chain_name: recommendation.chain_name,
      analysis_status: "accepted",
    };
    try {
      taskUpdate(orgId, taskId, { metadata: updated }, namespaceId);
    } catch {
      /* non-fatal */
    }

    return await startChainRun(
      taskId,
      chainId,
      taskTitle,
      namespaceId,
      orgId,
      request,
      workspacePath,
      updated
    );
  }

  if (action === "generate_new") {
    // kick off generation job — next trigger cycle will start the run
    return await startGenerationJob(
      taskId,
      metadata,
      recommendation.generation_prompt as string,
      namespaceId,
      orgId,
      request,
      workspacePath
    );
  }

  return {
    triggered: false,
    taskId,
    error: `Unknown recommendation action: ${action}`,
  };
}

async function autoAcceptGeneratedChain(
  taskId: string,
  taskTitle: string,
  metadata: Record<string, unknown>,
  result: Record<string, unknown> | undefined,
  namespaceId: string,
  orgId: string,
  request: NextRequest,
  workspacePath?: string
): Promise<TriggerResult> {
  const generated = extractGeneratedChain(result);
  if (!generated) {
    taskUpdate(orgId, taskId, {
      metadata: {
        ...metadata,
        generation_status: "failed",
        auto_run_retries: ((metadata.auto_run_retries as number) || 0) + 1,
      },
    }, namespaceId);
    return {
      triggered: false,
      taskId,
      error: "Generation job completed without a valid chain",
    };
  }

  const chain = sanitizeGeneratedChain(generated);
  const chainName = String(chain.name || "Generated Chain");
  const chainId = slugifyChainName(chainName);
  const origin = new URL(request.url).origin;

  const saveRes = await fetch(`${origin}/api/chains/save`, {
    method: "POST",
    headers: forwardedHeaders(request, namespaceId, orgId, {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({ chain, name: chainId }),
  });

  if (!saveRes.ok) {
    const err = await saveRes.json().catch(() => ({}));
    const message = (err as { error?: { message?: string } }).error?.message
      || (err as { error?: string }).error
      || "Failed to save generated chain";
    return { triggered: false, taskId, error: message };
  }

  const updated = {
    ...metadata,
    chain_id: chainId,
    chain_name: chainName,
    generation_job_id: undefined,
    generation_status: "accepted",
    analysis_status: "accepted",
  };
  taskUpdate(orgId, taskId, { metadata: updated }, namespaceId);

  return await startChainRun(
    taskId,
    chainId,
    taskTitle,
    namespaceId,
    orgId,
    request,
    workspacePath,
    updated
  );
}

async function startGenerationJob(
  taskId: string,
  metadata: Record<string, unknown>,
  prompt: string,
  namespaceId: string,
  orgId: string,
  request: NextRequest,
  workspacePath?: string
): Promise<TriggerResult> {
  const origin = new URL(request.url).origin;

  const jobRes = await fetch(`${origin}/api/jobs`, {
    method: "POST",
    headers: forwardedHeaders(request, namespaceId, orgId, {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      type: "generate",
      taskId,
      input: { prompt, workspacePath },
    }),
  });

  if (!jobRes.ok) {
    const err = await jobRes.json().catch(() => ({}));
    return { triggered: false, taskId, error: (err as { error?: string }).error || "Failed to start generation" };
  }

  const jobData = await jobRes.json();
  const generationJobId = jobData.data?.jobId || jobData.jobId;
  try {
    taskUpdate(orgId, taskId, {
      metadata: {
        ...metadata,
        generation_job_id: generationJobId,
        generation_status: "running",
        analysis_status: "accepted",
      },
    }, namespaceId);
  } catch {
    /* non-fatal */
  }

  return { triggered: true, taskId, jobId: generationJobId, action: "generation_started" };
}

async function startChainRun(
  taskId: string,
  chainId: string,
  taskTitle: string,
  namespaceId: string,
  orgId: string,
  request: NextRequest,
  workspacePath?: string,
  taskMetadata?: Record<string, unknown>
): Promise<TriggerResult> {
  const origin = new URL(request.url).origin;
  const metadata = taskMetadata || {};

  const resumableRunId = readResumableRunId(taskId, chainId, namespaceId, metadata);
  if (resumableRunId) {
    return resumeExistingRun(taskId, resumableRunId, namespaceId, orgId, request, metadata);
  }

  const chainRes = await fetch(
    `${origin}/api/chains/${encodeURIComponent(chainId)}`,
    {
      headers: forwardedHeaders(request, namespaceId, orgId),
    }
  );

  if (!chainRes.ok) {
    // chain was deleted -- clear the binding so auto-run can re-analyze
    try {
      const meta = taskMetadata || {};
      taskUpdate(orgId, taskId, {
        metadata: {
          ...meta,
          chain_id: undefined,
          chain_name: undefined,
          auto_run_retries: ((meta.auto_run_retries as number) || 0) + 1,
        },
      }, namespaceId);
    } catch { /* non-fatal */ }
    return { triggered: false, taskId, error: `Chain not found: ${chainId} (binding cleared)` };
  }

  const chainData = await chainRes.json();
  const chain = chainData.data.chain;
  if (!chain) {
    return { triggered: false, taskId, error: "Chain data missing" };
  }

  const runRes = await fetch(`${origin}/api/chains/run`, {
    method: "POST",
    headers: forwardedHeaders(request, namespaceId, orgId, {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      chain,
      chainId,
      userPrompt: taskTitle,
      taskId,
      ...(workspacePath ? { workspacePath } : {}),
      ...(taskMetadata?.workspace_id ? { workspaceId: taskMetadata.workspace_id } : {}),
    }),
  });

  if (!runRes.ok) {
    const err = await runRes.json().catch(() => ({}));
    return { triggered: false, taskId, error: (err as { error?: string }).error || "Failed to start run" };
  }

  const runData = await runRes.json();

  // record last_run_id in task metadata
  try {
    const currentTask = taskGet(orgId, taskId, namespaceId);
    const existingMeta = currentTask?.metadata && typeof currentTask.metadata === "object"
      ? currentTask.metadata as Record<string, unknown>
      : taskMetadata || {};
    taskUpdate(orgId, taskId, {
      metadata: {
        ...existingMeta,
        last_run_id: runData.data.runId,
        last_run_status: "running",
        last_run_error: undefined,
        auto_run_retries: 0,
      },
    }, namespaceId);
  } catch {
    /* non-fatal */
  }

  return {
    triggered: true,
    taskId,
    runId: runData.data.runId,
    action: "chain_run",
  };
}

async function startAnalysisJob(
  taskId: string,
  namespaceId: string,
  orgId: string,
  request: NextRequest,
  workspacePath?: string,
  task?: {
    id: string;
    title: string;
    description?: string;
    issue_type?: string;
    priority?: number;
    acceptance_criteria?: string | null;
    design?: string | null;
    notes?: string | null;
    metadata?: string | Record<string, unknown>;
  }
): Promise<TriggerResult> {
  const origin = new URL(request.url).origin;
  if (!task) return { triggered: false, taskId, error: "Task not found" };

  const namespaceConfig = await getNamespaceConfig(request);
  const chains = getAllChains(namespaceConfig.chainsDir, config.cliBin);
  const chainCatalog = buildChainSummary(chains);

  const taskContext = [
    `title: ${task.title}`,
    task.description ? `description: ${task.description}` : null,
    task.issue_type ? `type: ${task.issue_type}` : null,
    task.priority !== undefined
      ? `priority: ${task.priority} (0=critical, 4=backlog)`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  // keep this prompt resolution as a local fallback smoke check, but pass the
  // structured task to /api/jobs so the job route owns template resolution.
  const template = getTemplate(namespaceId, orgId, "chain_recommendation");
  resolveTemplate(template.content, {
    TASK_CONTEXT: taskContext,
    CHAIN_CATALOG: chainCatalog,
    WORKSPACE_CONTEXT: workspacePath
      ? `\nWORKSPACE CONTEXT: This task belongs to the project in "${workspacePath}". Recommend or generate a chain for that specific codebase.\n`
      : "",
  });

  const jobRes = await fetch(`${origin}/api/jobs`, {
    method: "POST",
    headers: forwardedHeaders(request, namespaceId, orgId, {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      type: "recommend",
      taskId,
      input: {
        task: {
          title: task.title,
          description: task.description,
          type: task.issue_type,
          priority: task.priority,
          acceptance: task.acceptance_criteria || undefined,
          design: task.design || undefined,
          notes: task.notes || undefined,
        },
        chainCatalog,
        workspacePath,
      },
    }),
  });

  if (!jobRes.ok) {
    const err = await jobRes.json().catch(() => ({}));
    return { triggered: false, taskId, error: (err as { error?: string }).error || "Failed to start analysis" };
  }

  const jobData = await jobRes.json();
  const analysisJobId2 = jobData.data?.jobId || jobData.jobId;

  // update task metadata with analysis job ref
  try {
    const existing = (task.metadata || {}) as Record<string, unknown>;

    taskUpdate(orgId, taskId, {
      metadata: {
        ...existing,
        analysis_job_id: analysisJobId2,
        analysis_status: "running",
      },
    }, namespaceId);
  } catch {
    /* non-fatal */
  }

  return {
    triggered: true,
    taskId,
    jobId: analysisJobId2,
    action: "analysis_started",
  };
}

/**
 * Count currently active (running/pending) chain runs.
 * Same logic as /api/chains/run concurrency check.
 */
function countActiveRuns(namespaceId?: string): number {
  const nsId = namespaceId || config.namespaceId;
  const runsDir = nsPath(nsId, "runs");
  if (!existsSync(runsDir)) return 0;

  const runDirs = readdirSync(runsDir).filter((d) => d.startsWith("run-"));
  let count = 0;
  for (const dir of runDirs) {
    const rjPath = join(runsDir, dir, "run.json");
    if (!existsSync(rjPath)) continue;
    try {
      const rj = JSON.parse(readFileSync(rjPath, "utf-8"));
      if (rj.status === "running" || rj.status === "pending") count++;
    } catch { /* skip corrupt */ }
  }
  return count;
}
