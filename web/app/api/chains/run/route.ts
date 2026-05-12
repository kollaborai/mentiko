import { NextRequest } from "next/server";
import { spawn } from "child_process";
import { writeFileSync, mkdirSync, openSync, closeSync, existsSync, readFileSync, readdirSync } from "fs";
import { isAbsolute, join, relative, resolve } from "path";
import config, { nsPath, orgPath } from "@/lib/config";
import { execAuditLog, shellEscape } from "@/lib/audit-exec";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { requirePermission } from "@/lib/rbac-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import { getSessionUser } from "@/lib/auth-bridge";
import { resolveChainAgents } from "@/lib/agent-loader";
import { getProfile } from "@/lib/agent-profile-storage";
import { getSecretsEnvVars, resolveProfileEnvVars } from "@/lib/secrets-store";
import { getWorkspace } from "@/lib/workspace-storage";
import { fireWebhooks } from "@/lib/webhook-utils";
import type { Chain } from "@/lib/types";
import { readSystemSettings } from "@/lib/system-settings";
import { taskUpdate, taskMergeMeta } from "@/lib/task-store";
import { BadRequest, Conflict, Forbidden, RateLimitExceeded } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { createNotification } from "@/lib/notification-server";
import { buildChildEnv } from "@/lib/child-env";
import { resolveAuthorizedWorkspacePath } from "@/lib/workspace-auth";
import { resolveLinkRunsDir } from "@/lib/link-run-runtime";
import { resolveInternalAuthSecret } from "@/lib/internal-api-auth";

export const dynamic = "force-dynamic";

const AGENT_CHAIN_BIN = join(config.binDir, "mentiko");
const SAFE_RUN_ID_RE = /^run-[A-Za-z0-9_-]{1,120}$/;

// validate chain name/id to prevent path traversal and injection
function validateChainId(name: string): string {
  const str = String(name);
  // only allow alphanumeric, hyphens, underscores, spaces
  const sanitized = str.replace(/[^a-zA-Z0-9\-_\s]/g, "");
  if (sanitized.length === 0 || sanitized.length > 100) {
    throw new BadRequest("Invalid chain ID", { field: "name", value: name });
  }
  return sanitized;
}

// validate and resolve chain path - prevent directory traversal
function validateChainPath(chainPath: string, basePath: string): string {
  const resolved = resolve(chainPath);
  const allowedBase = resolve(basePath);
  const rel = relative(allowedBase, resolved);

  // ensure path is within allowed directory
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new BadRequest("Invalid chain path", { field: "path" });
  }

  // additional check for path traversal attempts
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

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    // validate first IP is legitimate
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

