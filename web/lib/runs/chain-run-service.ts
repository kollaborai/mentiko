// -------------------------------------------------------------------
// chain-run-service.ts — Start a mentiko chain run (spawn mentiko CLI).
// -------------------------------------------------------------------
// This service validates input, creates the run directory, writes
// chain.json + run.json, and spawns the mentiko CLI in a detached
// background process.
//
// SECURITY: Path validation prevents directory traversal. Run ID regex
// prevents path injection in directory names. All CLI arguments are
// shell-escaped.
//
// CONCURRENT LIMIT: Checks max_concurrent_runs system setting and
// blocks new runs when the limit is reached to prevent resource
// exhaustion.
//
// DETACHED SPAWN: The mentiko process runs detached so it survives
// the API request lifecycle. Output streams to output.log in the run
// directory.
// -------------------------------------------------------------------

import { spawn } from "child_process";
import { randomBytes } from "crypto";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { isAbsolute, join, relative, resolve } from "path";
import config, { nsPath, orgPath } from "@/lib/config";
import { execAuditLog, shellEscape } from "@/lib/api/audit-exec";
import { getSessionUser, type SessionUser } from "@/lib/auth/auth-bridge";
import { resolveChainAgents } from "@/lib/agents/agent-loader";
import { getProfile, listProfiles } from "@/lib/agents/agent-profile-storage";
import { getSecretsEnvVars, resolveProfileEnvVars } from "@/lib/secrets/secrets-store";
import { getWorkspace, listWorkspaces } from "@/lib/workspaces/workspace-storage";
import { fireWebhooks } from "@/lib/webhooks/webhook-utils";
import type { Chain } from "@/lib/types";
import { resolveMaxConcurrentChains } from "@/lib/system/system-settings";
import { taskGet, taskUpdate } from "@/lib/tasks/task-store";
import { BadRequest, Conflict, Forbidden } from "@/lib/api-errors";
import { createNotification } from "@/lib/notifications/notification-server";
import { buildChildEnv } from "@/lib/runs/child-env";
import { buildLocalAiGatewayProxyEnv } from "@/lib/ai-gateway/local-proxy-env";
import { isRunnerV2Enabled } from "@/lib/runner-v2/flags";
import { startRunnerV2Launch } from "@/lib/runner-v2/controller";
import { runSyntheticRunnerV2Probe, runSyntheticRunnerV2ProbeWithDispatch } from "@/lib/runner-v2/probe";
import { resolveAuthorizedWorkspacePath } from "@/lib/auth/workspace-auth";
import { resolveLinkRunsDir } from "@/lib/links/link-run-runtime";
import { resolveInternalAuthSecret } from "@/lib/auth/internal-api-auth";
import { mintSessionToken, verifySessionToken } from "@/lib/auth/session-token";
import { resolveRunAgentProfileId } from "@/lib/agents/run-agent-profile";
import { shouldRecordTaskExecutionMetadata } from "@/lib/runs/run-provenance";
import { executionStartedLifecycleMetadata } from "@/lib/orchestration/task-lifecycle-metadata";

const AGENT_CHAIN_BIN = join(config.binDir, "mentiko");
const SAFE_RUN_ID_RE = /^run-[A-Za-z0-9_-]{1,120}$/;

