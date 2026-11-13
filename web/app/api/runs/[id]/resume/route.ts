/**
 * POST /api/runs/[id]/resume
 *
 * resumes a crashed/stopped run from where it left off.
 * - skips completed agents
 * - resets running/stopped agents to pending
 * - finds the first incomplete agent and restarts chain-runner from there
 * - kills any stale PTY sessions before restarting
 * - reuses the same run ID and directory
 */

import { readFileSync, existsSync, openSync, closeSync, readdirSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import config, { nsPath, orgPath } from "@/lib/config";
import { shellEscape } from "@/lib/api/audit-exec";
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
import { hasCompletedTrigger, routingContextForEvents, type RoutingAgent } from "@/lib/runner-v2/routing";
import { parseRunnerEvent, type RunnerEventRecord } from "@/lib/runner-v2/events";
import { NotFound, Conflict, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { collectStaleRunSessionNames } from "@/lib/runs/stale-run-sessions";
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
  chainId: string;
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

  // find the chain file (saved in run dir at start, or in chains dir)
  const chainInRun = join(runDir, "chain.json");
  const chainsDir = orgPath(nsId, orgId, "chains");
  const chainInChains = join(chainsDir, run.chainId, "chain.json");
  const chainPath = existsSync(chainInRun) ? chainInRun : existsSync(chainInChains) ? chainInChains : null;

  if (!chainPath) {
    throw new NotFound("Chain", run.chainId);
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

  // spawn chain-runner with existing run ID and --start flag
  const binPath = join(config.codeRoot, "bin", "mentiko");
  const startFlag = ` --start ${shellEscape(resumeAgentId)}`;
  const wsFlag = resumedRun.workspacePath ? ` --workspace ${shellEscape(resumedRun.workspacePath)}` : "";
  const taskFlag = resumedRun.taskId ? ` --task ${shellEscape(resumedRun.taskId)}` : "";
  const debugFlag = resumedRun.debug ? " --debug" : "";

  const logPath = join(runDir, "output.log");
  const logFd = openSync(logPath, "a");

  const child = spawn(
    "/bin/zsh",
    ["-lc", `${shellEscape(binPath)} run ${shellEscape(chainPath)}${startFlag}${wsFlag}${taskFlag}${debugFlag}`],
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
          AGENT_CHAIN_RUN_ID: runId,
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
    pid: child.pid,
  });
});
