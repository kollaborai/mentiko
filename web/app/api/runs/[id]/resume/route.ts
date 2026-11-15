/**
 * POST /api/runs/[id]/resume
 *
 * resumes a crashed/stopped run from where it left off, INSIDE the same run.
 * - skips completed agents
 * - resets running/stopped agents to pending
 * - finds the resume frontier (interrupted > trigger-eligible > first pending)
 * - kills any stale PTY sessions before restarting
 * - relaunches the frontier agent through the typed routed-launch path under
 *   the original run ID and directory: no child run, no second run directory
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
import { updateRunJson } from "@/lib/runner-v2/run-state";

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

  const run: RunJson = JSON.parse(readFileSync(runJsonPath, "utf-8"));

  // don't resume already running runs
  if (run.status === "running") {
    throw new Conflict("Run is already running");
  }

  // find the chain file: the run's own snapshot first, the chains-dir copy
  // second. A record without chainId must resolve through its own snapshot,
  // never throw on join(chainsDir, undefined) (issue #142).
  const chainsDir = orgPath(nsId, orgId, "chains");
  const chainPath = resolveResumeChainPath({ runDir, chainId: run.chainId, chainsDir });

  if (!chainPath) {
    throw new NotFound(
      "Chain",
      typeof run.chainId === "string" && run.chainId
        ? run.chainId
        : `${runId} (run has no chainId and no chain.json in its run directory)`,
    );
  }

  // analyze agent states
  if (!run.agents.some((agent) => agent.status !== "complete")) {
    throw new Conflict("All agents already completed");
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
  try {
    const chainForRouting = JSON.parse(readFileSync(chainPath, "utf-8"));
    routingAgents = (chainForRouting.agents || []).map(
      (a: { id: string; triggers?: string[]; emits?: string; wait_for_events?: RoutingAgent["wait_for_events"] }) => ({
        id: a.id,
        triggers: a.triggers,
        emits: a.emits,
        wait_for_events: a.wait_for_events,
      }),
    );
  } catch { /* fall back to positional selection */ }

  let resumeAgentId = "";
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
    const run: typeof current = {
      ...current,
      agents,
      status: "running",
      resumedAt: new Date().toISOString(),
    };
    delete run.completed;
    delete run.blockedReason;
    delete run.blockedAt;
    delete run.status_message;
    return run;
  });
  const completed = resumedRun.agents.filter((agent) => agent.status === "complete");
  const incomplete = resumedRun.agents.filter((agent) => agent.status !== "complete");

  // resolve agent profile for env vars
  let profileEnv: Record<string, string> = {};
  try {
    const chainJson = JSON.parse(readFileSync(chainPath, "utf-8"));
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
  // MENTIKO_RUN_ID/MENTIKO_RUN_DIR, persists a durable launch job in the
  // original run.json, and bootstraps the agent through startRunnerV2Bootstrap
  // under the original run id. The resumedAt persisted above is the bootstrap
  // gate's documented resume admission (bootstrap-executor
  // assertBootstrapLaunchable), so a resume never reserves a second run
  // directory or splits run ownership across a child record.
  const sessionEnv = await buildResumeSessionEnv(req, nsId, orgId, runId);
  const compiledLauncher = join(config.codeRoot, "lib", "runner-v2-launch-agent.js");
  const launcherPath = existsSync(compiledLauncher)
    ? compiledLauncher
    : join(config.codeRoot, "web", "scripts", "runner-v2-launch-agent.cjs");
  // A fresh occurrence id per resume attempt gives the durable launch job a
  // fresh identity (same shape as the fan-group occurrence ids in adapters.ts),
  // so a retried resume never collides with the previous attempt's job.
  const occurrenceId = `resume:${runId}:${Date.now()}`;

  const logPath = join(runDir, "output.log");
  const logFd = openSync(logPath, "a");

  const child = spawn(
    process.execPath,
    [launcherPath, chainPath, resumeAgentId],
    {
      cwd: config.codeRoot,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: (() => {
        const e = buildChildEnv({
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
          ...(resumedRun.workspacePath ? { MENTIKO_WORKSPACE_PATH: resumedRun.workspacePath } : {}),
          ...(resumedRun.taskId ? { MENTIKO_TASK_ID: resumedRun.taskId } : {}),
          ...(resumedRun.debug ? { MENTIKO_DEBUG: "1" } : {}),
          ...sessionEnv,
        });
        delete e.CLAUDECODE;
        return e;
      })(),
    }
  );

  child.unref();
  closeSync(logFd);

  return apiSuccess({
    success: true,
    runId,
    resumeFrom: resumeAgentId,
    completedAgents: completed.map((a) => a.id),
    resumingAgents: incomplete.map((a) => a.id),
    launchOccurrenceId: occurrenceId,
    pid: child.pid,
  });
});
