import { spawn } from "child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { isAbsolute, join, relative, resolve } from "path";
import config, { nsPath, orgPath } from "@/lib/config";
import { execAuditLog, shellEscape } from "@/lib/audit-exec";
import { getSessionUser } from "@/lib/auth-bridge";
import { resolveChainAgents } from "@/lib/agent-loader";
import { getProfile, listProfiles } from "@/lib/agent-profile-storage";
import { getSecretsEnvVars, resolveProfileEnvVars } from "@/lib/secrets-store";
import { getWorkspace, listWorkspaces } from "@/lib/workspace-storage";
import { fireWebhooks } from "@/lib/webhook-utils";
import type { Chain } from "@/lib/types";
import { readSystemSettings } from "@/lib/system-settings";
import { taskMergeMeta, taskUpdate } from "@/lib/task-store";
import { BadRequest, Conflict, Forbidden, RateLimitExceeded } from "@/lib/api-errors";
import { createNotification } from "@/lib/notification-server";
import { buildChildEnv } from "@/lib/child-env";
import { buildLocalAiGatewayProxyEnv } from "@/lib/ai-gateway-local-proxy-env";
import { resolveAuthorizedWorkspacePath } from "@/lib/workspace-auth";
import { resolveLinkRunsDir } from "@/lib/link-run-runtime";
import { resolveInternalAuthSecret } from "@/lib/internal-api-auth";
import { resolveRunAgentProfileId } from "@/lib/run-agent-profile";

const AGENT_CHAIN_BIN = join(config.binDir, "mentiko");
const SAFE_RUN_ID_RE = /^run-[A-Za-z0-9_-]{1,120}$/;

const EXECUTOR_MAP: Record<string, string> = {
  claude: "claude",
  codex: "codex",
  aider: "aider",
  kollabor: "kl",
  cc: "claude",
  kl: "kl",
};

interface StartChainRunBody {
  chain?: Chain | null;
  chainId?: string;
  userPrompt?: string;
  debug?: boolean;
  workspacePath?: string;
  workspaceId?: string;
  taskId?: string;
  executor?: string;
  agentProfileId?: string;
  runId?: string;
  metadata?: Record<string, unknown>;
}

export interface StartChainRunInput {
  request: Request;
  namespaceId: string;
  orgId: string;
  body: StartChainRunBody;
}

export interface StartChainRunResult {
  runId: string;
  chainId: string;
  status: "started";
}

function validateChainId(name: string): string {
  const str = String(name);
  const sanitized = str.replace(/[^a-zA-Z0-9\-_\s]/g, "");
  if (sanitized.length === 0 || sanitized.length > 100) {
    throw new BadRequest("Invalid chain ID", { field: "name", value: name });
  }
  return sanitized;
}

function validateChainPath(chainPath: string, basePath: string): string {
  const resolved = resolve(chainPath);
  const allowedBase = resolve(basePath);
  const rel = relative(allowedBase, resolved);

  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new BadRequest("Invalid chain path", { field: "path" });
  }
  if (chainPath.includes("..") || chainPath.includes("~") || chainPath.includes("\0")) {
    throw new BadRequest("Invalid chain path", { field: "path" });
  }
  return resolved;
}

function validateRunId(value: string): string {
  const trimmed = value.trim();
  if (!SAFE_RUN_ID_RE.test(trimmed)) {
    throw new BadRequest("Invalid run ID", { field: "runId" });
  }
  return trimmed;
}

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const firstIp = forwarded.split(",")[0].trim();
    if (/^[\d\.]+$/.test(firstIp) || /^[\da-f:]+$/i.test(firstIp)) {
      return firstIp;
    }
  }
  return request.headers.get("x-real-ip") || "unknown";
}

function logAuditEvent(eventType: string, description: string, metadata: Record<string, string>, ip: string): Promise<void> {
  return execAuditLog(eventType, description, metadata, { ip }).then(() => undefined);
}

