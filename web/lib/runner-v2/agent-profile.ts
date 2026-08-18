import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { resolveProfilePermissionArgs, splitProfileArgumentString } from "@/lib/runner-v2/agent-profile-args";
import { createClaudeMentikoMcpConfig, withClaudeMentikoMcpCleanup } from "@/lib/runner-v2/claude-mentiko-mcp-config";
import { getSecretByName } from "@/lib/secrets/secrets-store";
import type { AgentProfile, AgentProfileReadinessConfig } from "@/lib/types";

const PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ENV_KEY = /^[A-Z_][A-Z0-9_]*$/;
const SECRET_REFERENCE = /^\{secret:([^}]+)\}$/;

export interface AgentProfileResolutionInput {
  chainPath: string;
  agentId: string;
  projectRoot?: string;
  profilesDir: string;
  orgRoot?: string;
}

export interface ResolvedAgentProfile {
  id: string;
  name: string;
  path: string;
  source: "agent" | "chain" | "workspace" | "namespace" | "advisor" | "explicit";
  profile: AgentProfile;
}

export interface ProfileCommandInput {
  profilePath: string;
  interactive: boolean;
  namespaceId: string;
  orgId: string;
  modelOverride?: string;
  purpose?: "agent" | "relay";
}

interface ChainProfileShape {
  default_agent_profile?: unknown;
  agents?: Array<{ id?: unknown; agent_profile?: unknown }>;
}

interface WorkspaceShape {
  path?: unknown;
  default_agent_profile?: unknown;
}

export function resolveAgentProfile(input: AgentProfileResolutionInput): ResolvedAgentProfile | undefined {
  const chain = readJson(input.chainPath, "chain") as ChainProfileShape;
  const agents = Array.isArray(chain.agents) ? chain.agents : [];
  const agent = agents.find((candidate) => candidate.id === input.agentId);
  if (!agent) throw new Error(`Agent '${input.agentId}' is not defined in ${input.chainPath}`);

  const agentId = optionalProfileId(agent.agent_profile, "agent.agent_profile");
  if (agentId) return resolveExactProfile(input.profilesDir, agentId, "agent");

  const chainId = optionalProfileId(chain.default_agent_profile, "chain.default_agent_profile");
  if (chainId) return resolveExactProfile(input.profilesDir, chainId, "chain");

  const workspaceId = resolveWorkspaceProfileId(input.projectRoot, input.orgRoot);
  if (workspaceId) return resolveExactProfile(input.profilesDir, workspaceId, "workspace");

  return resolveDefaultProfile(input.profilesDir, "namespace");
}

export function resolveDefaultProfile(profilesDir: string, source: "namespace" | "advisor" = "namespace"): ResolvedAgentProfile | undefined {
  const candidates = listProfileFiles(profilesDir)
    .map((path) => loadAgentProfile(path));
  const matches = candidates.filter((candidate) => source === "advisor"
    ? candidate.profile.isAdvisorDefault === true
    : candidate.profile.isDefault === true);
  if (matches.length > 1) throw new Error(`Multiple ${source} default agent profiles exist in ${profilesDir}`);
  const selected = matches[0];
  return selected ? { ...selected, source } : undefined;
}

export function resolveExactProfile(
  profilesDir: string,
  profileId: string,
  source: ResolvedAgentProfile["source"] = "explicit",
): ResolvedAgentProfile {
  assertProfileId(profileId, "profile id");
  const path = join(profilesDir, `${profileId}.json`);
  if (!existsSync(path)) throw new Error(`Agent profile '${profileId}' does not exist at ${path}`);
  return { ...loadAgentProfile(path), source };
}

