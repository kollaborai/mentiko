/**
 * GET  /api/tasks/auto-run  — check & trigger auto-run for ready tasks
 * POST /api/tasks/auto-run  — force-trigger auto-run for a specific task
 */

import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { withRunJsonLock, writeRunJsonAtomic } from "@/lib/runs/run-json-lock";
import { checkAuth } from "@/lib/auth/api-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import {
  getNamespaceIdFromRequest,
  getOrgIdFromRequest,
} from "@/lib/namespace-config";
import { readSystemSettings, resolveMaxConcurrentChains } from "@/lib/system/system-settings";
import {
  buildRunsSnapshot,
  canAdmitAutoRun,
  getAutoRunCandidates,
  getDirectDependentAutoRunCandidates,
  isTaskReady,
  reconcileActiveAutoRunTasks,
  reconcileTaskActiveRun,
  removeRunFromSnapshot,
  type RunsSnapshot,
} from "@/lib/runs/auto-run";
import { taskAddDep, taskClaimMetadataKeyIfUnset, taskGet, taskUpdate } from "@/lib/tasks/task-store";
import { isTaskWorkMode, resolveTaskWorkMode } from "@/lib/tasks/work-mode";
import { chainHasDeliveryAgent } from "@/lib/tasks/completion-audit-delivery-gate";
import { normalizeTaskChainBindingMetadata } from "@/lib/tasks/task-chain-binding";
import { createTaskDecision } from "@/lib/tasks/task-decision-link";
import { triggerAutoRunScan } from "@/lib/runs/auto-run-service";
import { getWorkspace, listWorkspaces, resolveAutoRun } from "@/lib/workspaces/workspace-storage";
import { getJob, listJobs, type Job, type JobType } from "@/lib/runs/job-store";
import { listDecisions, updateDecision } from "@/lib/decisions/decision-storage";
import { isTerminalTaskStatus } from "@/lib/tasks/task-status";
import { nsPath } from "@/lib/config";
import { resolveLinkRunsDir } from "@/lib/links/link-run-runtime";
import { Unauthorized, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveAuthorizedWorkspacePath } from "@/lib/auth/workspace-auth";
import {
  buildGenerationPromptFromTaskRecommendation,
  normalizeTaskChainRecommendation,
} from "@/lib/tasks/task-chain-recommendation";
import { internalApiUrl, forwardedHeaders } from "@/lib/auth/internal-web-origin";
import { isNonExecutionRun } from "@/lib/runs/run-provenance";
import { executionStartedLifecycleMetadata } from "@/lib/orchestration/task-lifecycle-metadata";
import {
  createTaskRunScope,
  locateTaskRun,
  parseTaskRunScope,
  taskRunLaunchFailureMetadata,
  TASK_RUN_SCOPE_METADATA_KEY,
} from "@/lib/tasks/task-run-locator";
import { unwrapAgentJsonOutput } from "@/lib/tasks/agent-json-output";
import { isPayloadCompatibleWithKind } from "@/lib/generation/payload-contract";
import { pruneInvalidChainBranches } from "@/lib/validators";
import { MAX_AUTO_RUN_RETRIES } from "@/lib/tasks/auto-run-state";
import {
  extractGeneratedChainResult,
  INVALID_GENERATED_CHAIN_RESULT_ERROR,
} from "@/lib/chains/generated-chain-result";
import { GENERATED_CHAIN_VALIDATOR_REVISION } from "@/lib/chains/generated-chain-delivery-contract";
import {
  canonicalGeneratedChainHash,
  findGeneratedChainRejection,
  type GeneratedChainRejectionEnvelope,
} from "@/lib/chains/generated-chain-rejections";
import { decideGenerationRejection } from "@/lib/tasks/generation-rejection-policy";
import { appendGenerationAttempt } from "@/lib/tasks/generation-attempt-ledger";

export const dynamic = "force-dynamic";

export const runtime = "nodejs";

const RESUMABLE_RUN_STATUSES = new Set(["stopped", "failed", "cancelled"]);
const JOB_CLAIM_PREFIX = "claim-";
const JOB_CLAIM_STALE_MS = 5 * 60 * 1000;
const EXECUTE_DIRECTLY_GATE_KEY = "auto_run_execute_directly_gate";
const EXECUTE_DIRECTLY_GATE_STALE_MS = 5 * 60 * 1000;

function asJsonRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function generatedChainSaveFailureMessage(payload: unknown, status: number): string {
  const root = asJsonRecord(payload);
  const error = asJsonRecord(root?.error);
  const details = asJsonRecord(error?.details) ?? asJsonRecord(root?.details);
  const validationErrors = Array.isArray(details?.errors)
    ? details.errors.filter((item): item is string => typeof item === "string")
    : [];
  const summary = typeof error?.message === "string"
    ? error.message
    : typeof root?.error === "string"
      ? root.error
      : `Chain save returned ${status}`;

  return validationErrors.length > 0
    ? `${summary}: ${validationErrors.join("; ")}`
    : summary;
}

/**
 * Typed rejection-envelope reader for a chain-save 422 payload. Retry logic
 * branches on this envelope, never on the message string (A3). Stale
 * validator revisions are ignored so an upgraded validator re-evaluates.
 */
function readRejectionEnvelopeFromSavePayload(payload: unknown): GeneratedChainRejectionEnvelope | undefined {
  const root = asJsonRecord(payload);
  const error = asJsonRecord(root?.error);
  const details = asJsonRecord(error?.details) ?? asJsonRecord(root?.details);
  const rejection = asJsonRecord(details?.rejection);
  if (
    rejection
    && typeof rejection.artifact_hash === "string"
    && typeof rejection.code === "string"
    && rejection.deterministic === true
    && rejection.validator_revision === GENERATED_CHAIN_VALIDATOR_REVISION
  ) {
    return rejection as unknown as GeneratedChainRejectionEnvelope;
  }
  return undefined;
}

/**
 * Typed rejection recorded on the task by the import door
 * (/api/jobs/[id]/complete). Only trusted when it was written for THIS failed
 * job and under the current validator revision -- otherwise the failure is
 * treated as transient and takes the bounded generic retry path.
 */
function readTaskGenerationRejection(
  metadata: Record<string, unknown>,
  jobId: string,
): GeneratedChainRejectionEnvelope | undefined {
  if (metadata.generation_rejection_job_id !== jobId) return undefined;
  const rejection = asJsonRecord(metadata.generation_rejection);
  if (
    rejection
    && typeof rejection.artifact_hash === "string"
    && typeof rejection.code === "string"
    && rejection.deterministic === true
    && rejection.validator_revision === GENERATED_CHAIN_VALIDATOR_REVISION
  ) {
    return rejection as unknown as GeneratedChainRejectionEnvelope;
  }
  return undefined;
}

/**
 * Deterministic-rejection policy for the save/recovery door (A4): one guided
 * regeneration for a fresh fingerprint, immediate stop on a repeat or once
 * the deterministic allowance is spent. Deterministic stops never consume
 * auto_run_retries -- that budget is for transient failures only.
 */
function handleDeterministicRejection(input: {
  taskId: string;
  metadata: Record<string, unknown>;
  namespaceId: string;
  orgId: string;
  envelope: GeneratedChainRejectionEnvelope;
}): TriggerResult {
  const decision = decideGenerationRejection({
    envelope: input.envelope,
    priorFingerprints: input.metadata.generation_rejection_fingerprints,
  });
  if (decision.stop) {
    // generation_status stays the truthful attempt outcome ("failed");
    // generation_stop_reason is the one flag that marks the loop as
    // INTENTIONALLY stopped -- the admission gate and the UI both read it.
    taskUpdate(input.orgId, input.taskId, {
      metadata: {
        ...input.metadata,
        generation_job_id: undefined,
        generation_status: "failed",
        generation_stop_reason: decision.stopReason,
        generation_rejection: input.envelope,
        generation_rejection_fingerprints: decision.fingerprints,
        ...appendGenerationAttempt(input.metadata, {
          phase: input.envelope.phase === "run_start" ? "binding" : input.envelope.phase,
          code: input.envelope.code,
          class: "deterministic",
          input_hash: input.envelope.artifact_hash,
          revision: input.envelope.validator_revision,
          stop_reason: decision.stopReason,
        }),
      },
    }, input.namespaceId);
    return {
      triggered: false,
      taskId: input.taskId,
      action: "generation_stopped",
      reason: decision.stopReason,
      error: input.envelope.message,
    };
  }
  taskUpdate(input.orgId, input.taskId, {
    metadata: {
      ...input.metadata,
      generation_job_id: undefined,
      generation_status: "rejected",
      generation_last_error: input.envelope.message,
      generation_rejection: input.envelope,
      generation_rejection_fingerprints: decision.fingerprints,
      ...appendGenerationAttempt(input.metadata, {
        phase: input.envelope.phase === "run_start" ? "binding" : input.envelope.phase,
        code: input.envelope.code,
        class: "deterministic",
        input_hash: input.envelope.artifact_hash,
        revision: input.envelope.validator_revision,
        guidance: input.envelope.message,
      }),
    },
  }, input.namespaceId);
  void triggerAutoRunScan(input.namespaceId, input.orgId);
  return {
    triggered: false,
    taskId: input.taskId,
    action: "generation_rejected_regenerating",
    error: input.envelope.message,
    recoveryScheduled: true,
  };
}

