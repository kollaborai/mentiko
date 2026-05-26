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

import { readFileSync, writeFileSync, existsSync, openSync, closeSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import config, { nsPath, orgPath } from "@/lib/config";
import { shellEscape } from "@/lib/audit-exec";
import { requirePermission } from "@/lib/rbac-auth";
import { pty } from "@/lib/pty-client";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { buildChildEnv } from "@/lib/child-env";
import { buildLocalAiGatewayProxyEnv } from "@/lib/ai-gateway-local-proxy-env";
import { getSecretsEnvVars, resolveProfileEnvVars } from "@/lib/secrets-store";
import { getProfile } from "@/lib/agent-profile-storage";
import { checkRunAccess } from "@/lib/run-acl";
import { resolveLinkRunsDir } from "@/lib/link-run-runtime";
import { resolveInternalAuthSecret } from "@/lib/internal-api-auth";
import { NotFound, Conflict, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

interface RunAgent {
  id: string;
  name: string;
  status: string;
  session?: string;
  started?: string;
  completed?: string;
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
  const completed = run.agents.filter((a) => a.status === "complete");
  const incomplete = run.agents.filter((a) => a.status !== "complete");

  if (incomplete.length === 0) {
    throw new Conflict("All agents already completed");
  }

  // kill any stale sessions from the previous attempt
  const staleSessions = run.agents
    .filter((a) => a.session && a.status !== "complete")
    .map((a) => a.session!)
    .filter(Boolean);

  await Promise.allSettled(staleSessions.map((s) => pty.kill(s)));

  // find the first agent to resume from
  // priority: first "running" (was interrupted), then first "pending"
  const resumeAgent = incomplete.find((a) => a.status === "running" || a.status === "stopped")
    || incomplete.find((a) => a.status === "pending")
    || incomplete[0];

  // reset incomplete agents to pending (chain-runner will launch them)
  for (const agent of run.agents) {
    if (agent.status === "complete") continue;
    agent.status = "pending";
    agent.session = "";
    delete agent.started;
    delete agent.completed;
  }

  // update run status + grace period for reconciler
  run.status = "running";
  run.resumedAt = new Date().toISOString();
  delete run.completed;

  writeFileSync(runJsonPath, JSON.stringify(run, null, 2));

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
  const startFlag = ` --start ${shellEscape(resumeAgent.id)}`;
  const wsFlag = run.workspacePath ? ` --workspace ${shellEscape(run.workspacePath)}` : "";
  const taskFlag = run.taskId ? ` --task ${shellEscape(run.taskId)}` : "";
  const debugFlag = run.debug ? " --debug" : "";

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
    resumeFrom: resumeAgent.id,
    completedAgents: completed.map((a) => a.id),
    resumingAgents: incomplete.map((a) => a.id),
    pid: child.pid,
  });
});