function applyRuntimeAgentProfileOverride(chain: Chain, agentProfileId?: string): Chain {
  if (!agentProfileId) return chain;
  return {
    ...chain,
    default_agent_profile: agentProfileId,
  };
}

function normalizeRunMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export async function startChainRun({
  request,
  namespaceId,
  orgId,
  body,
}: StartChainRunInput): Promise<StartChainRunResult> {
  const ip = getClientIp(request);
  const runsDir = resolveLinkRunsDir(namespaceId, orgId);
  const user = await getSessionUser(request);
  const chain = body.chain as Chain | null;
  const {
    chainId: callerChainId,
    userPrompt,
    debug,
    workspacePath,
    workspaceId,
    taskId,
    executor,
    agentProfileId,
  } = body;

  const requestedWorkspace =
    typeof workspacePath === "string"
      ? workspacePath
      : typeof workspaceId === "string"
        ? workspaceId
        : undefined;
  const authorizedWorkspacePath = resolveAuthorizedWorkspacePath(namespaceId, orgId, requestedWorkspace, user?.id);
  if (requestedWorkspace && !authorizedWorkspacePath) {
    throw new Forbidden("Workspace not found or inaccessible");
  }
  const workspaceRecord = typeof workspaceId === "string"
    ? getWorkspace(namespaceId, orgId, workspaceId)
    : null;
  const resolvedWorkspaceRecord = workspaceRecord
    ?? (authorizedWorkspacePath
      ? listWorkspaces(namespaceId, orgId).find((workspace) => workspace.path === authorizedWorkspacePath) ?? null
      : null);
  const persistedWorkspaceId =
    resolvedWorkspaceRecord && resolvedWorkspaceRecord.path === authorizedWorkspacePath
      ? resolvedWorkspaceRecord.id
      : undefined;

  if (!chain || !chain.name) {
    throw new BadRequest("chain with name is required", { field: "chain" });
  }

  const requestedAgentProfileId =
    agentProfileId && typeof agentProfileId === "string"
      ? agentProfileId
      : undefined;
  const profiles = listProfiles(namespaceId, orgId);
  if (requestedAgentProfileId) {
    const requestedProfile = profiles.find((profile) => profile.id === requestedAgentProfileId);
    if (!requestedProfile) {
      throw new BadRequest("Agent profile not found", {
        field: "agentProfileId",
        value: requestedAgentProfileId,
      });
    }
  }

  const validChainName = validateChainId(chain.name);
  let runChain = { ...chain };
  if (runChain.agents?.length) {
    runChain.agents = resolveChainAgents(runChain.agents, namespaceId, orgId);
  }

  if (userPrompt && typeof userPrompt === "string" && runChain.agents?.length > 0) {
    const safePrompt = userPrompt.slice(0, 50000);
    runChain.agents = runChain.agents.map((agent) => {
      let prompt = agent.prompt || agent.role || "";
      if (prompt.includes("{TASK}")) {
        prompt = prompt.replace(/\{TASK\}/g, safePrompt);
      } else if (0 === runChain.agents.indexOf(agent)) {
        prompt = `USER REQUEST:\n${safePrompt}\n\nAGENT INSTRUCTIONS:\n${prompt}`;
      }
      return { ...agent, prompt };
    });
  }

  if (authorizedWorkspacePath) {
    runChain.config = { ...(runChain.config || {}), project_root: authorizedWorkspacePath };
  }
  const effectiveAgentProfileId = resolveRunAgentProfileId({
    requestedProfileId: requestedAgentProfileId,
    chainDefaultProfileId: runChain.default_agent_profile,
    workspaceDefaultProfileId: resolvedWorkspaceRecord?.default_agent_profile,
    profiles,
  });
  const runtimeProfile = effectiveAgentProfileId
    ? getProfile(namespaceId, orgId, effectiveAgentProfileId)
    : null;
  runChain = applyRuntimeAgentProfileOverride(runChain, runtimeProfile?.id);

  const runId = body.runId && typeof body.runId === "string"
    ? validateRunId(body.runId)
    : `run-${Date.now()}`;
  const runDir = join(runsDir, runId);
  if (existsSync(runDir)) {
    throw new Conflict("Run already exists");
  }

  const sysSettings = readSystemSettings();
  if (sysSettings.max_concurrent_runs > 0) {
    const runDirs = existsSync(runsDir)
      ? readdirSync(runsDir).filter((d) => SAFE_RUN_ID_RE.test(d))
      : [];
    let activeCount = 0;
    for (const dir of runDirs) {
      const rjPath = join(runsDir, dir, "run.json");
      if (!existsSync(rjPath)) continue;
      try {
        const rj = JSON.parse(readFileSync(rjPath, "utf-8"));
        if (rj.status === "running" || rj.status === "pending") activeCount++;
      } catch { /* skip corrupt */ }
    }
    if (activeCount >= sysSettings.max_concurrent_runs) {
      createNotification(namespaceId, {
        type: "warning",
        title: "Chain run blocked: concurrent limit",
        message: `${activeCount} chains already running (limit: ${sysSettings.max_concurrent_runs}). Try again later.`,
        metadata: {
          chainId: callerChainId || validChainName.toLowerCase().replace(/\s+/g, "-"),
          runId,
        },
      });
      throw new RateLimitExceeded(
        `Concurrent run limit reached (${sysSettings.max_concurrent_runs} active). Try again later.`,
        { activeCount, limit: sysSettings.max_concurrent_runs }
      );
    }
  }

  mkdirSync(runDir, { recursive: true });

  const runMetadata = normalizeRunMetadata(body.metadata);
  const decisionRunMetadata = runMetadata?.decisionId && runMetadata?.decisionPhase
    ? runMetadata
    : undefined;
  const runObject: Record<string, unknown> = {
    id: runId,
    chain: validChainName,
    chainId: callerChainId || validChainName.toLowerCase().replace(/\s+/g, "-"),
    goal: userPrompt || "",
    started: new Date().toISOString(),
    status: "running",
    debug: debug || false,
    agents: runChain.agents?.map((a) => ({
      id: a.id,
      name: a.name,
      status: "pending",
      session: "",
    })) || [],
    ...(runMetadata ? { metadata: runMetadata } : {}),
    ...(authorizedWorkspacePath ? { workspacePath: authorizedWorkspacePath } : {}),
    ...(runtimeProfile?.id ? { agentProfileId: runtimeProfile.id } : {}),
    ...(persistedWorkspaceId ? { workspaceId: persistedWorkspaceId } : {}),
    ...(taskId && typeof taskId === "string" ? { taskId } : {}),
  };

  writeFileSync(join(runDir, "run.json"), JSON.stringify(runObject, null, 2));

  const chainPath = join(runDir, "chain.json");
  const validatedChainPath = validateChainPath(chainPath, runsDir);
  writeFileSync(validatedChainPath, JSON.stringify(runChain, null, 2));

  fireWebhooks(namespaceId, orgId, runObject.chainId as string, "started", { runId }).catch(() => {});

  logAuditEvent("chain_start", `Started chain from web: ${validChainName}`, {
    chain_name: validChainName,
    run_id: runId,
    namespace_id: namespaceId,
    agent_count: String(runChain.agents?.length || 0),
    source: "web",
  }, ip).catch(() => {});

  const binPath = resolve(AGENT_CHAIN_BIN);
  const debugFlag = debug ? " --debug" : "";
  const wsFlag = authorizedWorkspacePath
    ? ` --workspace ${shellEscape(authorizedWorkspacePath)}`
    : "";
  const taskFlag = taskId && typeof taskId === "string"
    ? ` --task ${shellEscape(taskId)}`
    : "";
  const logPath = join(runDir, "output.log");
  const logFd = openSync(logPath, "w");

  let profileEnv: Record<string, string> = {};
  if (runtimeProfile?.env) {
    profileEnv = resolveProfileEnvVars(namespaceId, orgId, runtimeProfile.env);
  }

  let workspaceEnv: Record<string, string> = {};
  if (resolvedWorkspaceRecord && resolvedWorkspaceRecord.path === authorizedWorkspacePath) {
    if (resolvedWorkspaceRecord.env) {
      workspaceEnv = resolvedWorkspaceRecord.env;
    }
  }

  const child = spawn(
    "/bin/zsh",
    ["-lc", `${shellEscape(binPath)} run ${shellEscape(validatedChainPath)}${wsFlag}${taskFlag}${debugFlag}`],
    {
      cwd: config.codeRoot,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: buildChildEnv({
        ...workspaceEnv,
        ...getSecretsEnvVars(namespaceId, orgId),
        ...profileEnv,
        BETTER_AUTH_SECRET: resolveInternalAuthSecret("chain-run"),
        MENTIKO_DECISION_IMPORT_TOKEN: resolveInternalAuthSecret("decision-import"),
        MENTIKO_DECISION_ID: typeof decisionRunMetadata?.decisionId === "string" ? decisionRunMetadata.decisionId : undefined,
        MENTIKO_DECISION_PHASE: typeof decisionRunMetadata?.decisionPhase === "string" ? decisionRunMetadata.decisionPhase : undefined,
        MENTIKO_DECISION_SELECTED_OPTION_ID: typeof decisionRunMetadata?.selectedOptionId === "string" ? decisionRunMetadata.selectedOptionId : undefined,
        MENTIKO_DECISION_WORKSPACE_PATH: typeof decisionRunMetadata?.workspacePath === "string" ? decisionRunMetadata.workspacePath : undefined,
        ...buildLocalAiGatewayProxyEnv(new URL(request.url).origin),
        MENTIKO_GLOBAL_ROOT: config.globalRoot,
        MENTIKO_CODE_ROOT: config.codeRoot,
        MENTIKO_PROJECT_ROOT: orgPath(namespaceId, orgId),
        MENTIKO_ORG_ROOT: orgPath(namespaceId, orgId),
        MENTIKO_NAMESPACE_ROOT: nsPath(namespaceId),
        NAMESPACE_ID: namespaceId,
        ORG_ID: orgId,
        MENTIKO_RUN_ID: runId,
        ...(executor && typeof executor === "string" && EXECUTOR_MAP[executor]
          ? { MENTIKO_CLI: EXECUTOR_MAP[executor] }
          : {}),
      }),
    }
  );

  child.unref();
  closeSync(logFd);

  child.on("error", (spawnError) => {
    const errorRunPath = join(runDir, "run.json");
    if (existsSync(errorRunPath)) {
      const errorRun = JSON.parse(readFileSync(errorRunPath, "utf-8"));
      errorRun.status = "failed";
      errorRun.error = spawnError.message;
      writeFileSync(errorRunPath, JSON.stringify(errorRun, null, 2));
    }
    createNotification(namespaceId, {
      type: "chain_failed",
      title: `Chain failed: ${validChainName}`,
      message: `Spawn error: ${spawnError.message}`,
      metadata: {
        chainId: runObject.chainId as string,
        runId,
        error: spawnError.message,
        actionUrl: `/runs?runId=${runId}`,
        actionLabel: "View Run",
      },
    });
  });

  logAuditEvent("chain_complete", `Chain launched from web: ${validChainName}`, {
    chain_name: validChainName,
    run_id: runId,
    status: "running",
    namespace_id: namespaceId,
  }, ip).catch(() => {});

  if (taskId && typeof taskId === "string") {
    try {
      taskUpdate(orgId, taskId, { status: "in_progress" }, namespaceId);
      taskMergeMeta(orgId, taskId, { last_run_id: runId, last_run_status: "running" }, namespaceId);
    } catch {
      // non-critical: don't fail the run if task update fails
    }
  }

  return {
    runId,
    chainId: runObject.chainId as string,
    status: "started",
  };
}
