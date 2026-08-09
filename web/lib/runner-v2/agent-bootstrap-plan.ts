import { readFileSync } from "fs";
import { basename, dirname, join } from "path";
import { buildLocalAiGatewayProxyEnv } from "@/lib/ai-gateway/local-proxy-env";
import config, { ptyDaemonEnv } from "@/lib/config";
import { shellEscape } from "@/lib/api/audit-exec";
import { runnerAgentStatePath } from "@/lib/runner-v2/agent-state";
import { resolveAgentProfile as resolveTypedAgentProfile } from "@/lib/runner-v2/agent-profile";
import type { AgentProfileReadinessConfig } from "@/lib/types";

export interface BootstrapChainAgent {
  id?: string;
  name?: string;
  role?: string;
  prompt?: string;
  emits?: string;
  triggers?: string[];
  session_prefix?: string;
  monitor?: boolean;
  monitor_interval?: number;
  max_stale_count?: number;
}

export interface BootstrapChainConfig {
  project_root?: string;
  session_prefix?: string;
  monitor?: boolean;
  monitor_interval?: number;
  max_rounds?: number;
  schedule?: string;
}

export interface BootstrapChainFile {
  id?: string;
  name?: string;
  default_agent_profile?: string;
  metadata?: {
    coreGenerationChain?: boolean;
    [key: string]: unknown;
  };
  config?: BootstrapChainConfig;
  agents?: BootstrapChainAgent[];
}

export interface AgentBootstrapPlanInput {
  chainPath: string;
  runDir: string;
  runId: string;
  agentId?: string;
  workspacePath?: string;
  /** Stable registered workspace used for profile and PTY identity lookup. */
  sourceWorkspacePath?: string;
  namespaceId?: string;
  orgId?: string;
  env?: Record<string, string | undefined>;
  now?: Date;
}

export interface AgentBootstrapMonitorSpec {
  chainPath: string;
  emits: string;
  interval: string;
  maxStale: string;
  runId: string;
}

export interface AgentBootstrapPlan {
  agentId: string;
  agentName: string;
  sessionPrefix: string;
  sessionName: string;
  monitorSessionName: string;
  statePath: string;
  artifactsDir: string;
  eventsDir: string;
  projectRoot: string;
  sourceWorkspacePath: string;
  /** Core generation chains may treat generation-result.json as the handoff. */
  coreGenerationChain?: boolean;
  profileId?: string;
  profilePath?: string;
  profileReadiness?: AgentProfileReadinessConfig;
  runContextExports: Record<string, string>;
  instructionPath: string;
  instructionPointer: string;
  localStartCommand: string;
  monitorSpec: AgentBootstrapMonitorSpec;
  monitorCommand: string;
}