export function loadAgentProfile(profilePath: string): Omit<ResolvedAgentProfile, "source"> {
  if (!isAbsolute(profilePath)) throw new Error(`Agent profile path must be absolute: ${profilePath}`);
  const raw = readJson(profilePath, "agent profile");
  const profile = validateAgentProfile(raw, profilePath);
  const expectedId = basename(profilePath, ".json");
  if (expectedId !== profile.id) throw new Error(`Agent profile id '${profile.id}' does not match file name '${expectedId}'`);
  return { id: profile.id, name: profile.name, path: profilePath, profile };
}

export function buildAgentProfileCommand(input: ProfileCommandInput): string {
  const { profile } = loadAgentProfile(input.profilePath);
  const model = input.modelOverride ?? (input.purpose === "relay" ? profile.relay_model ?? profile.model : profile.model);
  const codex = profile.cli === "codex";
  // Validate every configured argv fragment before creating private env or MCP
  // files. Invalid profile syntax must fail without leaving launch artifacts.
  const configuredPipeArgs = input.interactive || !profile.pipe_flag
    ? []
    : splitProfileArgumentString(profile.pipe_flag, "pipe_flag");
  // `exec` is a subcommand, not a pipe-mode flag. Older Codex profiles stored
  // it in pipe_flag, which is omitted for PTY launches and would also be
  // duplicated once the Codex automation command is generated here.
  const pipeArgs = codex
    ? configuredPipeArgs.filter((argument) => argument !== "exec")
    : configuredPipeArgs;
  const permissionArgs = resolveProfilePermissionArgs(profile.cli, profile.permission_flag);
  const envFile = writeProfileEnvFile(profile, input.namespaceId, input.orgId);
  const mentikoMcp = profile.cli === "claude" ? createClaudeMentikoMcpConfig(process.env) : undefined;
  const codexArgs = codex
    ? [
        "exec",
        "-c",
        "check_for_update_on_startup=false",
        "--dangerously-bypass-hook-trust",
      ]
    : [];
  const args = [
    profile.cli,
    ...codexArgs,
    ...pipeArgs,
    ...permissionArgs,
    ...(model ? ["--model", model] : []),
    ...(profile.extra_args ?? []),
    // `--strict-mcp-config` prevents an old user-level `mentiko` entry from
    // overriding this run's URL/session capability.
    ...(mentikoMcp ? ["--mcp-config", mentikoMcp.path, "--strict-mcp-config"] : []),
  ];
  const command = withClaudeMentikoMcpCleanup(args.map(shellQuote).join(" "), mentikoMcp);
  const setup = [
    envFile ? `source ${shellQuote(envFile)}; rm -f ${shellQuote(envFile)}; rmdir ${shellQuote(dirname(envFile))} 2>/dev/null || true` : "",
    envFile && !Object.hasOwn(profile.env ?? {}, "ANTHROPIC_API_KEY") ? "unset ANTHROPIC_API_KEY" : "",
    profile.pre_exec ?? "",
    ...(codex ? [buildCodexSetup()] : []),
    ...(profile.cli === "claude" && input.interactive ? [buildClaudeTrustSetup()] : []),
    command,
  ].filter(Boolean);
  return setup.join("; ");
}

/**
 * Claude Code stores workspace-trust acceptance per-cwd in ~/.claude.json. Every
 * run spawns claude in a fresh worktree cwd, so the interactive "Bypass
 * Permissions mode / trust this folder" acceptance prompt fires every time and
 * stalls the PTY. Pre-write the project entry with trust accepted, same as
 * buildCodexSetup does for Codex. Non-interactive (-p) launches skip the
 * dialog on their own and don't need this.
 */
function buildClaudeTrustSetup(): string {
  const script = "const fs=require('fs'),os=require('os'),path=require('path');"
    + "const cfg=path.join(os.homedir(),'.claude.json');"
    + "let d={};try{d=JSON.parse(fs.readFileSync(cfg,'utf8'))}catch{}"
    + "d.projects=d.projects||{};"
    + "const c=process.cwd();"
    + "d.projects[c]={...(d.projects[c]||{}),"
    + "hasTrustDialogAccepted:true,hasCompletedProjectOnboarding:true,"
    + "projectOnboardingSeenCount:Math.max(1,(d.projects[c]||{}).projectOnboardingSeenCount||0)};"
    + "const t=cfg+'.mentiko.'+process.pid;"
    + "fs.writeFileSync(t,JSON.stringify(d));fs.renameSync(t,cfg);";
  return `node -e ${shellQuote(script)} 2>/dev/null || true`;
}

