/**
 * POST /api/runs/[id]/resume
 *
 * resumes a crashed/stopped run from where it left off, INSIDE the same run.
 * - claims the run exclusively before any read's side effects
 * - skips completed agents, resets running/stopped agents to pending
 * - finds the resume frontier (interrupted > trigger-eligible > first pending)
 * - records each attempt durably as run.json resumeAttempt
 *   (preparing -> accepted | failed); the ROUTE owns that outcome
 * - makes "run marked running + outcome accepted + queued routed launch job"
 *   ONE atomic run.json write, and never rolls it back afterwards
 * - relaunches the frontier agent through the typed routed-launch path under
 *   the original run ID and directory: no child run, no second run directory
 *
 * A 200 means durable acceptance of the resume, not successful agent
 * completion. Callers read run.resumeAttempt for the authoritative outcome;
 * they never infer it from the HTTP status alone.
 */

import { readFileSync, existsSync, openSync, closeSync, readdirSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import config, { nsPath, orgPath } from "@/lib/config";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { pty } from "@/lib/pty/pty-client";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { buildChildEnv } from "@/lib/runs/child-env";
import { buildLocalAiGatewayProxyEnv } from "@/lib/ai-gateway/local-proxy-env";
import { getSecretsEnvVars, resolveProfileEnvVars } from "@/lib/secrets/secrets-store";
import { getProfile } from "@/lib/agents/agent-profile-storage";
import { checkRunAccess } from "@/lib/auth/run-acl";
import { resolveLinkRunsDir } from "@/lib/links/link-run-runtime";
import { resolveInternalAuthSecret } from "@/lib/auth/internal-api-auth";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import { mintSessionToken } from "@/lib/auth/session-token";
import type { OrgRole } from "@/lib/orgs/org-types";
import { resolveInternalWebOrigin } from "@/lib/auth/internal-web-origin";
import { hasCompletedTrigger, routingContextForEvents, type RoutingAgent } from "@/lib/runner-v2/routing";
import { parseRunnerEvent, type RunnerEventRecord } from "@/lib/runner-v2/events";
import { NotFound, Conflict, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { collectStaleRunSessionNames } from "@/lib/runs/stale-run-sessions";
import { resolveResumeChainPath } from "@/lib/runs/resume-chain-path";
import { terminateRunProcess } from "@/lib/runs/run-process";
import { updateRunJson, type RunRecord } from "@/lib/runner-v2/run-state";
import {
  acquireExclusiveFileClaim,
  ExclusiveFileClaimBusyError,
} from "@/lib/runner-v2/file-claim";
import { upsertRoutedLaunchJobRecord, type RoutedLaunchJob } from "@/lib/runner-v2/launch-job";
import { taskGet } from "@/lib/tasks/task-store";
import {
  appendResumeHistory,
  RESUME_SOURCE_HEADER,
  currentResumeSeries,
  newResumeAttempt,
  projectConfirmedResumeFailure,
  readResumeAttempt,
  type ResumeAttemptRecord,
} from "@/lib/runs/resume-attempt";

export const dynamic = "force-dynamic";

interface RunAgent {
  id: string;
  name: string;
  status: string;
  session?: string;
  started?: string;
  completed?: string;
  blockedReason?: string;
  lastMessage?: string;
}

interface RunJson {
  id: string;
  chain: string;
  chainId?: string;
  goal?: string;
  started: string;
  status: string;
  completed?: string;
  agents: RunAgent[];
  sessions?: string[];
  taskId?: string;
  workspacePath?: string;
  debug?: boolean;
  [key: string]: unknown;
}

function readRoutingEvents(eventsDir: string, runId: string): RunnerEventRecord[] {
  const events: RunnerEventRecord[] = [];
  for (const directory of [eventsDir, join(eventsDir, "archive")]) {
    let files: string[];
    try {
      files = readdirSync(directory);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".event")) continue;
      try {
        const event = parseRunnerEvent(readFileSync(join(directory, file), "utf8"));
        if (event.runId === runId) events.push({ ...event, path: join(directory, file) });
      } catch {
        // Invalid physical files cannot prove a resume frontier.
      }
    }
  }
  return events;
}

