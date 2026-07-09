import { existsSync, readdirSync, readFileSync } from "fs";
import { basename, dirname, join } from "path";
import config, { ptyDaemonEnv } from "@/lib/config";
import { shellEscape } from "@/lib/api/audit-exec";
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
  config?: BootstrapChainConfig;
  agents?: BootstrapChainAgent[];
}

export interface AgentBootstrapPlanInput {
  chainPath: string;
  runDir: string;
  runId: string;
  agentId?: string;
  workspacePath?: string;
  namespaceId?: string;
  orgId?: string;
  env?: Record<string, string | undefined>;
  now?: Date;
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
  profileId?: string;
  profilePath?: string;
  profileReadiness?: AgentProfileReadinessConfig;
  runContextExports: Record<string, string>;
  instructionPath: string;
  instructionPointer: string;
  localStartCommand: string;
  monitorCommand: string;
}

export function buildAgentBootstrapPlan(input: AgentBootstrapPlanInput): AgentBootstrapPlan {
  const chain = readChain(input.chainPath);
  const agent = resolveAgent(chain, input.agentId);
  const projectRoot = input.workspacePath || chain.config?.project_root || input.env?.MENTIKO_PROJECT_ROOT || input.runDir;
  const artifactsDir = join(input.runDir, "artifacts");
  // events are org-scoped by convention (lib/config.sh EVENTS_DIR); a run-dir
  // default strands emitted events where the chain watcher and shell
  // completion never look.
  const eventsDir = input.env?.EVENTS_DIR || config.eventsDir || join(input.runDir, "events");
  const stateDir = input.env?.STATE_DIR || join(input.runDir, "state");
  const sessionPrefix = resolveSessionPrefix(chain, agent);
  const projectName = basename(projectRoot) || "workspace";
  const sessionName = `${projectName}-${sessionPrefix}-${input.runId}`;
  const statePath = join(stateDir, `${sessionPrefix}-${input.runId}.state`);
  const instructionPath = join(artifactsDir, `${agent.id}-instructions.md`);
  const profile = resolveAgentProfile({
    chain,
    agent,
    projectRoot,
    env: input.env,
  });
  const runContextExports = {
    PATH: `${join(config.codeRoot, "bin")}:${input.env?.PATH || process.env.PATH || ""}`,
    MENTIKO_BIN: join(config.codeRoot, "bin", "mentiko"),
    MENTIKO_RUN_ID: input.runId,
    RUN_ID: input.runId,
    NAMESPACE_ID: input.namespaceId || input.env?.NAMESPACE_ID || "default",
    ORG_ID: input.orgId || input.env?.ORG_ID || "default",
    MENTIKO_AGENT_ID: agent.id || "",
    MENTIKO_AGENT_EMITS: agent.emits || "",
    MENTIKO_CODE_ROOT: config.codeRoot,
    MENTIKO_PROJECT_ROOT: input.env?.MENTIKO_PROJECT_ROOT || projectRoot,
    MENTIKO_ORG_ROOT: input.env?.MENTIKO_ORG_ROOT || "",
    MENTIKO_NAMESPACE_ROOT: input.env?.MENTIKO_NAMESPACE_ROOT || "",
    RUNS_DIR: input.env?.RUNS_DIR || dirname(input.runDir),
    // completion resolves the run dir from env; without this a typed-spawned
    // monitor hands the completion session an empty MENTIKO_RUN_DIR and the
    // typed bridge exits unsupported (shell fallback) every time.
    MENTIKO_RUN_DIR: input.runDir,
    STATE_DIR: stateDir,
    EVENTS_DIR: eventsDir,
    ARTIFACTS_DIR: artifactsDir,
    MENTIKO_SESSION_ID: input.env?.MENTIKO_SESSION_ID || "",
    MENTIKO_SESSION_TOKEN: input.env?.MENTIKO_SESSION_TOKEN || "",
    MENTIKO_WEB_URL: input.env?.MENTIKO_WEB_URL || "",
    KOLLABOR_ENGINE_URL: input.env?.KOLLABOR_ENGINE_URL || "",
    ...ptyDaemonEnv(),
    MENTIKO_READINESS_FAIL_CLOSED: input.env?.MENTIKO_READINESS_FAIL_CLOSED || "",
    MENTIKO_CLI_READY_TIMEOUT: input.env?.MENTIKO_CLI_READY_TIMEOUT || "",
    MENTIKO_CLI_READY_POLL: input.env?.MENTIKO_CLI_READY_POLL || "",
    // the monitor inherits these exports and hands them to the completion
    // session; without them a typed-launched run always falls back to shell
    // completion because the pty daemon strips spawn env to its whitelist.
    MENTIKO_RUNNER_V2: input.env?.MENTIKO_RUNNER_V2 || "",
    MENTIKO_RUNNER_V2_COMPLETION: input.env?.MENTIKO_RUNNER_V2_COMPLETION || "",
    MENTIKO_MONITOR_V2: input.env?.MENTIKO_MONITOR_V2 || "1",
  };
  const instructionPointer = buildInstructionPointer(agent.id || "", instructionPath);

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
    ...(profile.id ? { profileId: profile.id } : {}),
    ...(profile.path ? { profilePath: profile.path } : {}),
    ...(profile.readiness ? { profileReadiness: profile.readiness } : {}),
    runContextExports,
    instructionPath,
    instructionPointer,
    localStartCommand: buildLocalStartCommand(projectRoot, runContextExports, profile.path, input.env),
    monitorCommand: buildMonitorCommand({
      sessionName,
      chainPath: input.chainPath,
      agentId: agent.id || "",
      agentName: agent.name || agent.id || "",
      emits: agent.emits || "",
      interval: String(agent.monitor_interval || chain.config?.monitor_interval || 5),
      maxStale: String(agent.max_stale_count || 5),
      runId: input.runId,
      env: runContextExports,
    }),
  };
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