/**
 * Give each Codex invocation a disposable config home. Codex reads trust and
 * update settings before `exec` can consume the runner's stdin, while auth is
 * still needed for OAuth-backed profiles. Copying only auth.json preserves the
 * credential without allowing a user's config/plugins to affect this run.
 */
function buildCodexSetup(): string {
  return [
    // Capture the caller's auth location before replacing CODEX_HOME.
    `MENTIKO_CODEX_AUTH_HOME="\${CODEX_HOME:-\$HOME/.codex}"`,
    `CODEX_HOME="$(mktemp -d "\${TMPDIR:-/tmp}/mentiko-codex-home.XXXXXX")"`,
    "export CODEX_HOME",
    `if [ -f "$MENTIKO_CODEX_AUTH_HOME/auth.json" ]; then cp "$MENTIKO_CODEX_AUTH_HOME/auth.json" "$CODEX_HOME/auth.json"; chmod 600 "$CODEX_HOME/auth.json"; fi`,
    // Codex uses the absolute project path as the TOML table key. Escape
    // backslashes and double quotes before writing a basic-string key.
    String.raw`MENTIKO_CODEX_PROJECT="$(pwd -P)"`,
    String.raw`MENTIKO_CODEX_PROJECT_KEY="$(printf '%s' "$MENTIKO_CODEX_PROJECT" | sed 's/\\/\\\\/g; s/"/\\"/g')"`,
    `printf 'check_for_update_on_startup = false\\n[projects."%s"]\\ntrust_level = "trusted"\\n' "$MENTIKO_CODEX_PROJECT_KEY" > "$CODEX_HOME/config.toml"`,
    `trap 'rm -rf "$CODEX_HOME"' EXIT`,
  ].join("; ");
}

export function profileTranscriptConfig(profilePath: string): { cli: string; logPath?: string } {
  const { profile } = loadAgentProfile(profilePath);
  return { cli: profile.cli, ...(profile.log_path ? { logPath: profile.log_path } : {}) };
}

export function validateAgentProfile(value: unknown, path: string): AgentProfile {
  if (!isRecord(value)) throw new Error(`Invalid agent profile JSON at ${path}`);
  const id = requiredString(value.id, "id", path);
  assertProfileId(id, "profile id");
  const name = requiredString(value.name, "name", path);
  const cli = requiredString(value.cli, "cli", path);
  const profile: AgentProfile = {
    id,
    name,
    cli,
    isDefault: value.isDefault === true,
    ...(value.isAdvisorDefault === true ? { isAdvisorDefault: true } : {}),
    ...(optionalString(value.description, "description", path) ? { description: optionalString(value.description, "description", path) } : {}),
    ...(optionalString(value.model, "model", path) ? { model: optionalString(value.model, "model", path) } : {}),
    ...(optionalString(value.relay_model, "relay_model", path) ? { relay_model: optionalString(value.relay_model, "relay_model", path) } : {}),
    ...(optionalString(value.pipe_flag, "pipe_flag", path) ? { pipe_flag: optionalString(value.pipe_flag, "pipe_flag", path) } : {}),
    ...(optionalString(value.permission_flag, "permission_flag", path) ? { permission_flag: optionalString(value.permission_flag, "permission_flag", path) } : {}),
    ...(optionalString(value.disallowed_tools, "disallowed_tools", path) ? { disallowed_tools: optionalString(value.disallowed_tools, "disallowed_tools", path) } : {}),
    ...(optionalString(value.pre_exec, "pre_exec", path) ? { pre_exec: optionalString(value.pre_exec, "pre_exec", path) } : {}),
    ...(optionalString(value.log_path, "log_path", path) ? { log_path: optionalString(value.log_path, "log_path", path) } : {}),
    ...(optionalString(value.log_format, "log_format", path) ? { log_format: optionalString(value.log_format, "log_format", path) } : {}),
    ...(value.extra_args === undefined ? {} : { extra_args: stringArray(value.extra_args, "extra_args", path) }),
    ...(value.env === undefined ? {} : { env: profileEnv(value.env, path) }),
    ...(value.readiness === undefined ? {} : { readiness: readiness(value.readiness, path) }),
    createdAt: typeof value.createdAt === "string" ? value.createdAt : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
  };
  return profile;
}