export function buildAgentBootstrapPlan(input: AgentBootstrapPlanInput): AgentBootstrapPlan {
  const chain = readChain(input.chainPath);
  const agent = resolveAgent(chain, input.agentId);
  const projectRoot = input.workspacePath || chain.config?.project_root || input.env?.MENTIKO_PROJECT_ROOT || input.runDir;
  const sourceWorkspacePath = input.sourceWorkspacePath || projectRoot;
  const artifactsDir = join(input.runDir, "artifacts");
  // One configured project event root. Runner children may receive the same
  // root through EVENTS_DIR; there is no run-local compatibility directory.
  const eventsDir = input.env?.EVENTS_DIR || config.eventsDir;
  // Agent state has one namespace-scoped canonical root. A run-local parallel
  // record made mixed shell/typed runs invisible to the live stream reader.
  const stateDir = input.env?.STATE_DIR || config.stateDir;
  const sessionPrefix = resolveSessionPrefix(chain, agent);
  const projectName = basename(sourceWorkspacePath) || "workspace";
  const sessionName = `${projectName}-${sessionPrefix}-${input.runId}`;
  const statePath = runnerAgentStatePath(stateDir, sessionPrefix, input.runId);
  const instructionPath = join(artifactsDir, `${agent.id}-instructions.md`);
  const profile = resolveAgentProfile(input.chainPath, agent.id || "", sourceWorkspacePath, input.env);
  const gatewayEnv = resolveLocalAiGatewayProxyEnv(input.env);
  const runContextExports = {
    PATH: `${join(config.codeRoot, "bin")}:${input.env?.PATH || process.env.PATH || ""}`,
    MENTIKO_BIN: join(config.codeRoot, "bin", "mentiko"),
    MENTIKO_RUN_ID: input.runId,
    RUN_ID: input.runId,
    NAMESPACE_ID: input.namespaceId || input.env?.NAMESPACE_ID || "default",
    ORG_ID: input.orgId || input.env?.ORG_ID || "default",
    MENTIKO_AGENT_ID: agent.id || "",
    MENTIKO_AGENT_EMITS: agent.emits || "",
    MENTIKO_AGENT_PROFILE_PATH: profile.path || "",
    MENTIKO_CODE_ROOT: config.codeRoot,
    // Every process-facing workspace value must point at the node worktree.
    // The registered source path remains plan metadata only and is never
    // exported to an agent process that could mutate it.
    MENTIKO_PROJECT_ROOT: projectRoot,
    MENTIKO_ORG_ROOT: input.env?.MENTIKO_ORG_ROOT || "",
    MENTIKO_NAMESPACE_ROOT: input.env?.MENTIKO_NAMESPACE_ROOT || "",
    // Completion copies this typed launch context into routed launches. Keep a
    // caller-supplied profile root so direct CLI runs preserve profile identity
    // for every downstream agent instead of re-resolving against an unrelated
    // process environment.
    AGENT_PROFILES_DIR: input.env?.AGENT_PROFILES_DIR || config.agentProfilesDir,
    RUNS_DIR: input.env?.RUNS_DIR || dirname(input.runDir),
    // Completion resolves the run dir from this explicit typed launch context.
    MENTIKO_RUN_DIR: input.runDir,
    STATE_DIR: stateDir,
    EVENTS_DIR: eventsDir,
    ARTIFACTS_DIR: artifactsDir,
    MENTIKO_SESSION_ID: input.env?.MENTIKO_SESSION_ID || "",
    MENTIKO_SESSION_TOKEN: input.env?.MENTIKO_SESSION_TOKEN || "",
    MENTIKO_WEB_URL: input.env?.MENTIKO_WEB_URL || "",
    KOLLABOR_ENGINE_URL: input.env?.KOLLABOR_ENGINE_URL || "",
    TASK_ID: input.env?.TASK_ID || "",
    TASK_TITLE: input.env?.TASK_TITLE || "",
    TASK_DESCRIPTION: input.env?.TASK_DESCRIPTION || "",
    TASK_TYPE: input.env?.TASK_TYPE || "",
    TASK_PRIORITY: input.env?.TASK_PRIORITY || "",
    TASK_ACCEPTANCE_CRITERIA: input.env?.TASK_ACCEPTANCE_CRITERIA || "",
    TASK_DESIGN: input.env?.TASK_DESIGN || "",
    TASK_NOTES: input.env?.TASK_NOTES || "",
    TASK_COMMENTS: input.env?.TASK_COMMENTS || "",
    TASK_CONTEXT: input.env?.TASK_CONTEXT || "",
    ...gatewayEnv,
    ...ptyDaemonEnv(),
    MENTIKO_READINESS_FAIL_CLOSED: input.env?.MENTIKO_READINESS_FAIL_CLOSED || "",
    MENTIKO_CLI_READY_TIMEOUT: input.env?.MENTIKO_CLI_READY_TIMEOUT || "",
    MENTIKO_CLI_READY_POLL: input.env?.MENTIKO_CLI_READY_POLL || "",
    MENTIKO_STARTUP_RECOVERY: input.env?.MENTIKO_STARTUP_RECOVERY || "",
    MENTIKO_STARTUP_RECOVERY_MAX: input.env?.MENTIKO_STARTUP_RECOVERY_MAX || "",
    MENTIKO_ADVISOR_STALE_COUNT: input.env?.MENTIKO_ADVISOR_STALE_COUNT || "",
    MENTIKO_MONITOR_MAX_NUDGES: input.env?.MENTIKO_MONITOR_MAX_NUDGES || "",
    MENTIKO_MONITOR_NEVER_ARMED_GRACE: input.env?.MENTIKO_MONITOR_NEVER_ARMED_GRACE || "",
    // The monitor inherits these exports and hands them to typed completion.
    MENTIKO_RUNNER_V2: input.env?.MENTIKO_RUNNER_V2 || "",
    MENTIKO_RUNNER_V2_COMPLETION: input.env?.MENTIKO_RUNNER_V2_COMPLETION || "",
  };
  const instructionPointer = buildInstructionPointer(agent.id || "", instructionPath);
  const monitorSpec: AgentBootstrapMonitorSpec = {
    chainPath: input.chainPath,
    emits: agent.emits || "",
    interval: input.env?.MENTIKO_MONITOR_INTERVAL
      || String(agent.monitor_interval || chain.config?.monitor_interval || 5),
    maxStale: input.env?.MENTIKO_MONITOR_MAX_STALE
      || String(agent.max_stale_count || 5),
    runId: input.runId,
  };

  return {
    agentId: agent.id || "",
    agentName: agent.name || agent.id || "",
    sessionPrefix,
    sessionName,
    monitorSessionName: `monitor-${sessionName}`,
    statePath,
    artifactsDir,
    eventsDir,
    projectRoot,
    sourceWorkspacePath,
    ...(chain.metadata?.coreGenerationChain === true ? { coreGenerationChain: true } : {}),
    ...(profile.id ? { profileId: profile.id } : {}),
    ...(profile.path ? { profilePath: profile.path } : {}),
    ...(profile.readiness ? { profileReadiness: profile.readiness } : {}),
    runContextExports,
    instructionPath,
    instructionPointer,
    localStartCommand: buildLocalStartCommand(projectRoot, runContextExports, profile.path, input.env),
    monitorSpec,
    monitorCommand: buildMonitorCommand({
      sessionName,
      chainPath: monitorSpec.chainPath,
      agentId: agent.id || "",
      agentName: agent.name || agent.id || "",
      emits: monitorSpec.emits,
      interval: monitorSpec.interval,
      maxStale: monitorSpec.maxStale,
      runId: monitorSpec.runId,
      env: runContextExports,
    }),
  };
}

