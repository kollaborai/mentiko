/**
 * GET  /api/tasks/auto-run  — check & trigger auto-run for ready tasks
 * POST /api/tasks/auto-run  — force-trigger auto-run for a specific task
 */

import { NextRequest } from "next/server";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { checkAuth } from "@/lib/auth/api-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import {
  getNamespaceIdFromRequest,
  getOrgIdFromRequest,
} from "@/lib/namespace-config";
import { readSystemSettings, resolveMaxConcurrentChains } from "@/lib/system/system-settings";
import {
  getAutoRunCandidates,
  isTaskReady,
  reconcileActiveAutoRunTasks,
  reconcileTaskActiveRun,
} from "@/lib/runs/auto-run";
import { taskGet, taskUpdate } from "@/lib/tasks/task-store";
import { getWorkspace, resolveAutoRun } from "@/lib/workspaces/workspace-storage";
import { getJob } from "@/lib/runs/job-store";
import config, { nsPath } from "@/lib/config";
import { Unauthorized, Forbidden, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveAuthorizedWorkspacePath } from "@/lib/auth/workspace-auth";
import {
  buildGenerationPromptFromTaskRecommendation,
  normalizeTaskChainRecommendation,
} from "@/lib/tasks/task-chain-recommendation";
import { internalApiUrl } from "@/lib/auth/internal-web-origin";
import { allDeclaredAgentsComplete } from "@/lib/runs/run-completion";
import { isNonExecutionRun } from "@/lib/runs/run-provenance";

export const dynamic = "force-dynamic";

export const runtime = "nodejs";