function resolveAgentProfile(input: ProfileResolutionInput): ProfileResolution {
  const profilesDir = resolveProfilesDir(input.env);
  const requested = [
    (input.agent as BootstrapChainAgent & { agent_profile?: string }).agent_profile,
    input.chain.default_agent_profile,
  ].filter(Boolean) as string[];
  const workspaceProfile = resolveWorkspaceDefaultProfile(input.projectRoot, input.env);
  const namespaceDefault = resolveNamespaceDefaultProfile(profilesDir);
  const candidates = [...requested, workspaceProfile, namespaceDefault].filter(Boolean) as string[];

  for (const id of candidates) {
    const path = profilePathForId(profilesDir, id);
    if (path && existsSync(path)) {
      return { id, path, readiness: readProfileReadiness(path) };
    }
  }

  if (requested.length > 0) {
    throw new Error(`requested agent profile '${requested[0]}' was not found and no valid fallback profile exists`);
  }
  return {};
}

function readProfileReadiness(path: string): AgentProfileReadinessConfig | undefined {
  try {
    const profile = JSON.parse(readFileSync(path, "utf8")) as {
      readiness?: AgentProfileReadinessConfig;
    };
    return profile.readiness;
  } catch {
    return undefined;
  }
}

function resolveProfilesDir(env: Record<string, string | undefined> | undefined): string {
  return env?.AGENT_PROFILES_DIR
    || join(env?.MENTIKO_ORG_ROOT || env?.NAMESPACE_ROOT || env?.MENTIKO_NAMESPACE_ROOT || "", "agent-profiles");
}

function profilePathForId(profilesDir: string, id: string): string | undefined {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) return undefined;
  return join(profilesDir, `${id}.json`);
}