/** Retarget process-facing plan fields while preserving registered-workspace identity and profile selection. */
export function retargetAgentBootstrapPlan(
  plan: AgentBootstrapPlan,
  projectRoot: string,
  env?: Record<string, string | undefined>,
): AgentBootstrapPlan {
  const runContextExports = {
    ...plan.runContextExports,
    MENTIKO_PROJECT_ROOT: projectRoot,
  };
  return {
    ...plan,
    projectRoot,
    runContextExports,
    localStartCommand: buildLocalStartCommand(
      projectRoot,
      runContextExports,
      plan.profilePath,
      env,
    ),
    monitorCommand: buildMonitorCommand({
      sessionName: plan.sessionName,
      chainPath: plan.monitorSpec.chainPath,
      agentId: plan.agentId,
      agentName: plan.agentName,
      emits: plan.monitorSpec.emits,
      interval: plan.monitorSpec.interval,
      maxStale: plan.monitorSpec.maxStale,
      runId: plan.monitorSpec.runId,
      env: runContextExports,
    }),
  };
}

/**
 * The typed launch plan owns local AI-gateway propagation. This includes only
 * the internal proxy request credential, never model-provider API keys. An
 * already resolved request origin/token wins over a process-local default.
 */
function resolveLocalAiGatewayProxyEnv(env?: Record<string, string | undefined>): Record<string, string> {
  const inherited = [
    "MENTIKO_AI_GATEWAY_LOCAL_PROXY_ENABLED",
    "MENTIKO_AI_GATEWAY_LOCAL_BASE_URL",
    "MENTIKO_AI_GATEWAY_LOCAL_TOKEN",
  ].reduce<Record<string, string>>((result, key) => {
    const value = env?.[key];
    if (typeof value === "string" && value) result[key] = value;
    return result;
  }, {});
  return { ...buildLocalAiGatewayProxyEnv(env?.MENTIKO_WEB_URL), ...inherited };
}

export function readChain(path: string): BootstrapChainFile {
  return JSON.parse(readFileSync(path, "utf8")) as BootstrapChainFile;
}

export function resolveAgent(chain: BootstrapChainFile, agentId?: string): BootstrapChainAgent {
  const agents = Array.isArray(chain.agents) ? chain.agents : [];
  const selected = agentId
    ? agents.find((agent) => agent.id === agentId)
    : agents.find((agent) => Array.isArray(agent.triggers) && agent.triggers.includes("manual-start")) || agents[0];
  if (!selected?.id) {
    throw new Error("runner-v2 bootstrap requires an agent id");
  }
  return selected;
}