// Collision-proof run id (engine bug #20). `run-${Date.now()}` alone is epoch-millis,
// but two requests landing in the SAME millisecond would still mint the same id and
// collide their run dirs. The random suffix removes within-millisecond collisions.
// 4 bytes (32 bits) of randomness keeps collisions astronomically unlikely even under a
// burst of many launches inside one millisecond. Mirrors the CLI scheme in
// lib/run-lib.sh `_mint_run_id` (run-<millis>-<hex>) and stays within SAFE_RUN_ID_RE —
// only [0-9a-f-] after the `run-` prefix (~26 chars total, well under the 120 cap).
function mintRunId(): string {
  return `run-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

// Executor short names -> MENTIKO_CLI values. Allows specifying which CLI to
// use (claude, codex, aider, kollab) via UI or API. Maps aliases (cc, kl)
// to canonical names.
const EXECUTOR_MAP: Record<string, string> = {
  claude: "claude",
  codex: "codex",
  aider: "aider",
  kollab: "kl",
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

interface TaskExecutionRunCandidate {
  taskId?: string;
  chainId?: string;
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

interface ChainSessionActor {
  id: string;
  role?: SessionUser["role"];
}

async function resolveChainSessionActor(
  request: Request,
  namespaceId: string,
  orgId: string,
): Promise<ChainSessionActor | null> {
  const user = await getSessionUser(request);
  if (user) return { id: user.id, role: user.role };

  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  try {
    const claims = await verifySessionToken(authHeader.slice(7));
    if (claims.ns !== namespaceId || claims.org !== orgId) return null;
    return {
      id: claims.sub,
      ...(claims.role ? { role: claims.role } : {}),
    };
  } catch {
    return null;
  }
}

async function buildChainSessionEnv(
  request: Request,
  namespaceId: string,
  orgId: string,
  runId: string,
  actor: ChainSessionActor | null,
): Promise<Record<string, string | undefined>> {
  if (!actor) {
    throw new Forbidden("Session user required to start chain run");
  }

  const sessionId = `chain-${runId}`;
  const sessionToken = await mintSessionToken({
    sub: actor.id,
    jti: sessionId,
    ns: namespaceId,
    org: orgId,
    role: actor.role,
    scopes: ["ops:*"],
  });

  return {
    MENTIKO_SESSION_ID: sessionId,
    MENTIKO_SESSION_TOKEN: sessionToken,
    MENTIKO_WEB_URL: new URL(request.url).origin,
    KOLLABOR_ENGINE_URL: process.env.KOLLABOR_ENGINE_URL,
  };
}

export function shouldRecordTaskExecutionRun({
  taskId,
  metadata,
}: TaskExecutionRunCandidate): boolean {
  if (!taskId || typeof taskId !== "string") return false;

  return shouldRecordTaskExecutionMetadata(metadata);
}

export async function startChainRun({
  request,
  namespaceId,
  orgId,
  body,
}: StartChainRunInput): Promise<StartChainRunResult> {
  const ip = getClientIp(request);
  const runsDir = resolveLinkRunsDir(namespaceId, orgId);
  const actor = await resolveChainSessionActor(request, namespaceId, orgId);
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
  const authorizedWorkspacePath = resolveAuthorizedWorkspacePath(namespaceId, orgId, requestedWorkspace, actor?.id);
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
    : mintRunId();
  const runDir = join(runsDir, runId);
  if (existsSync(runDir)) {
    throw new Conflict("Run already exists");
  }

  // Concurrency ceiling (phase-2 step 2) — ONE source of truth shared with the engine.
  // resolveMaxConcurrentChains() prefers MENTIKO_MAX_CONCURRENT_CHAINS (the same env the
  // bash engine reads) and falls back to the max_concurrent_runs system setting, so the
  // web guard and the engine queue enforce the identical number. We DO NOT hard-reject
  // at the cap (that was a silent-ish failure for the caller); instead we create the run
  // QUEUED (status `pending` with a clear message) and let the spawned CLI's bounded,
  // observable queue (lib/concurrency-cap.sh cap_acquire_chain_slot) admit it when a slot
  // frees — or surface it terminally `blocked` on max-wait expiry. Same queue, both paths.
  const maxConcurrentChains = resolveMaxConcurrentChains(namespaceId);
  let queuedAtCap = false;
  let activeCountAtAdmit = 0;
  if (maxConcurrentChains > 0) {
    const runDirs = existsSync(runsDir)
      ? readdirSync(runsDir).filter((d) => SAFE_RUN_ID_RE.test(d))
      : [];
    for (const dir of runDirs) {
      const rjPath = join(runsDir, dir, "run.json");
      if (!existsSync(rjPath)) continue;
      try {
        const rj = JSON.parse(readFileSync(rjPath, "utf-8"));
        if (rj.status === "running" || rj.status === "pending") activeCountAtAdmit++;
      } catch { /* skip corrupt */ }
    }
    if (activeCountAtAdmit >= maxConcurrentChains) {
      queuedAtCap = true;
      createNotification(namespaceId, {
        type: "info",
        title: "Chain run queued: concurrent limit",
        message: `${activeCountAtAdmit} chains already active (limit: ${maxConcurrentChains}). This run is queued and will start automatically when a slot frees.`,
        metadata: {
          chainId: callerChainId || validChainName.toLowerCase().replace(/\s+/g, "-"),
          runId,
        },
      });
    }
  }

  mkdirSync(runDir, { recursive: true });

  const runMetadata = normalizeRunMetadata(body.metadata);
  const decisionRunMetadata = runMetadata?.decisionId && runMetadata?.decisionPhase
    ? runMetadata
    : undefined;
  const generationRunMetadata = runMetadata?.generationJobId && runMetadata?.generationKind
    ? runMetadata
    : undefined;
  const runObject: Record<string, unknown> = {
    id: runId,
    chain: validChainName,
    chainId: callerChainId || validChainName.toLowerCase().replace(/\s+/g, "-"),
    goal: userPrompt || "",
    started: new Date().toISOString(),
    // Queued at the cap -> `pending` (existing status vocabulary; the UI renders it
    // neutral/"waiting") with a clear message. The spawned engine promotes it to
    // `running` on admission. Otherwise it starts `running` as before.
    status: queuedAtCap ? "pending" : "running",
    ...(queuedAtCap
      ? { status_message: `queued: waiting for a chain slot (${activeCountAtAdmit} active, limit ${maxConcurrentChains})` }
      : {}),
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

  if (generationRunMetadata || decisionRunMetadata) {
    const internalRunDir = join(runDir, ".internal");
    mkdirSync(internalRunDir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(internalRunDir, 0o700);
    } catch {}
    if (generationRunMetadata) {
      writeFileSync(
        join(internalRunDir, "generation-import-token"),
        `${resolveInternalAuthSecret("jobs-complete")}\n`,
        { mode: 0o600 }
      );
    }
    if (decisionRunMetadata) {
      writeFileSync(
        join(internalRunDir, "decision-import-token"),
        `${resolveInternalAuthSecret("decision-import")}\n`,
        { mode: 0o600 }
      );
    }
  }

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
  const executionTaskId = typeof taskId === "string" ? taskId : undefined;
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
  const sessionEnv = await buildChainSessionEnv(request, namespaceId, orgId, runId, actor);

  const childEnv = buildChildEnv({
    ...workspaceEnv,
    ...getSecretsEnvVars(namespaceId, orgId),
    ...profileEnv,
    ...sessionEnv,
    BETTER_AUTH_SECRET: resolveInternalAuthSecret("chain-run"),
    MENTIKO_DECISION_IMPORT_TOKEN: resolveInternalAuthSecret("decision-import"),
    MENTIKO_DECISION_ID: typeof decisionRunMetadata?.decisionId === "string" ? decisionRunMetadata.decisionId : undefined,
    MENTIKO_DECISION_PHASE: typeof decisionRunMetadata?.decisionPhase === "string" ? decisionRunMetadata.decisionPhase : undefined,
    MENTIKO_DECISION_SELECTED_OPTION_ID: typeof decisionRunMetadata?.selectedOptionId === "string" ? decisionRunMetadata.selectedOptionId : undefined,
    MENTIKO_DECISION_WORKSPACE_PATH: typeof decisionRunMetadata?.workspacePath === "string" ? decisionRunMetadata.workspacePath : undefined,
    MENTIKO_JOB_IMPORT_TOKEN: resolveInternalAuthSecret("jobs-complete"),
    MENTIKO_GENERATION_JOB_ID: typeof generationRunMetadata?.generationJobId === "string" ? generationRunMetadata.generationJobId : undefined,
    MENTIKO_GENERATION_KIND: typeof generationRunMetadata?.generationKind === "string" ? generationRunMetadata.generationKind : undefined,
    ...buildLocalAiGatewayProxyEnv(new URL(request.url).origin),
    MENTIKO_GLOBAL_ROOT: config.globalRoot,
    MENTIKO_CODE_ROOT: config.codeRoot,
    MENTIKO_PROJECT_ROOT: orgPath(namespaceId, orgId),
    MENTIKO_ORG_ROOT: orgPath(namespaceId, orgId),
    MENTIKO_NAMESPACE_ROOT: nsPath(namespaceId),
    NAMESPACE_ID: namespaceId,
    ORG_ID: orgId,
    MENTIKO_RUN_ID: runId,
    MENTIKO_CHAIN_ID: runObject.chainId as string,
    ...(executor && typeof executor === "string" && EXECUTOR_MAP[executor]
      ? { MENTIKO_CLI: EXECUTOR_MAP[executor] }
      : {}),
  });

  if (isRunnerV2Enabled(childEnv) && runMetadata?.runnerV2Probe === true) {
    const probeInput = {
      runDir: join(runDir, "runner-v2-probe"),
      eventsDir: config.eventsDir,
      env: childEnv,
      dryRun: runMetadata.runnerV2ProbeMode !== "live",
      dispatchExternalEffects: runMetadata.runnerV2DispatchExternalEffects === true,
      namespaceId,
      orgId,
    };
    const probe = runMetadata.runnerV2DispatchExternalEffects === true
      ? await runSyntheticRunnerV2ProbeWithDispatch(probeInput)
      : runSyntheticRunnerV2Probe(probeInput);
    writeFileSync(join(runDir, "runner-v2-probe.json"), JSON.stringify(probe, null, 2));
    const probeRunPath = join(runDir, "run.json");
    const probeRun = JSON.parse(readFileSync(probeRunPath, "utf-8"));
    probeRun.status = probe.status === "ok" ? "completed" : "failed";
    probeRun.status_message = probe.status === "ok"
      ? `runner-v2 typed ${probe.mode} probe completed`
      : `runner-v2 typed dry-run probe ${probe.reason}`;
    writeFileSync(probeRunPath, JSON.stringify(probeRun, null, 2));
    closeSync(logFd);
    return {
      runId,
      chainId: runObject.chainId as string,
      status: "started",
    };
  }

  const runnerV2Launch = isRunnerV2Enabled(childEnv)
    ? await startRunnerV2Launch({
      chainPath: validatedChainPath,
      runDir,
      runId,
      chainId: runObject.chainId as string,
      chainName: validChainName,
      workspacePath: authorizedWorkspacePath,
      taskId: executionTaskId,
      debug,
      logFd,
      cwd: config.codeRoot,
      env: childEnv,
    })
    : null;

  if (runnerV2Launch?.support === "unsupported") {
    closeSync(logFd);
    throw new Error(runnerV2Launch.reason);
  }

  const child = runnerV2Launch?.support === "supported"
    ? null
    : spawn(
        "/bin/zsh",
        ["-lc", `${shellEscape(binPath)} run ${shellEscape(validatedChainPath)}${wsFlag}${taskFlag}${debugFlag}`],
        {
          cwd: config.codeRoot,
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: childEnv,
        }
      );

  if (child) {
    child.unref();
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
  }
  closeSync(logFd);

  logAuditEvent("chain_complete", `Chain launched from web: ${validChainName}`, {
    chain_name: validChainName,
    run_id: runId,
    status: "running",
    namespace_id: namespaceId,
  }, ip).catch(() => {});

  if (executionTaskId && shouldRecordTaskExecutionRun({ taskId: executionTaskId, chainId: runObject.chainId as string, metadata: runMetadata })) {
    try {
      const task = taskGet(orgId, executionTaskId, namespaceId);
      const metadata = task?.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata)
        ? task.metadata as Record<string, unknown>
        : runMetadata || {};
      taskUpdate(orgId, executionTaskId, {
        status: "in_progress",
        metadata: executionStartedLifecycleMetadata({
          taskId: executionTaskId,
          metadata,
          runId,
          chainId: runObject.chainId as string,
        }),
      }, namespaceId);
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