function resolveWorkspaceProfileId(projectRoot: string | undefined, orgRoot: string | undefined): string | undefined {
  if (!projectRoot || !orgRoot) return undefined;
  const workspacePath = join(orgRoot, "workspaces.json");
  if (!existsSync(workspacePath)) return undefined;
  const workspaces = readJson(workspacePath, "workspace profile configuration");
  if (!Array.isArray(workspaces)) throw new Error(`Workspace profile configuration must be an array: ${workspacePath}`);
  const match = (workspaces as WorkspaceShape[]).find((workspace) => workspace.path === projectRoot);
  return optionalProfileId(match?.default_agent_profile, "workspace.default_agent_profile");
}

function listProfileFiles(profilesDir: string): string[] {
  if (!isAbsolute(profilesDir)) throw new Error(`Agent profiles directory must be absolute: ${profilesDir}`);
  if (!existsSync(profilesDir)) return [];
  return readdirSync(profilesDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => join(profilesDir, name));
}

function writeProfileEnvFile(profile: AgentProfile, namespaceId: string, orgId: string): string | undefined {
  const values = Object.entries(profile.env ?? {}).flatMap(([key, value]) => {
    const secret = value.match(SECRET_REFERENCE);
    if (!secret) return [[key, value] as const];
    const resolved = getSecretByName(namespaceId, orgId, secret[1]);
    return resolved === null ? [] : [[key, resolved] as const];
  });
  if (values.length === 0) return undefined;
  const dir = mkdtempSync(join(tmpdir(), "mentiko-agent-profile-"));
  chmodSync(dir, 0o700);
  const envPath = join(dir, "env.sh");
  writeFileSync(envPath, `${values.map(([key, value]) => `export ${key}=${shellQuote(value)}`).join("\n")}\n`, { mode: 0o600 });
  return envPath;
}

function readiness(value: unknown, path: string): AgentProfileReadinessConfig {
  if (!isRecord(value) || typeof value.enabled !== "boolean") throw new Error(`Invalid readiness configuration at ${path}`);
  return value as unknown as AgentProfileReadinessConfig;
}

function profileEnv(value: unknown, path: string): Record<string, string> {
  if (!isRecord(value)) throw new Error(`Profile env must be an object at ${path}`);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    if (!ENV_KEY.test(key) || typeof entry !== "string") throw new Error(`Invalid profile env entry '${key}' at ${path}`);
    return [key, entry];
  }));
}

function stringArray(value: unknown, field: string, path: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) throw new Error(`Profile ${field} must be a string array at ${path}`);
  return value;
}

function optionalProfileId(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a profile id`);
  assertProfileId(value, field);
  return value;
}

function assertProfileId(value: string, label: string): void {
  if (!PROFILE_ID.test(value)) throw new Error(`Invalid ${label}: ${value}`);
}

function requiredString(value: unknown, field: string, path: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Profile ${field} is required at ${path}`);
  return value;
}

function optionalString(value: unknown, field: string, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`Profile ${field} must be a string at ${path}`);
  return value || undefined;
}

function readJson(path: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${label} at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