function resolveSessionPrefix(chain: BootstrapChainFile, agent: BootstrapChainAgent): string {
  if (agent.session_prefix) return agent.session_prefix;
  return chain.config?.session_prefix ? `${chain.config.session_prefix}-${agent.id}` : agent.id || "agent";
}

interface ProfileResolutionInput {
  chain: BootstrapChainFile;
  agent: BootstrapChainAgent;
  projectRoot: string;
  env: Record<string, string | undefined> | undefined;
}

interface ProfileResolution {
  id?: string;
  path?: string;
  readiness?: AgentProfileReadinessConfig;
}

function resolveAgentProfile(
  chainPath: string,
  agentId: string,
  projectRoot: string,
  env: Record<string, string | undefined> | undefined,
): ProfileResolution {
  const explicitOrgRoot = env?.MENTIKO_ORG_ROOT || env?.NAMESPACE_ROOT || env?.MENTIKO_NAMESPACE_ROOT;
  const orgRoot = explicitOrgRoot || config.orgRoot;
  // Direct typed CLI launches carry process.env, not a web-request context.
  // They must therefore use config's canonical profile root when no explicit
  // runtime root was supplied. Routed launches inherit the resolved profile
  // path from this plan, so resolving it here preserves the same profile over
  // the whole typed lifecycle.
  const profilesDir = env?.AGENT_PROFILES_DIR || (explicitOrgRoot ? join(explicitOrgRoot, "agent-profiles") : config.agentProfilesDir);
  if (!profilesDir) return {};
  const profile = resolveTypedAgentProfile({ chainPath, agentId, projectRoot, profilesDir, orgRoot });
  return profile ? { id: profile.id, path: profile.path, readiness: profile.profile.readiness } : {};
}

function buildInstructionPointer(agentId: string, instructionPath: string): string {
  return [
    `You are Mentiko agent: ${agentId}.`,
    "",
    "Your full instructions are in this file:",
    instructionPath,
    "",
    "Read that file first, then execute it exactly.",
    "When the instructions are complete, finish with AGENT_COMPLETE on its own final line.",
  ].join("\n");
}

function buildLocalStartCommand(
  projectRoot: string,
  runContextExports: Record<string, string>,
  profilePath: string | undefined,
  env: Record<string, string | undefined> | undefined,
): string {
  const cli = env?.MENTIKO_CLI || "claude";
  const agentProfileCli = join(config.codeRoot, "lib", "runner-agent-profile.js");
  const profileCommand = profilePath
    ? `eval "$(node ${shellEscape(agentProfileCli)} command --profile-path ${shellEscape(profilePath)} --interactive true --namespace-id ${shellEscape(runContextExports.NAMESPACE_ID)} --org-id ${shellEscape(runContextExports.ORG_ID)})"`
    : `exec ${shellEscape(cli)}`;
  return [
    `cd ${shellEscape(projectRoot)}`,
    "unset CLAUDECODE",
    ...Object.entries(runContextExports).map(([key, value]) => `export ${key}=${shellEscape(value)}`),
    profileCommand,
  ].join(" && ");
}

function buildMonitorCommand(input: {
  sessionName: string;
  chainPath: string;
  agentId: string;
  agentName: string;
  emits: string;
  interval: string;
  maxStale: string;
  runId: string;
  env: Record<string, string>;
}): string {
  const compiledMonitor = join(config.codeRoot, "lib", "monitor-v2.js");
  const context = `Agent: ${input.agentName} (${input.agentId}). Emits: ${input.emits}.`;
  return [
    ...Object.entries(input.env)
      .filter(([, value]) => value !== "")
      .map(([key, value]) => `export ${key}=${shellEscape(value)}`),
    `export CHAIN_FILE=${shellEscape(input.chainPath)}`,
    `export MENTIKO_RUN_ID=${shellEscape(input.runId)}`,
    `export RUN_ID=${shellEscape(input.runId)}`,
    `export MENTIKO_AGENT_ID=${shellEscape(input.agentId)}`,
    `exec node ${shellEscape(compiledMonitor)} ${shellEscape(input.sessionName)} ${shellEscape(input.interval)} ${shellEscape(context)} ${shellEscape(input.chainPath)} ${shellEscape(input.maxStale)}`,
  ].join("; ");
}