const RESUMABLE_RUN_STATUSES = new Set(["stopped", "failed", "cancelled"]);
const DONE_TASK_STATUSES = new Set(["closed", "resolved", "done", "complete"]);
const COMPLETED_RUN_STATUSES = new Set(["completed", "complete"]);

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
  const maxConcurrent = resolveMaxConcurrentChains(namespaceId);
  return apiSuccess({
    auto_run_enabled: true,
    max_concurrent_runs: maxConcurrent,
    active_runs: activeRuns,
    available_slots: Math.max(0, maxConcurrent - activeRuns),
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

  // respect the concurrency ceiling -- only trigger up to available slots. Uses the
  // SAME authoritative resolver as the run starter + engine (phase-2 step 2): the
  // MENTIKO_MAX_CONCURRENT_CHAINS env (control-plane per-tier) when set, else the
  // max_concurrent_runs system setting.
  const activeCount = countActiveRuns(namespaceId);
  const maxConcurrent = resolveMaxConcurrentChains(namespaceId);
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
      metadata?: unknown;
    };
    if (run.taskId !== taskId) return null;
    if (isNonExecutionRun(run)) return null;
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
  const resumeRes = await fetch(internalApiUrl(`/api/runs/${encodeURIComponent(runId)}/resume`, request.url), {
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

function recoverGeneratedChainFromRunArtifacts(
  metadata: Record<string, unknown>,
  namespaceId: string
): Record<string, unknown> | undefined {
  const runId = typeof metadata.generated_chain_run_id === "string"
    ? metadata.generated_chain_run_id
    : undefined;
  if (!runId) return undefined;
  const artifactsDir = nsPath(namespaceId, "runs", runId, "artifacts");
  if (!existsSync(artifactsDir)) return undefined;
  const candidates = [
    "generation-result.json",
    ...readdirSync(artifactsDir).filter((file) =>
      file.endsWith("-generation-result.json") ||
      file.endsWith("-output.json") ||
      file.endsWith("-result.json")
    ),
  ];
  for (const candidate of candidates) {
    const path = join(artifactsDir, candidate);
    if (!existsSync(path)) continue;
    const parsed = parseJsonObject(readFileSync(path, "utf8"));
    const chain = extractGeneratedChain(parsed || undefined);
    if (chain) return chain;
  }
  return undefined;
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
    typeof task.workspace_id === "string"
      ? task.workspace_id
      : typeof metadata.workspace_path === "string"
        ? metadata.workspace_path
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
  const taskStatus = typeof task.status === "string" ? task.status : undefined;
  const lastRunStatus =
    typeof metadata.last_run_status === "string" ? metadata.last_run_status : undefined;

  if (taskStatus && DONE_TASK_STATUSES.has(taskStatus)) {
    return {
      triggered: false,
      taskId,
      action: "already_completed",
      reason: "task is already complete",
    };
  }

  if (metadata.last_run_decision_required === true) {
    return {
      triggered: false,
      taskId,
      action: "decision_required",
      reason: "last run requires review",
    };
  }

  const pendingGenerationJobId = metadata.generation_job_id as string | undefined;
  if (lastRunStatus && COMPLETED_RUN_STATUSES.has(lastRunStatus) && !pendingGenerationJobId) {
    return {
      triggered: false,
      taskId,
      action: "already_completed",
      reason: "last auto-run completed",
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
    if (!job) {
      const recovered = recoverGeneratedChainFromRunArtifacts(metadata, namespaceId);
      if (recovered) {
        return await autoAcceptGeneratedChain(
          taskId,
          task.title,
          metadata,
          recovered,
          namespaceId,
          orgId,
          request,
          workspacePath
        );
      }
      taskUpdate(orgId, taskId, {
        metadata: {
          ...metadata,
          generation_job_id: undefined,
          generation_status: "missing",
          auto_run_retries: ((metadata.auto_run_retries as number) || 0) + 1,
        },
      }, namespaceId);
      return { triggered: false, taskId, action: "generation_missing", jobId: generationJobId };
    }

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
    if (!job) {
      taskUpdate(orgId, taskId, {
        metadata: {
          ...metadata,
          analysis_job_id: undefined,
          analysis_status: "missing",
          auto_run_retries: ((metadata.auto_run_retries as number) || 0) + 1,
        },
      }, namespaceId);
      return { triggered: false, taskId, action: "analysis_missing", jobId: analysisJobId };
    }

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
  const normalized = normalizeTaskChainRecommendation(recommendation);
  if (!normalized) {
    return {
      triggered: false,
      taskId,
      error: "Invalid recommendation payload",
    };
  }

  const action = normalized.action;

  if (action === "use_existing") {
    const chainId = normalized.chain_id;
    if (!chainId)
      return { triggered: false, taskId, error: "Recommendation missing chain_id" };

    // assign chain to task
    const updated = {
      ...metadata,
      chain_id: chainId,
      chain_name: normalized.chain_name,
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
    // Full task lookup (not just the title string threaded through this
    // function) so the delivery-requirement rule in
    // buildGenerationPromptFromTaskRecommendation can see issue_type +
    // acceptance_criteria. Without this, autonomous auto-run generation never
    // told the chain-generator this task needed a code-writing agent.
    const fullTask = taskGet(orgId, taskId, namespaceId);
    // kick off generation job — next trigger cycle will start the run
    return await startGenerationJob(
      taskId,
      metadata,
      buildGenerationPromptFromTaskRecommendation(
        {
          title: taskTitle,
          description: fullTask?.description ?? undefined,
          issue_type: fullTask?.issue_type ?? undefined,
          acceptance_criteria: fullTask?.acceptance_criteria ?? undefined,
        },
        normalized
      ),
      namespaceId,
      orgId,
      request,
      workspacePath
    );
  }

  if (action === "execute_directly") {
    const updated = {
      ...metadata,
      auto_run: false,
      analysis_status: "accepted",
      chain_recommendation_action: "execute_directly",
      chain_recommendation_reason: normalized.reasoning,
    };
    try {
      taskUpdate(orgId, taskId, { metadata: updated }, namespaceId);
    } catch {
      /* non-fatal */
    }
    return {
      triggered: false,
      taskId,
      action: "execute_directly",
      reason: normalized.reasoning,
    };
  }

  if (action === "no_action_needed") {
    const updated = {
      ...metadata,
      auto_run: false,
      analysis_status: "accepted",
      chain_recommendation_action: "no_action_needed",
      chain_recommendation_reason: normalized.reasoning,
    };
    try {
      taskUpdate(orgId, taskId, { metadata: updated }, namespaceId);
    } catch {
      /* non-fatal */
    }
    return {
      triggered: false,
      taskId,
      action: "no_action_needed",
      reason: normalized.reasoning,
    };
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
  const saveRes = await fetch(internalApiUrl("/api/chains/save", request.url), {
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
  const jobRes = await fetch(internalApiUrl("/api/jobs", request.url), {
    method: "POST",
    headers: forwardedHeaders(request, namespaceId, orgId, {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      type: "generate",
      taskId,
      input: { prompt, workspacePath, namespaceId, orgId },
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
  const metadata = taskMetadata || {};

  const resumableRunId = readResumableRunId(taskId, chainId, namespaceId, metadata);
  if (resumableRunId) {
    return resumeExistingRun(taskId, resumableRunId, namespaceId, orgId, request, metadata);
  }

  const chainRes = await fetch(
    internalApiUrl(`/api/chains/${encodeURIComponent(chainId)}`, request.url),
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

  const runRes = await fetch(internalApiUrl("/api/chains/run", request.url), {
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
  if (!task) return { triggered: false, taskId, error: "Task not found" };

  // /api/jobs owns namespace-aware template resolution and chain catalog loading.

  const jobRes = await fetch(internalApiUrl("/api/jobs", request.url), {
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
        workspacePath,
        namespaceId,
        orgId,
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
      if ((rj.status === "running" || rj.status === "pending") && !allDeclaredAgentsComplete(rj, join(runsDir, dir))) {
        count++;
      }
    } catch { /* skip corrupt */ }
  }
  return count;
}