export const POST = withErrorHandling(async (request: NextRequest, _context: { params: Promise<Record<string, string>> }) => {
  const blockResult = await enforceGuestWrites(request);
  if (blockResult?.blocked) return blockResult.response;

  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const ip = getClientIp(request);
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const runsDir = resolveLinkRunsDir(namespaceId, orgId);
  const user = await getSessionUser(request);
  const body = await request.json();
  const chain = body.chain as Chain | null;
  const { chainId: callerChainId, userPrompt, debug, workspacePath, workspaceId, taskId, executor, agentProfileId } = body;
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
  const persistedWorkspaceId =
    workspaceRecord && workspaceRecord.path === authorizedWorkspacePath
      ? workspaceRecord.id
      : undefined;

  // map friendly executor names to CLI binaries
  const EXECUTOR_MAP: Record<string, string> = {
    claude: "claude",
    codex: "codex",
    aider: "aider",
    kollabor: "kl",
    cc: "claude",
    kl: "kl",
  };

  if (!chain || !chain.name) {
    throw new BadRequest("chain with name is required", { field: "chain" });
  }

  // validate chain name
  const validChainName = validateChainId(chain.name);

  // Resolve $ref agents to inline definitions first
  const runChain = { ...chain };
  if (runChain.agents?.length) {
    runChain.agents = resolveChainAgents(runChain.agents, namespaceId, orgId);
  }

  // Inject user prompt: replace {TASK} placeholders and prepend to first agent
  if (userPrompt && typeof userPrompt === "string" && runChain.agents?.length > 0) {
    // limit userPrompt length to prevent dos
    const safePrompt = userPrompt.slice(0, 50000);
    runChain.agents = runChain.agents.map((agent) => {
      let prompt = agent.prompt || agent.role || "";
      // Replace {TASK} placeholder in all agents
      if (prompt.includes("{TASK}")) {
        prompt = prompt.replace(/\{TASK\}/g, safePrompt);
      } else if (0 === runChain.agents.indexOf(agent)) {
        // No placeholder - prepend to first agent only
        prompt = `USER REQUEST:\n${safePrompt}\n\nAGENT INSTRUCTIONS:\n${prompt}`;
      }
      return { ...agent, prompt };
    });
  }

  // Inject workspace path as project_root if provided
  if (authorizedWorkspacePath) {
    runChain.config = { ...(runChain.config || {}), project_root: authorizedWorkspacePath };
  }

  // Create run object (accept optional pre-generated runId for external coordination)
  const runId = body.runId && typeof body.runId === "string"
    ? validateRunId(body.runId)
    : `run-${Date.now()}`;
  const runDir = join(runsDir, runId);
  if (existsSync(runDir)) {
    throw new Conflict("Run already exists");
  }

  // Enforce max_concurrent_runs limit before writing a new running run.json.
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
    ...(authorizedWorkspacePath ? { workspacePath: authorizedWorkspacePath } : {}),
    // persist workspaceId so run-acl.ts can enforce workspace ACLs (RBAC-2)
    ...(persistedWorkspaceId ? { workspaceId: persistedWorkspaceId } : {}),
    ...(taskId && typeof taskId === "string" ? { taskId } : {}),
  };

  // Write run.json
  writeFileSync(join(runDir, "run.json"), JSON.stringify(runObject, null, 2));

  // Write chain file inside the run directory
  const chainPath = join(runDir, "chain.json");
  const validatedChainPath = validateChainPath(chainPath, runsDir);
  writeFileSync(validatedChainPath, JSON.stringify(runChain, null, 2));

  // Fire started webhook (fire-and-forget, don't block response)
  fireWebhooks(namespaceId, orgId, runObject.chainId as string, "started", { runId }).catch(() => {});

  // Log chain start from web (fire-and-forget - don't block response)
  logAuditEvent("chain_start", `Started chain from web: ${validChainName}`, {
    chain_name: validChainName,
    run_id: runId,
    namespace_id: namespaceId,
    agent_count: String(runChain.agents?.length || 0),
    source: "web",
  }, ip).catch(() => {});

  // Build command - detached spawn for non-blocking execution
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

  // resolve agent profile env vars if profile specified
  let profileEnv: Record<string, string> = {};
  if (agentProfileId && typeof agentProfileId === "string") {
    const profile = getProfile(namespaceId, orgId, agentProfileId);
    if (profile && profile.env) {
      profileEnv = resolveProfileEnvVars(namespaceId, orgId, profile.env);
    }
  }

  // resolve workspace env vars if workspaceId provided
  let workspaceEnv: Record<string, string> = {};
  if (workspaceRecord && workspaceRecord.path === authorizedWorkspacePath) {
    if (workspaceRecord.env) {
      workspaceEnv = workspaceRecord.env;
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
        // workspace env vars (user-configured per workspace)
        ...workspaceEnv,
        // inject decrypted secrets as env vars (override workspace env)
        ...getSecretsEnvVars(namespaceId, orgId),
        // agent profile env vars override secrets (explicit takes precedence)
        ...profileEnv,
        BETTER_AUTH_SECRET: resolveInternalAuthSecret("chain-run"),
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

  // unref() allows parent to exit without killing child
  child.unref();
  closeSync(logFd); // parent releases fd, child keeps it

  // Handle spawn errors (e.g., binary not found)
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

  // Log chain launch from web (fire-and-forget)
  logAuditEvent("chain_complete", `Chain launched from web: ${validChainName}`, {
    chain_name: validChainName,
    run_id: runId,
    status: "running",
    namespace_id: namespaceId,
  }, ip).catch(() => {});

  // Update linked task status to in_progress
  if (taskId && typeof taskId === "string") {
    try {
      taskUpdate(orgId, taskId, { status: "in_progress" }, namespaceId);
      taskMergeMeta(orgId, taskId, { last_run_id: runId, last_run_status: "running" }, namespaceId);
    } catch {
      // non-critical: don't fail the run if task update fails
    }
  }

  return apiSuccess({
    runId,
    chainId: runObject.chainId,
    status: "started",
  });
});