/**
 * Mint the ops session the resumed agent needs for its first ops call (same
 * convention the web Run button path uses, chain-run-service
 * buildChainSessionEnv: jti `chain-<runId>`, ops:* scope). The requesting web
 * user is the identity when the request carries a session; internal callers
 * (the auto-run scan) get the headless "cli" identity direct-run uses.
 */
async function buildResumeSessionEnv(
  req: Request,
  nsId: string,
  orgId: string,
  runId: string
): Promise<Record<string, string>> {
  let sub = "cli";
  let role: OrgRole | undefined;
  try {
    const user = await getSessionUser(req);
    if (user?.id && user.namespaceId === nsId && (!user.orgId || user.orgId === orgId)) {
      sub = user.id;
      role = user.role;
    }
  } catch {
    // Internal/service-authenticated caller: fall back to the headless identity.
  }
  const sessionId = `chain-${runId}`;
  const sessionToken = await mintSessionToken({
    sub, jti: sessionId, ns: nsId, org: orgId,
    ...(role ? { role } : {}),
    scopes: ["ops:*"],
  });
  return {
    MENTIKO_SESSION_ID: sessionId,
    MENTIKO_SESSION_TOKEN: sessionToken,
    MENTIKO_WEB_URL: resolveInternalWebOrigin(new URL(req.url).origin),
  };
}

/** Durably record a confirmed failed outcome for this attempt (never a guess: only definitive, route-observed failures). */
function recordResumeFailure(
  runJsonPath: string,
  runId: string,
  attempt: ResumeAttemptRecord,
  reason: string,
): ResumeAttemptRecord {
  const failed: ResumeAttemptRecord = {
    ...attempt,
    outcome: "failed",
    reason,
    updatedAt: new Date().toISOString(),
  };
  updateRunJson(runJsonPath, (current) => {
    if (!current) throw new NotFound("Run", runId);
    return { ...current, resumeAttempt: failed };
  });
  return failed;
}