function resolveWorkspaceDefaultProfile(
  projectRoot: string,
  env: Record<string, string | undefined> | undefined,
): string | undefined {
  const orgRoot = env?.MENTIKO_ORG_ROOT || env?.NAMESPACE_ROOT || env?.MENTIKO_NAMESPACE_ROOT;
  if (!orgRoot) return undefined;
  const workspacesPath = join(orgRoot, "workspaces.json");
  if (!existsSync(workspacesPath)) return undefined;
  try {
    const workspaces = JSON.parse(readFileSync(workspacesPath, "utf8")) as Array<{
      path?: string;
      default_agent_profile?: string;
    }>;
    return workspaces.find((workspace) => workspace.path === projectRoot)?.default_agent_profile;
  } catch {
    return undefined;
  }
}

function resolveNamespaceDefaultProfile(profilesDir: string): string | undefined {
  if (!profilesDir || !existsSync(profilesDir)) return undefined;
  try {
    for (const file of readdirSync(profilesDir)) {
      if (!file.endsWith(".json")) continue;
      const profile = JSON.parse(readFileSync(join(profilesDir, file), "utf8")) as {
        id?: string;
        isDefault?: boolean;
      };
      if (profile.isDefault && profile.id) return profile.id;
    }
  } catch {
    return undefined;
  }
  return undefined;
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
  const agentProfileLib = join(config.codeRoot, "lib", "agent-profile.sh");
  const profileCommand = profilePath
    ? `source ${shellEscape(agentProfileLib)} && eval "$(build_profile_command ${shellEscape(profilePath)} --interactive)"`
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
  const agentFunctions = join(config.codeRoot, "lib", "agent-functions.sh");
  const compiledMonitor = join(config.codeRoot, "lib", "monitor-v2.js");
  const webRoot = join(config.codeRoot, "web");
  const sourceMonitor = join(webRoot, "lib", "runner-v2", "monitor-cli.ts");
  const context = `Agent: ${input.agentName} (${input.agentId}). Emits: ${input.emits}.`;
  const shellCommand = `monitor-chain-agent ${shellEscape(input.sessionName)} ${shellEscape(input.interval)} ${shellEscape(context)} ${shellEscape(input.chainPath)} ${shellEscape(input.maxStale)}`;
  const typedCommand = [
    "if command -v node >/dev/null 2>&1; then",
    `if [[ -f ${shellEscape(compiledMonitor)} ]]; then node ${shellEscape(compiledMonitor)} ${shellEscape(input.sessionName)} ${shellEscape(input.interval)} ${shellEscape(context)} ${shellEscape(input.chainPath)} ${shellEscape(input.maxStale)}; _monitor_v2_status=$?; if [[ "$_monitor_v2_status" -ne 64 ]]; then exit "$_monitor_v2_status"; fi; fi;`,
    "fi;",
    "if command -v npx >/dev/null 2>&1; then",
    `if [[ -f ${shellEscape(sourceMonitor)} ]]; then (cd ${shellEscape(webRoot)} && npx tsx lib/runner-v2/monitor-cli.ts ${shellEscape(input.sessionName)} ${shellEscape(input.interval)} ${shellEscape(context)} ${shellEscape(input.chainPath)} ${shellEscape(input.maxStale)}); _monitor_v2_status=$?; if [[ "$_monitor_v2_status" -ne 64 ]]; then exit "$_monitor_v2_status"; fi; fi;`,
    "fi;",
    shellCommand,
  ].join(" ");
  return [
    `source ${shellEscape(agentFunctions)}`,
    ...Object.entries(input.env)
      .filter(([, value]) => value !== "")
      .map(([key, value]) => `export ${key}=${shellEscape(value)}`),
    `export CHAIN_FILE=${shellEscape(input.chainPath)}`,
    `export MENTIKO_RUN_ID=${shellEscape(input.runId)}`,
    `export RUN_ID=${shellEscape(input.runId)}`,
    `export MENTIKO_AGENT_ID=${shellEscape(input.agentId)}`,
    `if [[ "\${MENTIKO_MONITOR_V2:-}" =~ ^(1|true|yes|on)$ ]]; then ${typedCommand}; else ${shellCommand}; fi`,
  ].join("; ");
}