/** GET — dry-run scan, returns all ready candidates without triggering anything */
export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const runsSnapshot = buildRunsSnapshot(namespaceId);
  const candidates = getAutoRunCandidates(orgId, undefined, namespaceId, runsSnapshot);
  const activeRuns = runsSnapshot.activeRuns.length;
  const maxConcurrent = resolveMaxConcurrentChains(namespaceId);
  return apiSuccess({
    // System settings supply the inherited default. A workspace or explicit
    // task opt-in may legitimately override an off default.
    auto_run_enabled: readSystemSettings(namespaceId).auto_run_enabled,
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
  // Surgical completion nudge: when set, scan only this task's direct dependents (the
  // ones whose last blocker just cleared) instead of the whole org -- fast, and it can
  // never re-run a completed chain. Falls through the SAME concurrency-capped trigger.
  const completedTaskId: string | undefined =
    typeof body.completedTaskId === "string" ? body.completedTaskId : undefined;

  const orgId = await getOrgIdFromRequest(request);
  // ONE runs-dir read serves this whole request. The snapshot's active-run set
  // IS the dead-run reap candidate set, so reapDeadRuns consumes it (liveness
  // re-verified fresh under the run.json lock) and prunes reaped runs from it
  // in place -- admission below therefore always sees post-reap state: a
  // just-terminalized run neither holds a cap slot nor blocks its task.
  // Run reaping is part of admission, not a later maintenance pass. A reaped
  // run must update task metadata before this request selects candidates.
  const runsSnapshot = buildRunsSnapshot(namespaceId);
  const reapedDeadRuns = reapDeadRuns(runsSnapshot);
  const reconciledReapedRuns = reconcileReapedDeadRunTasks(orgId, namespaceId, reapedDeadRuns);
  const reconciledActiveRuns = reconcileActiveAutoRunTasks(orgId, namespaceId, runsSnapshot);

  // if taskId given, check/trigger just that task
  if (taskId) {
    // First fetch task to get workspace_path from metadata
    const task = taskGet(orgId, taskId, namespaceId);
    if (!task) {
      throw new NotFound("Task", taskId);
    }

    const metadata = parseTaskMetadata(task);
    const workspacePath = resolveTaskWorkspacePath(namespaceId, orgId, task, metadata);
    const activeRun = reconcileTaskActiveRun(orgId, task, namespaceId, runsSnapshot);
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

    const result = await triggerAutoRun(taskId, namespaceId, request, workspacePath, task, metadata, runsSnapshot);
    return apiSuccess(result);
  }

  // otherwise scan all candidates
  const candidates = completedTaskId
    ? getDirectDependentAutoRunCandidates(orgId, completedTaskId, namespaceId, runsSnapshot)
    : getAutoRunCandidates(orgId, undefined, namespaceId, runsSnapshot);
  if (candidates.length === 0) {
    return apiSuccess({
      triggered: 0,
      results: [],
      reaped: reapedDeadRuns.length,
      reconciled: reconciledActiveRuns,
      reapedTaskAdmissions: reconciledReapedRuns,
    });
  }

  // respect the concurrency ceiling -- only trigger up to available slots. Uses the
  // SAME authoritative resolver as the run starter + engine (phase-2 step 2): the
  // MENTIKO_MAX_CONCURRENT_CHAINS env (control-plane per-tier) when set, else the
  // max_concurrent_runs system setting. The count comes from the post-reap
  // snapshot -- identical semantics to the old countActiveRuns() walk.
  const activeCount = runsSnapshot.activeRuns.length;
  const maxConcurrent = resolveMaxConcurrentChains(namespaceId);
  const availableSlots = Math.max(0, maxConcurrent - activeCount);

  if (availableSlots === 0) {
    return apiSuccess({
      triggered: 0,
      reaped: reapedDeadRuns.length,
      skipped: candidates.length,
      reconciled: reconciledActiveRuns,
      reapedTaskAdmissions: reconciledReapedRuns,
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

  // The dispatch-time canAdmitAutoRun inside triggerAutoRun is the deliberate
  // self-heal against staleness accumulated between candidate scan and
  // dispatch (a concurrent POST/nudge starting a run for the same task). It
  // must see CURRENT state, so rebuild the snapshot here instead of reusing
  // the request's aging one -- one extra walk, same freshness the old
  // per-task live scans had.
  const dispatchSnapshot = buildRunsSnapshot(namespaceId);
  const results = await Promise.allSettled(
    toTrigger.map(async (c) => {
      const task = taskGet(orgId, c.taskId, namespaceId);
      if (!task) {
        return { triggered: false, taskId: c.taskId, error: "Task not found" };
      }
      const metadata = parseTaskMetadata(task);
      const workspacePath = resolveTaskWorkspacePath(namespaceId, orgId, task, metadata);

      return triggerAutoRun(c.taskId, namespaceId, request, workspacePath, task, metadata, dispatchSnapshot);
    })
  );

  const triggered = results.filter(
    (r) => r.status === "fulfilled" && r.value.triggered
  ).length;

  return apiSuccess({
    triggered,
    reaped: reapedDeadRuns.length,
    activeRuns: activeCount,
    maxConcurrent,
    reconciled: reconciledActiveRuns,
    reapedTaskAdmissions: reconciledReapedRuns,
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
  retryCount?: number;
  retryLimit?: number;
  recoveryScheduled?: boolean;
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

  // A task with an explicit scope must read exactly that record. A bad scoped
  // claim is not eligible for resume and must never fall back to the request
  // namespace root, which could resume another task's similarly named run.
  if (TASK_RUN_SCOPE_METADATA_KEY in metadata) {
    try {
      const scope = parseTaskRunScope(metadata[TASK_RUN_SCOPE_METADATA_KEY]);
      if (scope.taskId !== taskId || scope.runId !== runId) return null;
      return resumableRunIdFromRecord(taskId, chainId, runId, locateTaskRun(scope).run);
    } catch {
      return null;
    }
  }

  const runJsonPath = join(nsPath(namespaceId, "runs"), runId, "run.json");
  if (!existsSync(runJsonPath)) return null;

  try {
    return resumableRunIdFromRecord(
      taskId,
      chainId,
      runId,
      JSON.parse(readFileSync(runJsonPath, "utf-8")) as {
        taskId?: string;
        chainId?: string;
        status?: string;
        agents?: Array<{ status?: string }>;
        metadata?: unknown;
      },
    );
  } catch {
    return null;
  }
}

function resumableRunIdFromRecord(
  taskId: string,
  chainId: string,
  runId: string,
  run: {
    taskId?: string;
    chainId?: string;
    status?: string;
    agents?: Array<{ status?: string }>;
    metadata?: unknown;
  },
): string | null {
  if (run.taskId !== taskId) return null;
  if (isNonExecutionRun(run)) return null;
  if (run.chainId && run.chainId !== chainId) return null;
  if (run.status === "running" || run.status === "pending") return null;
  if (!run.status || !RESUMABLE_RUN_STATUSES.has(run.status)) return null;
  const agents = run.agents || [];
  if (agents.length > 0 && agents.every((agent) => agent.status === "complete")) return null;
  return runId;
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
        ...executionStartedLifecycleMetadata({
          taskId,
          metadata: existingMeta,
          runId,
          chainId: typeof existingMeta.chain_id === "string" ? existingMeta.chain_id : undefined,
        }),
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

  // Repair branches AFTER agents are finalized (emits/triggers are the branch
  // vocabulary). LLM-generated chains routinely invent branch events/targets that
  // no agent backs — those dangling branches fail validateChainBranches and make
  // the whole chain unsaveable, stranding the task at generation-complete. Drop
  // only the invalid branches (shared rule set with the validator) so the chain
  // saves and runs its linear flow instead of being rejected outright.
  if (sanitized.branches !== undefined) {
    const pruned = pruneInvalidChainBranches(
      sanitized.branches,
      Array.isArray(sanitized.agents) ? (sanitized.agents as Array<Record<string, unknown>>) : [],
    );
    if (pruned) {
      sanitized.branches = pruned;
    } else {
      delete sanitized.branches;
    }
  }

  return sanitized;
}

function asPlainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Resolve the recommendation object from a completed analysis job's result,
 * across BOTH shapes job.result can take:
 *
 *   - normal (already unwrapped):  { recommendation: {...} }
 *   - hydrated envelope:           { output: "<json string>" }
 *
 * job-store.ts readCompletedRunResult wraps a completed run's
 * generation-result.json as { output } for recommend jobs too
 * (isGenerationArtifactJob matches "recommend"). The inner json is itself
 * EITHER a bare { action, chain_id, ... } object OR a wrapped
 * { recommendation: {...} } (the typed generation payload importer normalizes with
 * `obj.recommendation ?? obj`), so both are handled here.
 *
 * Returns the recommendation object ONLY when the shared payload contract deems
 * it compatible; an unparseable / empty / incompatible payload resolves to null
 * so the caller counts it as an unreadable retry instead of mis-routing it.
 */
function resolveJobRecommendation(result: unknown): Record<string, unknown> | null {
  // The normal, already-unwrapped shape must cross the same boundary as an
  // artifact envelope. Otherwise `{ recommendation: { report: ... } }` skips
  // validation while `{ output: "..." }` does not, and normalizeTaskChainRecommendation
  // guesses a new generation run from unrelated data.
  const direct = asPlainObject(result);
  const directRecommendation = direct ? asPlainObject(direct.recommendation) : null;
  if (directRecommendation) {
    return isPayloadCompatibleWithKind(directRecommendation, "chain_recommendation")
      ? directRecommendation
      : null;
  }

  // Enveloped shape: unwrap { output: "<json>" }, then prefer a nested
  // `.recommendation` wrapper, falling back to the payload itself (bare shape).
  const payload = unwrapAgentJsonOutput(result);
  const recommendation = asPlainObject(payload?.recommendation) ?? payload ?? null;
  if (!recommendation) return null;

  // Validate through the shared payload contract — the SAME predicate the CLI
  // import path (typed generation payload importer) and the in-process hydration
  // boundary (job-store.ts readCompletedRunResult) use — so all three consumers
  // accept/reject the exact same recommendation payloads instead of each
  // re-guessing the shape. An unrelated/empty payload resolves to null and is
  // counted as an unreadable retry rather than mis-routed to generate_new.
  return isPayloadCompatibleWithKind(recommendation, "chain_recommendation") ? recommendation : null;
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
    const chain = extractGeneratedChainResult({ output: readFileSync(path, "utf8") });
    if (chain) return chain;
  }
  return undefined;
}

function parseTaskMetadata(
  task: ReturnType<typeof taskGet>
): Record<string, unknown> {
  const metadata = task?.metadata;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return normalizeTaskChainBindingMetadata(metadata as Record<string, unknown>);
  }
  if (typeof metadata === "string") {
    try {
      const parsed = JSON.parse(metadata);
      const record = asPlainObject(parsed);
      return record ? normalizeTaskChainBindingMetadata(record) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function newAutoRunClaimId(): string {
  return `${JOB_CLAIM_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function readClaimedAt(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? null : timestamp;
  }
  return null;
}

function taskMetadataForUpdate(
  orgId: string,
  taskId: string,
  namespaceId: string,
  fallback: Record<string, unknown>
): Record<string, unknown> {
  const current = taskGet(orgId, taskId, namespaceId);
  return current ? parseTaskMetadata(current) : fallback;
}

interface ClaimedJobRecovery {
  job?: Job;
  expired: boolean;
}

/**
 * A task claim is deliberately durable before dispatch. If the post-dispatch
 * metadata write fails, recover the exact job by its claim token instead of
 * launching another analysis/generation run. A legacy or pre-dispatch claim
 * with no matching job expires, so `claim-*` can never stall forever.
 */
function recoverClaimedJob(input: {
  taskId: string;
  metadata: Record<string, unknown>;
  jobKey: "analysis_job_id" | "generation_job_id";
  statusKey: "analysis_status" | "generation_status";
  claimedAtKey: "analysis_job_claimed_at" | "generation_job_claimed_at";
  jobType: Extract<JobType, "recommend" | "generate">;
  namespaceId: string;
  orgId: string;
}): ClaimedJobRecovery {
  const claimId = typeof input.metadata[input.jobKey] === "string"
    ? input.metadata[input.jobKey] as string
    : "";
  const recovered = listJobs({ taskId: input.taskId }, input.namespaceId).find((job) =>
    job.type === input.jobType && job.input?.auto_run_claim_id === claimId
  );
  if (recovered) {
    try {
      const current = taskMetadataForUpdate(input.orgId, input.taskId, input.namespaceId, input.metadata);
      taskUpdate(input.orgId, input.taskId, {
        metadata: {
          ...current,
          [input.jobKey]: recovered.id,
          [input.statusKey]: recovered.status === "pending" ? "running" : recovered.status,
          [input.claimedAtKey]: undefined,
        },
      }, input.namespaceId);
    } catch {
      // Keep the claim: a later scan will discover the exact same job again.
    }
    return { job: recovered, expired: false };
  }

  const claimedAt = readClaimedAt(input.metadata, input.claimedAtKey);
  if (claimedAt !== null && Date.now() - claimedAt < JOB_CLAIM_STALE_MS) {
    return { expired: false };
  }

  try {
    const current = taskMetadataForUpdate(input.orgId, input.taskId, input.namespaceId, input.metadata);
    taskUpdate(input.orgId, input.taskId, {
      metadata: {
        ...current,
        [input.jobKey]: undefined,
        [input.statusKey]: "claim_expired",
        [input.claimedAtKey]: undefined,
      },
    }, input.namespaceId);
  } catch {
    // We still return a bounded state; the untouched claim will be retried on
    // the next scan and cannot start a duplicate job meanwhile.
  }
  return { expired: true };
}

// Resolve a workspace given any mix of a Workspace.id (metadata.workspace_id)
// and/or a filesystem path (workspacePath / task.workspace_id) -- either
// candidate may match either field, since callers disagree on which one they
// hand in. Returns null when nothing matches.
function findWorkspaceByIdOrPath(
  namespaceId: string,
  orgId: string,
  ...candidates: Array<string | undefined>
): ReturnType<typeof getWorkspace> {
  const values = candidates.filter((v): v is string => Boolean(v));
  if (values.length === 0) return null;
  return listWorkspaces(namespaceId, orgId).find((w) => values.includes(w.id) || values.includes(w.path)) ?? null;
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
  metadata: Record<string, unknown>,
  runsSnapshot?: RunsSnapshot
): Promise<TriggerResult> {
  const chainId = metadata.chain_id as string | undefined;
  const orgId = await getOrgIdFromRequest(request);

  // Resolve the actual workspace before admission. canAdmitAutoRun owns the
  // precedence rule: task explicit > workspace > system. Passing the resolved
  // workspace default here keeps direct POSTs consistent with the scan path,
  // including metadata.workspace_id/path forms that do not live in task.workspace_id.
  const workspaceId = metadata.workspace_id as string | undefined;
  const metadataWorkspacePath = typeof metadata.workspace_path === "string"
    ? metadata.workspace_path
    : undefined;
  const workspace = findWorkspaceByIdOrPath(
    namespaceId,
    orgId,
    workspaceId,
    metadataWorkspacePath,
    workspacePath
  );
  const workspaceAutoRunDefault = workspace
    ? resolveAutoRun(workspace, readSystemSettings(namespaceId).auto_run_enabled)
    : undefined;

  // Single gate for admission -- the SAME predicate the 60s poller uses via
  // getAutoRunCandidates. This is what stops a paused/terminal task from
  // slipping through the direct POST path or a post-job continuation call.
  const admission = canAdmitAutoRun(task, orgId, namespaceId, workspaceAutoRunDefault, runsSnapshot);
  if (!admission.admit) {
    return { triggered: false, taskId, action: admission.action, reason: admission.reason };
  }

  // The workspace is an inherited default, not a second veto after the shared
  // gate. In particular, an explicit task opt-in must work while its workspace
  // is off (the per-task throttle contract). We only use the resolved workspace
  // here to fill the authorized execution path.
  if (workspace) {
    if (!workspacePath) workspacePath = workspace.path;
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
    const claimed = generationJobId.startsWith(JOB_CLAIM_PREFIX);
    const claimedRecovery = claimed
      ? recoverClaimedJob({
          taskId,
          metadata,
          jobKey: "generation_job_id",
          statusKey: "generation_status",
          claimedAtKey: "generation_job_claimed_at",
          jobType: "generate",
          namespaceId,
          orgId,
        })
      : undefined;
    if (claimed && !claimedRecovery?.job) {
      return {
        triggered: false,
        taskId,
        action: claimedRecovery?.expired ? "generation_claim_expired" : "generation_pending",
        jobId: generationJobId,
      };
    }

    const job = claimedRecovery?.job ?? getJob(generationJobId, namespaceId);
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
      const message = `Chain generation job record is missing: ${generationJobId}`;
      const nextRetries = Math.min(
        MAX_AUTO_RUN_RETRIES,
        ((metadata.auto_run_retries as number) || 0) + 1,
      );
      taskUpdate(orgId, taskId, {
        metadata: {
          ...metadata,
          generation_job_id: undefined,
          generation_status: "missing",
          generation_last_error: message,
          auto_run_retries: nextRetries,
          ...appendGenerationAttempt(metadata, {
            phase: "generation",
            code: "generation_job_missing",
            class: "transient",
            guidance: message,
          }),
        },
      }, namespaceId);
      if (nextRetries < MAX_AUTO_RUN_RETRIES) {
        void triggerAutoRunScan(namespaceId, orgId);
      }
      return { triggered: false, taskId, action: "generation_missing", jobId: generationJobId };
    }

    if (job.status === "running" || job.status === "pending") {
      return {
        triggered: false,
        taskId,
        action: "generation_pending",
        jobId: job.id,
      };
    }

    if (job.status === "failed") {
      // Import-door contract rejection (typed, deterministic): the completion
      // route recorded the envelope + fingerprint decision on the task. Run
      // the one guided regeneration WITHOUT consuming auto_run_retries --
      // that budget is reserved for transient failures (A4). A rejection the
      // policy STOPPED never reaches this branch: generation_stop_reason makes
      // canAdmitAutoRun refuse admission before the job is inspected.
      const importRejection = readTaskGenerationRejection(metadata, job.id);
      if (importRejection) {
        taskUpdate(orgId, taskId, {
          metadata: {
            ...metadata,
            generation_job_id: undefined,
            generation_status: "rejected",
            // Carried into the next generate_new attempt as corrective
            // guidance (buildGenerationPromptFromTaskRecommendation's
            // priorError), then cleared once consumed by startGenerationJob.
            generation_last_error: importRejection.message,
            ...appendGenerationAttempt(metadata, {
              phase: "import",
              code: importRejection.code,
              class: "deterministic",
              input_hash: importRejection.artifact_hash,
              revision: importRejection.validator_revision,
              guidance: importRejection.message,
            }),
          },
        }, namespaceId);
        void triggerAutoRunScan(namespaceId, orgId);
        return {
          triggered: false,
          taskId,
          action: "generation_rejected_regenerating",
          error: `Generation contract rejected: ${importRejection.message}`,
        };
      }

      const message = job.error || "Chain generation job failed";
      const nextRetries = Math.min(
        MAX_AUTO_RUN_RETRIES,
        ((metadata.auto_run_retries as number) || 0) + 1,
      );
      taskUpdate(orgId, taskId, {
        metadata: {
          ...metadata,
          generation_job_id: undefined,
          generation_status: "failed",
          auto_run_retries: nextRetries,
          // Carried into the next generate_new attempt (see
          // buildGenerationPromptFromTaskRecommendation's priorError param
          // in autoAcceptRecommendation below) as corrective guidance, then
          // cleared once consumed by startGenerationJob. This is what turns
          // the existing bounded auto_run_retries loop into a GUIDED retry
          // instead of a blind repeat of the same prompt (CHOR-001).
          generation_last_error: message,
          ...appendGenerationAttempt(metadata, {
            phase: "generation",
            code: "generation_job_failed",
            class: "transient",
            guidance: message,
          }),
        },
      }, namespaceId);
      if (nextRetries < MAX_AUTO_RUN_RETRIES) {
        void triggerAutoRunScan(namespaceId, orgId);
      }
      return {
        triggered: false,
        taskId,
        error: `Generation job failed: ${message}`,
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
    const claimed = analysisJobId.startsWith(JOB_CLAIM_PREFIX);
    const claimedRecovery = claimed
      ? recoverClaimedJob({
          taskId,
          metadata,
          jobKey: "analysis_job_id",
          statusKey: "analysis_status",
          claimedAtKey: "analysis_job_claimed_at",
          jobType: "recommend",
          namespaceId,
          orgId,
        })
      : undefined;
    if (claimed && !claimedRecovery?.job) {
      return {
        triggered: false,
        taskId,
        action: claimedRecovery?.expired ? "analysis_claim_expired" : "analysis_pending",
        jobId: analysisJobId,
      };
    }

    const job = claimedRecovery?.job ?? getJob(analysisJobId, namespaceId);
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
        jobId: job.id,
      };
    }

    if (job.status === "failed") {
      // clear the failed job so next run tries again
      taskUpdate(orgId, taskId, {
        metadata: {
          ...metadata,
          analysis_job_id: undefined,
          analysis_status: "failed",
          auto_run_retries: ((metadata.auto_run_retries as number) || 0) + 1,
        },
      }, namespaceId);
      return {
        triggered: false,
        taskId,
        error: `Analysis job failed: ${job.error}`,
      };
    }

    if (job.status === "complete") {
      // Envelope-aware: a recommend job hydrated from a completed run's
      // generation-result.json artifact (job-store.ts readCompletedRunResult
      // via isGenerationArtifactJob, which matches BOTH "generate" and
      // "recommend") wraps the agent payload as { output: "<json string>" }.
      // The pre-fix check `job.result?.recommendation` is undefined for that
      // envelope, so control fell through to case 4 and re-launched a fresh
      // chain-recommendation run on every scan even though the recommendation
      // already completed (TASK-097). resolveJobRecommendation handles the
      // normal, enveloped-bare, and enveloped-wrapped shapes.
      const recommendation = resolveJobRecommendation(job.result);
      if (recommendation) {
        return await autoAcceptRecommendation(
          taskId,
          task.title,
          metadata,
          recommendation,
          namespaceId,
          orgId,
          request,
          workspacePath
        );
      }

      // Completed but unreadable (a lone { output } envelope that failed to
      // parse, an empty object, or a payload with no recommendation keys).
      // Mirror the failed-branch just above: clear the job ref, mark it
      // unreadable, and count a retry so MAX_AUTO_RUN_RETRIES eventually trips
      // even if the envelope handling ever regresses. A completed analysis job
      // must NOT silently fall through to case 4 and relaunch every scan.
      taskUpdate(orgId, taskId, {
        metadata: {
          ...metadata,
          analysis_job_id: undefined,
          analysis_status: "unreadable",
          auto_run_retries: ((metadata.auto_run_retries as number) || 0) + 1,
        },
      }, namespaceId);
      return { triggered: false, taskId, action: "analysis_unreadable", jobId: analysisJobId };
    }
  }

  // case 4: no chain, no pending job — start analysis
  return await startAnalysisJob(taskId, metadata, namespaceId, orgId, request, workspacePath, task);
}

interface ExecuteDirectlyGate {
  claim_id?: string;
  claimed_at?: string;
  decision_id?: string;
  decision_task_id?: string;
  research_state?: "created" | "starting" | "started";
  research_claimed_at?: string;
  /** Stable idempotency key for this decision's one autonomous research launch. */
  research_fingerprint?: string;
  /** Persisted after dispatch; crash recovery can also derive it from provenance. */
  research_run_id?: string;
}

function readExecuteDirectlyGate(metadata: Record<string, unknown>): ExecuteDirectlyGate | null {
  const raw = asPlainObject(metadata[EXECUTE_DIRECTLY_GATE_KEY]);
  return raw ? raw as ExecuteDirectlyGate : null;
}

function isOlderThan(value: unknown, maxAgeMs: number): boolean {
  const timestamp = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isNaN(timestamp) || Date.now() - timestamp >= maxAgeMs;
}

function decisionResearchFingerprint(decisionId: string): string {
  // decisionId + phase are immutable run provenance. The fingerprint is stable
  // across retries/restarts, unlike a request id or a wall-clock claim token.
  return `auto-run-execute-directly:${decisionId}:research`;
}

interface DecisionResearchRun {
  id: string;
  started?: string;
  status?: string;
}

/**
 * Recover the one decision-research run for this gate before considering a
 * relaunch. New runs carry the fingerprint. The provenance fallback covers the
 * tiny crash window after chain creation but before this route tags run.json:
 * decisionId + decisionPhase is the dispatcher's immutable identity tuple.
 */
function findDecisionResearchRun(
  namespaceId: string,
  orgId: string,
  decisionId: string,
  fingerprint: string,
  expectedRunId?: string
): DecisionResearchRun | null {
  const runsDir = resolveLinkRunsDir(namespaceId, orgId);
  if (!existsSync(runsDir)) return null;

  const matches: DecisionResearchRun[] = [];
  for (const dir of readdirSync(runsDir)) {
    if (!dir.startsWith("run-")) continue;
    if (expectedRunId && dir !== expectedRunId) continue;
    const runPath = join(runsDir, dir, "run.json");
    if (!existsSync(runPath)) continue;
    try {
      const run = JSON.parse(readFileSync(runPath, "utf8")) as Record<string, unknown>;
      const metadata = asPlainObject(run.metadata);
      if (!metadata) continue;
      const exactFingerprint = metadata.auto_run_decision_research_fingerprint === fingerprint;
      const provenanceMatch = metadata.decisionId === decisionId && metadata.decisionPhase === "research";
      if (!exactFingerprint && !provenanceMatch) continue;
      matches.push({
        id: typeof run.id === "string" ? run.id : dir,
        started: typeof run.started === "string" ? run.started : undefined,
        status: typeof run.status === "string" ? run.status : undefined,
      });
    } catch {
      /* ignore a partial/corrupt run record and retry next scan */
    }
  }
  matches.sort((a, b) => Date.parse(b.started || "") - Date.parse(a.started || "") || b.id.localeCompare(a.id));
  return matches[0] ?? null;
}

function tagDecisionResearchRun(
  namespaceId: string,
  orgId: string,
  runId: string,
  fingerprint: string,
): void {
  const runJsonPath = join(resolveLinkRunsDir(namespaceId, orgId), runId, "run.json");
  if (!existsSync(runJsonPath)) return;
  try {
    withRunJsonLock(runJsonPath, () => {
      const run = JSON.parse(readFileSync(runJsonPath, "utf8")) as Record<string, unknown>;
      const metadata = asPlainObject(run.metadata) ?? {};
      if (metadata.auto_run_decision_research_fingerprint === fingerprint) return;
      writeRunJsonAtomic(runJsonPath, {
        ...run,
        metadata: { ...metadata, auto_run_decision_research_fingerprint: fingerprint },
      });
    });
  } catch {
    // The provenance fallback above still makes the launch recoverable.
  }
}

async function persistRecoveredDecisionResearch(input: {
  namespaceId: string;
  orgId: string;
  workspacePath?: string;
  decisionId: string;
  runId: string;
  fingerprint: string;
}): Promise<void> {
  tagDecisionResearchRun(input.namespaceId, input.orgId, input.runId, input.fingerprint);
  try {
    await updateDecision(input.namespaceId, input.orgId, input.decisionId, {
      status: "researching",
      researchRunId: input.runId,
      activeJobId: undefined,
    }, input.workspacePath);
  } catch {
    // The gate owns recovery; decision metadata is a helpful mirror only.
  }
}

function persistExecuteDirectlyGate(input: {
  orgId: string;
  taskId: string;
  namespaceId: string;
  metadata: Record<string, unknown>;
  gate: ExecuteDirectlyGate | undefined;
  status?: string;
  reasoning?: string;
}): boolean {
  try {
    const current = taskMetadataForUpdate(input.orgId, input.taskId, input.namespaceId, input.metadata);
    taskUpdate(input.orgId, input.taskId, {
      ...(input.status ? { status: input.status } : {}),
      metadata: {
        ...current,
        analysis_status: "accepted",
        chain_recommendation_action: "execute_directly",
        chain_recommendation_reason: input.reasoning,
        [EXECUTE_DIRECTLY_GATE_KEY]: input.gate,
      },
    }, input.namespaceId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates exactly one durable decision gate per execute_directly recommendation.
 * The task-owned claim wins concurrent scans; every later phase is resumable from
 * task metadata, so a failure leaves the parent open for retry rather than blocked
 * on an unprepared or duplicate decision.
 */
async function ensureExecuteDirectlyDecisionGate(input: {
  taskId: string;
  taskTitle: string;
  metadata: Record<string, unknown>;
  reasoning?: string;
  namespaceId: string;
  orgId: string;
  request: NextRequest;
  workspacePath?: string;
}): Promise<TriggerResult> {
  let gate = readExecuteDirectlyGate(input.metadata);
  let ownsClaim = false;
  if (!gate) {
    const claim: ExecuteDirectlyGate = {
      claim_id: newAutoRunClaimId(),
      claimed_at: new Date().toISOString(),
    };
    ownsClaim = taskClaimMetadataKeyIfUnset(input.orgId, input.taskId, EXECUTE_DIRECTLY_GATE_KEY, {
      [EXECUTE_DIRECTLY_GATE_KEY]: claim,
    }, input.namespaceId);
    if (!ownsClaim) {
      return { triggered: false, taskId: input.taskId, action: "decision_gate_pending" };
    }
    gate = claim;
  }

  let decision = null as ReturnType<typeof listDecisions>[number] | null;
  if (gate.decision_id && gate.decision_task_id) {
    decision = listDecisions(input.namespaceId, input.orgId, input.workspacePath)
      .find((candidate) => candidate.id === gate?.decision_id) ?? null;
    if (!decision && gate.research_state !== "started") {
      // No decision record means nothing user-visible is being held. Clear the
      // durable gate so the next scan can claim and recreate it safely.
      persistExecuteDirectlyGate({ ...input, gate: undefined });
      return { triggered: false, taskId: input.taskId, action: "decision_gate_missing" };
    }
  } else {
    const recovered = listDecisions(input.namespaceId, input.orgId, input.workspacePath)
      .find((candidate) =>
        candidate.source === "auto-run-execute-directly" &&
        candidate.parentTaskId === input.taskId &&
        typeof candidate.taskId === "string"
      ) ?? null;
    if (recovered?.taskId) {
      decision = recovered;
      gate = {
        ...gate,
        decision_id: recovered.id,
        decision_task_id: recovered.taskId,
        research_state: gate.research_state ?? "created",
      };
      if (!persistExecuteDirectlyGate({ ...input, gate })) {
        return { triggered: false, taskId: input.taskId, action: "decision_gate_pending" };
      }
    } else if (!ownsClaim) {
      if (isOlderThan(gate.claimed_at, EXECUTE_DIRECTLY_GATE_STALE_MS)) {
        persistExecuteDirectlyGate({ ...input, gate: undefined });
        return { triggered: false, taskId: input.taskId, action: "decision_gate_claim_expired" };
      }
      return { triggered: false, taskId: input.taskId, action: "decision_gate_pending" };
    } else {
      const prompt = `Task "${input.taskTitle}" needs action, but the chain recommender found no orchestration chain fits (verdict: execute directly). How should this be handled?${input.reasoning ? `\n\nRecommender reasoning: ${input.reasoning}` : ""}`;
      try {
        const created = await createTaskDecision({
          namespaceId: input.namespaceId,
          orgId: input.orgId,
          prompt,
          source: "auto-run-execute-directly",
          workspacePath: input.workspacePath,
          parentTaskId: input.taskId,
        });
        decision = created.decision;
        gate = {
          ...gate,
          decision_id: created.decision.id,
          decision_task_id: created.task.id,
          research_state: "created",
        };
        if (!persistExecuteDirectlyGate({ ...input, gate })) {
          // The claim remains; a later scan recovers this exact decision by
          // source + parent instead of creating another one.
          return { triggered: false, taskId: input.taskId, action: "decision_gate_pending" };
        }
      } catch (error) {
        // No parent dependency/status was written. Release only the task claim
        // so the normal poller can retry instead of leaving a hidden block.
        persistExecuteDirectlyGate({ ...input, gate: undefined });
        return {
          triggered: false,
          taskId: input.taskId,
          action: "decision_gate_failed",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  const decisionTaskId = gate.decision_task_id;
  if (!decisionTaskId) {
    return { triggered: false, taskId: input.taskId, action: "decision_gate_pending" };
  }

  if (gate.research_state !== "started") {
    if (!decision) {
      decision = listDecisions(input.namespaceId, input.orgId, input.workspacePath)
        .find((candidate) => candidate.id === gate?.decision_id) ?? null;
    }
    if (!decision) {
      persistExecuteDirectlyGate({ ...input, gate: undefined });
      return { triggered: false, taskId: input.taskId, action: "decision_gate_missing" };
    }

    const researchFingerprint = gate.research_fingerprint ?? decisionResearchFingerprint(decision.id);
    // Before relaunching an expired `starting` claim, recover the exact
    // decision/phase run. This closes the crash window after startDecisionResearch
    // created run.json but before this route persisted `research_state: started`.
    const recoveredRun = findDecisionResearchRun(
      input.namespaceId,
      input.orgId,
      decision.id,
      researchFingerprint,
      gate.research_run_id,
    );
    if (recoveredRun) {
      await persistRecoveredDecisionResearch({
        namespaceId: input.namespaceId,
        orgId: input.orgId,
        workspacePath: input.workspacePath,
        decisionId: decision.id,
        runId: recoveredRun.id,
        fingerprint: researchFingerprint,
      });
      gate = {
        ...gate,
        research_fingerprint: researchFingerprint,
        research_run_id: recoveredRun.id,
        research_state: "started",
        research_claimed_at: undefined,
      };
      if (!persistExecuteDirectlyGate({ ...input, gate })) {
        return { triggered: false, taskId: input.taskId, action: "decision_gate_pending" };
      }
    } else if (gate.research_state === "starting" && !isOlderThan(gate.research_claimed_at, EXECUTE_DIRECTLY_GATE_STALE_MS)) {
      return { triggered: false, taskId: input.taskId, action: "decision_research_pending" };
    } else {
      gate = {
        ...gate,
        research_fingerprint: researchFingerprint,
        research_state: "starting",
        research_claimed_at: new Date().toISOString(),
      };
      if (!persistExecuteDirectlyGate({ ...input, gate })) {
        return { triggered: false, taskId: input.taskId, action: "decision_gate_pending" };
      }
      const prompt = `Task "${input.taskTitle}" needs action, but the chain recommender found no orchestration chain fits (verdict: execute directly). How should this be handled?${input.reasoning ? `\n\nRecommender reasoning: ${input.reasoning}` : ""}`;
      try {
        const { startDecisionResearch } = await import("@/lib/decisions/decision-chain-dispatch");
        const started = await startDecisionResearch({
          request: input.request,
          namespaceId: input.namespaceId,
          orgId: input.orgId,
          decision,
          userPrompt: prompt,
          workspacePath: input.workspacePath,
        });
        if (!started?.runId) {
          throw new Error("Decision research did not return a run id");
        }
        await persistRecoveredDecisionResearch({
          namespaceId: input.namespaceId,
          orgId: input.orgId,
          workspacePath: input.workspacePath,
          decisionId: decision.id,
          runId: started.runId,
          fingerprint: researchFingerprint,
        });
        gate = {
          ...gate,
          research_fingerprint: researchFingerprint,
          research_run_id: started.runId,
          research_state: "started",
          research_claimed_at: undefined,
        };
        if (!persistExecuteDirectlyGate({ ...input, gate })) {
          return { triggered: false, taskId: input.taskId, action: "decision_gate_pending" };
        }
      } catch (error) {
        // Keep the durable decision link but do not block the parent. The next
        // poll retries only after proving the claimed run was not created.
        persistExecuteDirectlyGate({
          ...input,
          gate: { ...gate, research_state: "created", research_claimed_at: undefined },
        });
        return {
          triggered: false,
          taskId: input.taskId,
          action: "decision_research_failed",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  try {
    taskAddDep(input.orgId, input.taskId, decisionTaskId, input.namespaceId, input.workspacePath);
  } catch (error) {
    // Research is prepared, but the parent is still open and therefore will
    // retry attaching the same idempotent dependency on the next scan.
    return {
      triggered: false,
      taskId: input.taskId,
      action: "decision_gate_attach_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (!persistExecuteDirectlyGate({ ...input, gate, status: "blocked" })) {
    // taskAddDep is the real gate and the parent remains open if this write
    // failed; resolution will still unblock it. Do not invent a silent block.
    return { triggered: false, taskId: input.taskId, action: "decision_gate_prepared" };
  }
  return { triggered: false, taskId: input.taskId, action: "execute_directly_decision", reason: input.reasoning };
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

  // Persist the recommender's work_mode onto the task so the completion-audit
  // delivery gate reads authoritative intent even for tasks NOT created via
  // task-generation (this is auto-run's dominant path). Fill it in only when
  // unset — never override a work_mode the task already carries.
  if (isTaskWorkMode(normalized.work_mode) && !isTaskWorkMode((metadata as Record<string, unknown>).work_mode)) {
    metadata = { ...metadata, work_mode: normalized.work_mode };
    try {
      taskUpdate(orgId, taskId, { metadata }, namespaceId);
    } catch {
      /* non-fatal: the gate falls back to the issue_type heuristic */
    }
  }

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
    // A previous generate attempt's rejection (see the job.status === "failed"
    // branch above), if any -- carried forward as corrective guidance for
    // this bounded retry. Consumed here so it applies to exactly one
    // regeneration, not every future attempt (see startGenerationJob, which
    // clears it once the job is dispatched).
    const priorError = typeof metadata.generation_last_error === "string"
      ? metadata.generation_last_error
      : undefined;
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
        normalized,
        priorError
      ),
      namespaceId,
      orgId,
      request,
      workspacePath
    );
  }

  if (action === "execute_directly") {
    return await ensureExecuteDirectlyDecisionGate({
      taskId,
      taskTitle,
      metadata,
      reasoning: normalized.reasoning,
      namespaceId,
      orgId,
      request,
      workspacePath,
    });
  }

  if (action === "no_action_needed") {
    // The recommender determined nothing needs doing -> the task IS complete. CLOSE it
    // (don't just disable auto-run and dead-end) so its dependents unblock and the cascade
    // continues -- then fire the dependents-only nudge, exactly like any completion.
    const updated = {
      ...metadata,
      auto_run: false,
      analysis_status: "accepted",
      chain_recommendation_action: "no_action_needed",
      chain_recommendation_reason: normalized.reasoning,
    };
    try {
      taskUpdate(orgId, taskId, { status: "closed", metadata: updated }, namespaceId);
    } catch {
      /* non-fatal */
    }
    void triggerAutoRunScan(namespaceId, orgId, taskId);
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
  const generated = extractGeneratedChainResult(result);
  if (!generated) {
    const nextRetries = Math.min(
      MAX_AUTO_RUN_RETRIES,
      ((metadata.auto_run_retries as number) || 0) + 1,
    );
    taskUpdate(orgId, taskId, {
      metadata: {
        ...metadata,
        generation_job_id: undefined,
        generation_status: "failed",
        generation_last_error: INVALID_GENERATED_CHAIN_RESULT_ERROR,
        auto_run_retries: nextRetries,
        ...appendGenerationAttempt(metadata, {
          phase: "recovery",
          code: "invalid_generated_chain_result",
          class: "transient",
          guidance: INVALID_GENERATED_CHAIN_RESULT_ERROR,
        }),
      },
    }, namespaceId);
    if (nextRetries < MAX_AUTO_RUN_RETRIES) {
      void triggerAutoRunScan(namespaceId, orgId);
    }
    return {
      triggered: false,
      taskId,
      error: INVALID_GENERATED_CHAIN_RESULT_ERROR,
    };
  }

  const chain = sanitizeGeneratedChain(generated);

  // A4: before resubmitting to save, check the shared rejection ledger for
  // BOTH candidate forms -- the raw extracted artifact (what the import door
  // hashed) and the sanitized save candidate (what the save door hashed). This
  // is what stops the artifact-recovery loop: a previously rejected generation
  // artifact recovered from run artifacts would otherwise traverse save and
  // fail identically on every scan.
  for (const artifactHash of new Set([
    canonicalGeneratedChainHash(generated),
    canonicalGeneratedChainHash(chain),
  ])) {
    const prior = findGeneratedChainRejection(namespaceId, orgId, artifactHash);
    if (prior) {
      return handleDeterministicRejection({
        taskId,
        metadata,
        namespaceId,
        orgId,
        envelope: { ...prior, phase: "recovery", at: new Date().toISOString() },
      });
    }
  }

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
    const payload = await saveRes.json().catch(() => ({}));

    // Typed deterministic rejection from the save contract gate: apply the
    // fingerprint policy (one guided regeneration, then stop) instead of the
    // transient retry budget.
    const rejection = readRejectionEnvelopeFromSavePayload(payload);
    if (rejection) {
      return handleDeterministicRejection({
        taskId,
        metadata,
        namespaceId,
        orgId,
        envelope: rejection,
      });
    }

    const message = generatedChainSaveFailureMessage(payload, saveRes.status);
    const nextRetries = Math.min(
      MAX_AUTO_RUN_RETRIES,
      ((metadata.auto_run_retries as number) || 0) + 1,
    );
    taskUpdate(orgId, taskId, {
      metadata: {
        ...metadata,
        generation_job_id: undefined,
        generation_status: "failed",
        generation_last_error: message,
        auto_run_retries: nextRetries,
        ...appendGenerationAttempt(metadata, {
          phase: "save",
          code: "save_failed",
          class: "transient",
          guidance: message,
        }),
      },
    }, namespaceId);
    if (nextRetries < MAX_AUTO_RUN_RETRIES) {
      void triggerAutoRunScan(namespaceId, orgId);
    }
    return {
      triggered: false,
      taskId,
      action: "generation_save_failed",
      error: message,
      retryCount: nextRetries,
      retryLimit: MAX_AUTO_RUN_RETRIES,
      recoveryScheduled: nextRetries < MAX_AUTO_RUN_RETRIES,
    };
  }

  const updated = {
    ...metadata,
    chain_id: chainId,
    chain_name: chainName,
    generation_job_id: undefined,
    generation_status: "accepted",
    analysis_status: "accepted",
    // A successful acceptance closes this generation loop: clear the
    // deterministic-rejection attempt state so an unrelated future
    // regeneration starts with a fresh allowance.
    generation_rejection: undefined,
    generation_rejection_job_id: undefined,
    generation_rejection_fingerprints: undefined,
    generation_stop_reason: undefined,
    // The ledger keeps the full attempt history across the cleared retry
    // state: it is the record of what happened, not a retry counter (B7).
    ...appendGenerationAttempt(metadata, {
      phase: "save",
      code: "accepted",
      class: "success",
      input_hash: canonicalGeneratedChainHash(chain),
    }),
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
  const claimId = newAutoRunClaimId();
  const claimed = taskClaimMetadataKeyIfUnset(orgId, taskId, "generation_job_id", {
    generation_job_id: claimId,
    generation_status: "starting",
    generation_job_claimed_at: new Date().toISOString(),
    analysis_status: "accepted",
    // Consumed (folded into `prompt` by the caller) -- clear it so a later,
    // unrelated generation attempt for this task doesn't inherit stale
    // guidance from an already-resolved failure.
    generation_last_error: undefined,
  }, namespaceId, {
    metadataNumberLessThan: {
      key: "auto_run_retries",
      value: MAX_AUTO_RUN_RETRIES,
    },
  });

  if (!claimed) {
    return {
      triggered: false,
      taskId,
      action: "generation_pending",
    };
  }

  const jobRes = await fetch(internalApiUrl("/api/jobs", request.url), {
    method: "POST",
    headers: forwardedHeaders(request, namespaceId, orgId, {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      type: "generate",
      taskId,
      input: { prompt, workspacePath, namespaceId, orgId, auto_run_claim_id: claimId },
    }),
  });

  if (!jobRes.ok) {
    const err = await jobRes.json().catch(() => ({}));
    taskUpdate(orgId, taskId, {
      metadata: {
        ...metadata,
        generation_job_id: undefined,
        generation_status: "failed",
        generation_job_claimed_at: undefined,
        analysis_status: "accepted",
        auto_run_retries: ((metadata.auto_run_retries as number) || 0) + 1,
      },
    }, namespaceId);
    return { triggered: false, taskId, error: (err as { error?: string }).error || "Failed to start generation" };
  }

  const jobData = await jobRes.json();
  const generationJobId = jobData.data?.jobId || jobData.jobId;
  if (typeof generationJobId !== "string" || !generationJobId) {
    taskUpdate(orgId, taskId, {
      metadata: {
        ...metadata,
        generation_job_id: undefined,
        generation_status: "failed",
        generation_job_claimed_at: undefined,
        analysis_status: "accepted",
        auto_run_retries: ((metadata.auto_run_retries as number) || 0) + 1,
      },
    }, namespaceId);
    return { triggered: false, taskId, error: "Generation response did not include a job id" };
  }
  try {
    const current = taskMetadataForUpdate(orgId, taskId, namespaceId, metadata);
    taskUpdate(orgId, taskId, {
      metadata: {
        ...current,
        generation_job_id: generationJobId,
        generation_status: "running",
        generation_job_claimed_at: undefined,
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

  // Pre-dispatch delivery gate: if this task's authoritative work_mode needs an
  // implementing agent (delivery/operations) but the bound chain has none, running
  // it would only waste a run and trip the post-hoc gate into a held decision.
  // Clear the binding + count a retry so the next scan re-analyzes and produces a
  // capable chain (self-heal), instead of running a chain that cannot deliver. This
  // closes the use_existing hole (a catalog chain assigned with no authority check)
  // and backstops a generated chain that omitted its writer. Fail-open: a research
  // or unset work_mode, or a chain that HAS the authority, runs unchanged. Bounded
  // by the auto_run_retries cap. Mirrors the chain-deleted self-heal above.
  const preDispatchWorkMode = resolveTaskWorkMode(metadata);
  if ((preDispatchWorkMode === "delivery" || preDispatchWorkMode === "operations")
      && !chainHasDeliveryAgent(chain, preDispatchWorkMode)) {
    const neededAuthority = preDispatchWorkMode === "operations" ? "run_commands" : "edit_files";
    try {
      taskUpdate(orgId, taskId, {
        metadata: {
          ...metadata,
          chain_id: undefined,
          chain_name: undefined,
          auto_run_retries: ((metadata.auto_run_retries as number) || 0) + 1,
          generation_last_error: `The bound chain "${chainId}" has no agent with ${neededAuthority} authority, but this ${preDispatchWorkMode} task requires one. Generate a ${preDispatchWorkMode}-capable chain with an implementing agent.`,
        },
      }, namespaceId);
    } catch { /* non-fatal */ }
    return {
      triggered: false,
      taskId,
      error: `Bound chain ${chainId} lacks ${neededAuthority} authority for this ${preDispatchWorkMode} task; binding cleared for re-analysis.`,
    };
  }

  // A task-linked run must claim its exact data root before dispatch. The
  // chain endpoint receives this same immutable scope and writes it into the
  // run record; readers never have to infer a root from the current session.
  const runId = `run-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const taskRunScope = createTaskRunScope({
    version: 1,
    taskId,
    runId,
    namespaceId,
    orgId,
  });
  const launchMetadata = {
    ...executionStartedLifecycleMetadata({
      taskId,
      metadata: taskMetadataForUpdate(orgId, taskId, namespaceId, metadata),
      runId,
      chainId,
    }),
    [TASK_RUN_SCOPE_METADATA_KEY]: taskRunScope,
    auto_run_retries: 0,
  };
  try {
    taskUpdate(orgId, taskId, {
      status: "in_progress",
      metadata: launchMetadata,
    }, namespaceId);
  } catch {
    // Starting without a durable task->run claim recreates the scope ambiguity
    // this contract removes, so fail before dispatch instead of guessing later.
    return { triggered: false, taskId, error: "Failed to persist task run scope" };
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
      runId,
      metadata: {
        [TASK_RUN_SCOPE_METADATA_KEY]: taskRunScope,
      },
      ...(workspacePath ? { workspacePath } : {}),
      ...(taskMetadata?.workspace_id ? { workspaceId: taskMetadata.workspace_id } : {}),
    }),
  });

  if (!runRes.ok) {
    const err = await runRes.json().catch(() => ({}));
    const rawError = (err as { error?: unknown }).error;
    const errorRecord = rawError && typeof rawError === "object" && !Array.isArray(rawError)
      ? rawError as Record<string, unknown>
      : undefined;
    const errorDetails = errorRecord?.details && typeof errorRecord.details === "object" && !Array.isArray(errorRecord.details)
      ? errorRecord.details as Record<string, unknown>
      : undefined;
    const validationErrors = Array.isArray(errorDetails?.errors)
      ? errorDetails.errors.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const baseMessage = typeof rawError === "string"
      ? rawError
      : typeof errorRecord?.message === "string"
        ? errorRecord.message
        : "Failed to start run";
    const message = validationErrors.length > 0
      ? `${baseMessage}: ${validationErrors.join("; ")}`
      : baseMessage;
    return recordTaskRunLaunchFailure({
      taskId,
      namespaceId,
      orgId,
      metadata,
      scope: taskRunScope,
      message,
    });
  }

  const runData = await runRes.json();

  if (runData?.data?.runId !== runId) {
    return recordTaskRunLaunchFailure({
      taskId,
      namespaceId,
      orgId,
      metadata,
      scope: taskRunScope,
      message: "Chain run did not confirm the requested task run id",
    });
  }

  return {
    triggered: true,
    taskId,
    runId,
    action: "chain_run",
  };
}

/**
 * A rejected launch has no durable run to reconcile. Remove the provisional
 * task-run scope, retain the attempted scope as diagnostic evidence, and block
 * automatic admission until a human explicitly resolves the launch failure.
 */
function recordTaskRunLaunchFailure(input: {
  taskId: string;
  namespaceId: string;
  orgId: string;
  metadata: Record<string, unknown>;
  scope: ReturnType<typeof createTaskRunScope>;
  message: string;
}): TriggerResult {
  try {
    taskUpdate(input.orgId, input.taskId, {
      status: "blocked",
      metadata: taskRunLaunchFailureMetadata({
        metadata: input.metadata,
        scope: input.scope,
        message: input.message,
      }),
    }, input.namespaceId);
    return {
      triggered: false,
      taskId: input.taskId,
      action: "task_run_launch_failed",
      error: input.message,
    };
  } catch {
    return {
      triggered: false,
      taskId: input.taskId,
      action: "task_run_launch_failure_unpersisted",
      error: `${input.message}; failed to persist launch failure state`,
    };
  }
}

async function startAnalysisJob(
  taskId: string,
  metadata: Record<string, unknown>,
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
  // Claim before dispatch so a persistence failure after /api/jobs creates the
  // real job cannot make a later scan submit a duplicate recommendation run.
  const claimId = newAutoRunClaimId();
  const claimed = taskClaimMetadataKeyIfUnset(orgId, taskId, "analysis_job_id", {
    analysis_job_id: claimId,
    analysis_status: "starting",
    analysis_job_claimed_at: new Date().toISOString(),
  }, namespaceId);
  if (!claimed) {
    return { triggered: false, taskId, action: "analysis_pending" };
  }

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
        auto_run_claim_id: claimId,
      },
    }),
  });

  if (!jobRes.ok) {
    const err = await jobRes.json().catch(() => ({}));
    try {
      taskUpdate(orgId, taskId, {
        metadata: {
          ...metadata,
          analysis_job_id: undefined,
          analysis_status: "failed",
          analysis_job_claimed_at: undefined,
          auto_run_retries: ((metadata.auto_run_retries as number) || 0) + 1,
        },
      }, namespaceId);
    } catch {
      /* a stale pre-dispatch claim is recoverable on the next scan */
    }
    return { triggered: false, taskId, error: (err as { error?: string }).error || "Failed to start analysis" };
  }

  const jobData = await jobRes.json();
  const analysisJobId2 = jobData.data?.jobId || jobData.jobId;
  if (typeof analysisJobId2 !== "string" || !analysisJobId2) {
    try {
      taskUpdate(orgId, taskId, {
        metadata: {
          ...metadata,
          analysis_job_id: undefined,
          analysis_status: "failed",
          analysis_job_claimed_at: undefined,
          auto_run_retries: ((metadata.auto_run_retries as number) || 0) + 1,
        },
      }, namespaceId);
    } catch {
      /* a stale pre-dispatch claim is recoverable on the next scan */
    }
    return { triggered: false, taskId, error: "Analysis response did not include a job id" };
  }

  // Persist the discovered job. If this write fails, the claim remains and
  // recoverClaimedJob finds this exact job by `auto_run_claim_id` next tick.
  try {
    const existing = taskMetadataForUpdate(orgId, taskId, namespaceId, metadata);

    taskUpdate(orgId, taskId, {
      metadata: {
        ...existing,
        analysis_job_id: analysisJobId2,
        analysis_status: "running",
        analysis_job_claimed_at: undefined,
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
// A crashed/orphaned run whose session died mid-agent keeps status "running" with a
// non-terminal agent forever (the runner-v2 monitor never got to mark it) -- it then
// permanently holds a concurrency slot in countActiveRuns AND blocks its own task via
// findActiveRunForTask, so the whole auto-run pipeline deadlocks (observed: 4 runs stuck
// "running" for 10-12h jamming the cap at 4/5). This is a self-healing watchdog: any
// running/pending run with no agent liveness for DEAD_RUN_STALE_MS is terminalized so
// the slot frees and the next reconcile audits it back onto its task. Threshold is 45m
// -- >4x the 10-min agent heartbeat cadence and far beyond any run.json write gap, so a
// slow-but-live agent is never reaped.
const DEAD_RUN_STALE_MS = 45 * 60 * 1000;
const TERMINAL_AGENT_STATUSES = new Set([
  "complete", "completed", "failed", "cancelled", "canceled", "skipped", "stopped", "done", "error",
]);

function runLastActivityMs(rj: Record<string, unknown>, runJsonPath: string): number {
  let latest = 0;
  const consider = (v: unknown) => {
    if (typeof v === "string") {
      const t = Date.parse(v);
      if (!Number.isNaN(t)) latest = Math.max(latest, t);
    } else if (typeof v === "number" && v > 0) {
      latest = Math.max(latest, v < 1e12 ? v * 1000 : v);
    }
  };
  consider(rj.started); consider(rj.startedAt); consider(rj.resumedAt);
  consider(rj.updatedAt); consider(rj.blockedAt);
  const agents = Array.isArray(rj.agents) ? rj.agents : [];
  for (const a of agents) consider((a as Record<string, unknown>)?.lastHeartbeat);
  try { latest = Math.max(latest, statSync(runJsonPath).mtimeMs); } catch { /* ignore */ }
  return latest;
}

interface ReapedDeadRun {
  runId: string;
  taskId?: string;
}

/** Terminalize dead ("running"/"pending" but no liveness past DEAD_RUN_STALE_MS) runs so
 *  they stop jamming the concurrency cap and blocking their tasks. The exact
 *  task/run identities are returned so the same request can repair admission.
 *
 *  Consumes the request's RunsSnapshot: its active-run set is by construction
 *  the exact reap candidate set (running/pending, declared agents incomplete),
 *  so no second directory walk is needed. Liveness is still decided on CURRENT
 *  data -- runLastActivityMs stats the file live, and the terminalize itself
 *  re-reads and re-checks under the run.json lock. Reaped runs are pruned from
 *  the snapshot so the same request's admission sees post-reap state. */
function reapDeadRuns(snapshot: RunsSnapshot): ReapedDeadRun[] {
  const now = Date.now();
  const reaped: ReapedDeadRun[] = [];
  for (const record of [...snapshot.activeRuns]) {
    const p = record.runPath;
    try {
      const last = runLastActivityMs(record.raw, p);
      if (last > 0 && now - last <= DEAD_RUN_STALE_MS) continue; // still live
      let terminalized: ReapedDeadRun | undefined;
      withRunJsonLock(p, () => {
        const fresh = JSON.parse(readFileSync(p, "utf-8"));
        if (fresh.status !== "running" && fresh.status !== "pending") return; // raced to terminal
        if (now - runLastActivityMs(fresh, p) <= DEAD_RUN_STALE_MS) return; // became live under lock
        fresh.status = "failed";
        fresh.status_message = `reaped: no agent liveness for >${Math.round(DEAD_RUN_STALE_MS / 60000)}m (dead session); freed concurrency slot`;
        for (const a of (Array.isArray(fresh.agents) ? fresh.agents : [])) {
          if (!TERMINAL_AGENT_STATUSES.has(a.status)) a.status = "failed";
        }
        writeRunJsonAtomic(p, fresh);
        terminalized = {
          runId: typeof fresh.id === "string" ? fresh.id : record.active.id,
          taskId: typeof fresh.taskId === "string" ? fresh.taskId : undefined,
        };
      });
      if (terminalized) {
        reaped.push(terminalized);
        removeRunFromSnapshot(snapshot, terminalized.runId);
      }
    } catch { /* skip corrupt */ }
  }
  return reaped;
}

/**
 * `reapDeadRuns` rewrites run.json; admission reads the task row too. Keep the
 * two truths synchronized before candidate selection so a reaped `running` run
 * becomes a retryable failed attempt in this same polling tick.
 */
function reconcileReapedDeadRunTasks(
  orgId: string,
  namespaceId: string,
  reapedRuns: ReapedDeadRun[]
): number {
  let reconciled = 0;
  for (const reaped of reapedRuns) {
    if (!reaped.taskId) continue;
    const task = taskGet(orgId, reaped.taskId, namespaceId);
    if (!task || isTerminalTaskStatus(task.status)) continue;
    const metadata = parseTaskMetadata(task);
    // A newer live run must remain authoritative; the old reaped run cannot
    // overwrite its task metadata.
    if (
      typeof metadata.last_run_id === "string" &&
      metadata.last_run_id !== reaped.runId &&
      metadata.last_run_status === "running"
    ) {
      continue;
    }
    try {
      taskUpdate(orgId, reaped.taskId, {
        status: "in_progress",
        metadata: {
          ...metadata,
          last_run_id: reaped.runId,
          last_run_status: "failed",
          last_run_error: "reaped dead run: no agent liveness for >45m",
          last_run_completed: new Date().toISOString(),
        },
      }, namespaceId);
      reconciled += 1;
    } catch {
      // The failed run remains terminal; a later poll can retry metadata repair.
    }
  }
  return reconciled;
}