export const POST = withErrorHandling(async (
  req: Request,
  context: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(req as Parameters<typeof requirePermission>[0], "manage_chains");
  if (perm) return perm;

  const { id: runId } = await context.params;
  const nsId = await getNamespaceIdFromRequest(req);
  const orgId = await getOrgIdFromRequest(req);
  const runsDir = resolveLinkRunsDir(nsId, orgId);

  const acl = await checkRunAccess(req, runId, runsDir);
  if (!acl.ok) {
    if (acl.reason === "run-not-found") throw new NotFound("Run", runId);
    throw new Unauthorized();
  }

  const runDir = join(runsDir, runId);
  const runJsonPath = join(runDir, "run.json");

  if (!existsSync(runJsonPath)) {
    throw new NotFound("Run", runId);
  }

  // Single-winner resume claim, held before ANY read with side effects, the
  // stale-session cleanup, the transition to running, and the dispatch of the
  // launcher. Two concurrent resume requests for one run must never both run
  // cleanup: the loser of the claim can otherwise remove PTY sessions the
  // winner's fresh occurrence already reuses. A busy/already-running/completed
  // conflict is never a failed attempt. Same primitive existing-run-launch
  // uses for single-flight bootstrap. The loser returns 409 without touching
  // processes, sessions, or the run record.
  const claimDir = join(runDir, ".resume-claim");
  let releaseResumeClaim: () => void;
  try {
    releaseResumeClaim = acquireExclusiveFileClaim(claimDir, { waitTimeoutMs: 250, retryDelayMs: 20 });
  } catch (error) {
    if (error instanceof ExclusiveFileClaimBusyError) {
      throw new Conflict("A resume is already in progress for this run");
    }
    throw error;
  }

  // Only automatic attempts (the auto-run scanner) may debit task retries.
  const automatic = req.headers.get(RESUME_SOURCE_HEADER) === "auto-run";

  try {
    const run: RunJson = JSON.parse(readFileSync(runJsonPath, "utf-8"));

    // don't resume already running runs
    if (run.status === "running") {
      throw new Conflict("Run is already running");
    }

    // analyze agent states
    if (!run.agents.some((agent) => agent.status !== "complete")) {
      throw new Conflict("All agents already completed");
    }

    // Re-read task ownership, scope and retry series under the claim. The
    // series fences every outcome this attempt records: a reset (Retry task,
    // assign chain, auto-run enable) increments resume_series and invalidates
    // older outcomes.
    const taskId = typeof run.taskId === "string" && run.taskId ? run.taskId : undefined;
    const task = taskId ? taskGet(orgId, taskId, nsId) : undefined;
    const taskMetadata =
      task?.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata)
        ? task.metadata as Record<string, unknown>
        : undefined;
    const series = taskMetadata ? currentResumeSeries(taskMetadata) : 0;

    // Route entry first projects any unprojected terminal outcome of the
    // current series (issue #142): a failed attempt whose task CAS never
    // landed replays here, exactly once. A new attempt may not start until
    // this succeeds — otherwise failures could pile up unaccounted.
    const priorAttempt = readResumeAttempt({ resumeAttempt: (run as Record<string, unknown>).resumeAttempt });
    if (priorAttempt?.outcome === "failed" && taskMetadata) {
      const alreadyAccounted = taskMetadata.resume_accounted_attempt_id === priorAttempt.id;
      if (!alreadyAccounted) {
        const projection = projectConfirmedResumeFailure({
          orgId,
          namespaceId: nsId,
          taskId: taskId as string,
          runId,
          attempt: priorAttempt,
        });
        if (projection.status === "unwritten") {
          throw new Error(
            `resume failure accounting for task ${taskId} (attempt ${priorAttempt.id}) is pending; retry`,
          );
        }
      }
    }

    // Crash recovery: a preparing attempt from a dead claim owner is FINISHED,
    // never failed — resume preparation under the same attempt id and series.
    // A preparing attempt from a stale series (a reset landed meanwhile) is
    // superseded: start a fresh attempt on the new series.
    const reusePreparing =
      priorAttempt?.outcome === "preparing" && priorAttempt.series === series;
    const attempt: ResumeAttemptRecord = reusePreparing
      ? { ...(priorAttempt as ResumeAttemptRecord), automatic: automatic || undefined, taskId }
      : newResumeAttempt({ series, taskId, automatic });

    // Write preparing BEFORE any cleanup or validation side effect: the
    // durable record that an attempt is in flight, so a crash mid-preparation
    // is recoverable as this same attempt rather than an unknown state.
    updateRunJson(runJsonPath, (current) => {
      if (!current) throw new NotFound("Run", runId);
      if (current.status === "running") {
        throw new Conflict("Run is already running");
      }
      return {
        ...current,
        resumeAttempt: { ...attempt, outcome: "preparing", updatedAt: new Date().toISOString() },
      };
    });

    // find the chain file: the run's own snapshot first, the chains-dir copy
    // second. A record without chainId must resolve through its own snapshot,
    // never throw on join(chainsDir, undefined) (issue #142, TASK-010).
    const chainsDir = orgPath(nsId, orgId, "chains");
    const chainPath = resolveResumeChainPath({ runDir, chainId: run.chainId, chainsDir });

    if (!chainPath) {
      // Definitive validation failure: record the failed outcome first, then
      // project it onto the task, then answer. The reason must be actionable.
      const reason = typeof run.chainId === "string" && run.chainId
        ? `no chain definition found for chain ${run.chainId}: neither the run's own chain.json nor the chains-dir copy exists`
        : "no chain definition found: the run has no chainId and no chain.json in its run directory";
      const failed = recordResumeFailure(runJsonPath, runId, attempt, reason);
      if (taskMetadata && automatic) {
        projectConfirmedResumeFailure({
          orgId, namespaceId: nsId, taskId: taskId as string, runId, attempt: failed,
        });
      }
      throw new NotFound(
        "Chain",
        typeof run.chainId === "string" && run.chainId
          ? run.chainId
          : `${runId} (run has no chainId and no chain.json in its run directory)`,
      );
    }

    // A chain snapshot that cannot be parsed definitively prevents launch.
    let chainJson: { agents?: unknown; default_agent_profile?: string; config?: { default_agent_profile?: string } };
    try {
      chainJson = JSON.parse(readFileSync(chainPath, "utf-8"));
    } catch {
      const reason = `chain definition at ${chainPath} is unreadable (invalid JSON)`;
      const failed = recordResumeFailure(runJsonPath, runId, attempt, reason);
      if (taskMetadata && automatic) {
        projectConfirmedResumeFailure({
          orgId, namespaceId: nsId, taskId: taskId as string, runId, attempt: failed,
        });
      }
      throw new NotFound("Chain", chainPath);
    }

    // stop any leftover chain-runner process before touching PTYs or relaunching.
    await terminateRunProcess(runId);

    // remove stale agent + typed-attempt PTY sessions from the previous attempt
    const staleSessions = collectStaleRunSessionNames(run);
    await Promise.allSettled(staleSessions.map((s) => pty.remove(s)));

    // build a trigger-aware view so we resume the actual frontier — a pending agent
    // whose trigger event was already produced — rather than the first pending agent
    // by array order. That positional pick could select a sibling stranded on a
    // branch that was never taken (regression: run-1783832264355-7d9c3cce resumed
    // source-repointer after the remover had already resolved the bug, contradicting
    // itself and failing the run). Falls back to positional order if the chain can't
    // be parsed.
    let routingAgents: RoutingAgent[] = [];
    const routingContext = routingContextForEvents(readRoutingEvents(config.eventsDir, run.id), run.id);
    routingAgents = (Array.isArray(chainJson.agents) ? chainJson.agents : []).map(
      (a: { id: string; triggers?: string[]; emits?: string; wait_for_events?: RoutingAgent["wait_for_events"] }) => ({
        id: a.id,
        triggers: a.triggers,
        emits: a.emits,
        wait_for_events: a.wait_for_events,
      }),
    );

    // resolve agent profile for env vars
    let profileEnv: Record<string, string> = {};
    try {
      const profileId = chainJson.default_agent_profile || chainJson.config?.default_agent_profile;
      if (profileId) {
        const profile = getProfile(nsId, orgId, profileId);
        if (profile?.env) {
          profileEnv = resolveProfileEnvVars(nsId, orgId, profile.env);
        }
      }
    } catch { /* use empty */ }

    // Producer fix (#142): resume re-enters the ORIGINAL run through the typed
    // routed-launch path — the same mechanism the completion handoff and the
    // error-handling retry dispatch (error-handling.ts dispatchChainRunner) use
    // to start the next agent of an existing run: runner-v2-launch-agent pins
    // MENTIKO_RUN_ID/MENTIKO_RUN_DIR, bootstraps the agent through
    // startRunnerV2Bootstrap under the original run id, and re-persists the
    // launch job idempotently. The resumedAt persisted below is the bootstrap
    // gate's documented resume admission (bootstrap-executor
    // assertBootstrapLaunchable), so a resume never reserves a second run
    // directory or splits run ownership across a child record.
    const compiledLauncher = join(config.codeRoot, "lib", "runner-v2-launch-agent.js");
    const launcherPath = existsSync(compiledLauncher)
      ? compiledLauncher
      : join(config.codeRoot, "web", "scripts", "runner-v2-launch-agent.cjs");
    // A fresh occurrence id per resume attempt gives the durable launch job a
    // fresh identity (same shape as the fan-group occurrence ids in adapters.ts),
    // so a retried resume never collides with the previous attempt's job.
    const occurrenceId = `resume:${runId}:${Date.now()}`;
    const webOrigin = resolveInternalWebOrigin(new URL(req.url).origin);
    // The launch base env is fixed BEFORE the acceptance transition: the routed
    // launch job persisted inside that transition derives its identity from the
    // whitelisted subset of exactly this env, so the launcher child's idempotent
    // re-persist computes the identical job. Session-token values are not in the
    // persisted whitelist and are minted after the transition.
    const launchBaseEnv: Record<string, string> = {
      ...getSecretsEnvVars(nsId, orgId),
      ...getSecretsEnvVars(nsId, orgId),
      ...profileEnv,
      BETTER_AUTH_SECRET: resolveInternalAuthSecret("chain-resume"),
      ...buildLocalAiGatewayProxyEnv(new URL(req.url).origin),
      MENTIKO_GLOBAL_ROOT: config.globalRoot,
      MENTIKO_CODE_ROOT: config.codeRoot,
      MENTIKO_PROJECT_ROOT: orgPath(nsId, orgId),
      MENTIKO_ORG_ROOT: orgPath(nsId, orgId),
      MENTIKO_NAMESPACE_ROOT: nsPath(nsId),
      NAMESPACE_ID: nsId,
      ORG_ID: orgId,
      MENTIKO_RUN_ID: runId,
      RUN_ID: runId,
      MENTIKO_RUN_DIR: runDir,
      MENTIKO_COMPLETION_OCCURRENCE_ID: occurrenceId,
      MENTIKO_RUNNER_V2: "1",
      MENTIKO_RUNNER_V2_COMPLETION: "1",
      MENTIKO_WEB_URL: webOrigin,
      ...(run.workspacePath ? { MENTIKO_WORKSPACE_PATH: run.workspacePath } : {}),
      ...(run.taskId ? { MENTIKO_TASK_ID: run.taskId } : {}),
      ...(run.debug ? { MENTIKO_DEBUG: "1" } : {}),
    };
    // ONE canonical sanitized child environment, derived before acceptance
    // (issue #142 round 2): the queued routed launch job persists exactly the
    // whitelisted subset of this env, and the spawn below uses it byte-for-byte.
    // The launcher child therefore re-persists (from its own process.env, which
    // IS this env plus the never-persisted session keys) the identical job it
    // was accepted with — the immediate launch can never conflict with its own
    // accepted job over inherited PTY_DAEMON/capacity settings.
    const canonicalChildEnv: Record<string, string> = buildChildEnv(launchBaseEnv);
    delete canonicalChildEnv.CLAUDECODE;

    // Durable acceptance (issue #142): the transition to running, the accepted
    // outcome, and the queued routed launch job are ONE atomic run.json write.
    // A 200 therefore implies the launch intent is durably recorded; a crash
    // between this write and the dispatch leaves a queued job the background
    // worker reclaims. This is the acceptance/linearization point — nothing
    // after it may roll the record back, and no failure after it spends resume
    // budget: the queued job IS the recoverable execution intent.
    let resumeAgentId = "";
    let launchJob: RoutedLaunchJob | undefined;
    const resumedRun = updateRunJson(runJsonPath, (current) => {
      if (!current) throw new NotFound("Run", runId);
      if (current.status === "running") throw new Conflict("Run is already running");
      const currentIncomplete = current.agents.filter((agent) => agent.status !== "complete");
      if (currentIncomplete.length === 0) throw new Conflict("All agents already completed");

      const currentRoutingAgents = routingAgents.map((agent) => ({
        ...agent,
        status: current.agents.find((candidate) => candidate.id === agent.id)?.status,
      }));
      const frontierIds = new Set(
        currentRoutingAgents
          .filter((agent) => agent.status !== "complete" && hasCompletedTrigger(agent, currentRoutingAgents, routingContext))
          .map((agent) => agent.id),
      );
      // Priority: interrupted > trigger-eligible frontier > first pending. The
      // frontier includes cancelled/stopped agents whose trigger already fired.
      const resumeAgent = currentIncomplete.find((agent) => agent.status === "running" || agent.status === "stopped")
        || currentIncomplete.find((agent) => frontierIds.has(agent.id))
        || currentIncomplete.find((agent) => agent.status === "pending")
        || currentIncomplete[0];
      resumeAgentId = resumeAgent.id;

      const agents = current.agents.map((agent) => {
        if (agent.status === "complete") return agent;
        const { started: _started, completed: _completed, blockedReason: _blockedReason, lastMessage: _lastMessage, ...rest } = agent;
        return { ...rest, status: "pending" as const, session: "" };
      });
      let run: RunRecord = { ...current, agents };
      // Preserve the prior terminal cause as history instead of erasing it.
      run = appendResumeHistory(run, {
        ...(priorAttempt ? { attempt: priorAttempt } : {}),
        status: current.status,
        ...(current.statusReason ? { statusReason: current.statusReason } : {}),
        ...(typeof current.status_message === "string" ? { statusMessage: current.status_message } : {}),
        at: new Date().toISOString(),
      });
      run = {
        ...run,
        status: "running",
        resumedAt: new Date().toISOString(),
        resumeAttempt: {
          ...attempt,
          outcome: "accepted" as const,
          reason: undefined,
          updatedAt: new Date().toISOString(),
        },
      };
      delete run.completed;
      delete run.blockedReason;
      delete run.blockedAt;
      delete run.status_message;
      delete run.statusReason;
      const upsert = upsertRoutedLaunchJobRecord(run, {
        occurrenceId,
        runId,
        runDir,
        chainPath,
        targetAgentIds: [resumeAgentId],
        environment: canonicalChildEnv,
      });
      launchJob = upsert.job;
      return upsert.run;
    });
    const completed = resumedRun.agents.filter((agent) => agent.status === "complete");
    const incomplete = resumedRun.agents.filter((agent) => agent.status !== "complete");

    // Dispatch AFTER durable acceptance. Route-side spawn is optional
    // acceleration of the exact queued job: a failure here (token mint, log
    // open, spawn) cannot undo acceptance and cannot spend resume budget —
    // the background worker reclaims the queued job either way.
    let sessionEnv: Record<string, string> = {};
    let child: ReturnType<typeof spawn> | undefined;
    let dispatchError: string | undefined;
    try {
      sessionEnv = await buildResumeSessionEnv(req, nsId, orgId, runId);
      const logFd = openSync(join(runDir, "output.log"), "a");
      try {
        child = spawn(
          process.execPath,
          [launcherPath, chainPath, resumeAgentId],
          {
            cwd: config.codeRoot,
            detached: true,
            stdio: ["ignore", logFd, logFd],
            // byte-for-byte the canonical persisted env; the session keys are
            // added on top and are not in the persisted whitelist, so the
            // launcher's idempotent re-persist still computes the same job.
            env: { ...canonicalChildEnv, ...sessionEnv },
          }
        );
      } finally {
        closeSync(logFd);
      }
      // Async spawn failures (the 'error' event) cannot fail the response; the
      // durable queued job is the recovery path. Never crash the route process.
      child.on?.("error", (error: Error) => {
        console.error(`[resume] launcher spawn error for ${runId} (job ${launchJob?.id}): ${error.message}`);
      });
      child.unref();
    } catch (error) {
      dispatchError = error instanceof Error ? error.message : String(error);
      console.error(
        `[resume] dispatch failed for ${runId} (job ${launchJob?.id} remains queued for worker recovery): ${dispatchError}`,
      );
    }

    return apiSuccess({
      success: true,
      runId,
      resumeFrom: resumeAgentId,
      completedAgents: completed.map((a) => a.id),
      resumingAgents: incomplete.map((a) => a.id),
      resumeAttemptId: attempt.id,
      resumeSeries: series,
      resumeOutcome: "accepted",
      launchOccurrenceId: occurrenceId,
      launchJobId: launchJob?.id,
      pid: child?.pid,
      ...(dispatchError ? { dispatchError } : {}),
    });
  } finally {
    releaseResumeClaim();
  }
});
