import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

export type ChainRecord = Record<string, unknown> & { agents: Array<Record<string, unknown>> };

type ProfileKind = "execution" | "model";

const CHAIN_FIELDS = new Set([
  "name", "description", "cli", "cli_args", "monitor", "default_agent_profile",
  "monitor_interval", "max_rounds", "max_stale_count", "session_prefix", "on_complete",
  "webhook_url", "schedule", "project_root", "routing.default_timeout",
  "routing.error_handler", "routing.timeout_agent", "routing.timeout_handler",
  "metadata.coreGenerationChain", "workspace.type", "workspace.ssh.host", "workspace.ssh.user",
  "workspace.ssh.path", "workspace.ssh.key", "workspace.ssh.port", "workspace.docker.container",
  "workspace.docker.path", "workspace.docker.user", "workspace.docker.image", "workspace.docker.network",
]);

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read JSON ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function stringValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function nested(record: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return (value as Record<string, unknown>)[key];
  }, record);
}

function safeRefPath(agentsDir: string, reference: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(reference)) throw new Error(`Agent reference is not a safe id: ${reference}`);
  const candidates = [join(agentsDir, reference, "agent.json"), join(agentsDir, `${reference}.json`)];
  for (const candidate of candidates) {
    const resolvedRoot = resolve(agentsDir) + sep;
    if (!resolve(candidate).startsWith(resolvedRoot)) throw new Error(`Agent reference escapes agents directory: ${reference}`);
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      // Try the alternate supported catalog layout.
    }
  }
  throw new Error(`Agent reference not found: ${reference}`);
}

export function decodeRawChainDefinition(chainPath: string): Record<string, unknown> {
  return asRecord(readJson(chainPath), "chain");
}

export function normalizeChainDefinition(raw: Record<string, unknown>, agentsDir: string): ChainRecord {
  if (!Array.isArray(raw.agents)) throw new Error("chain.agents must be an array");
  const agents = (raw.agents as unknown[]).map((value, index) => {
    const agent = asRecord(value, `agents[${index}]`);
    if (typeof agent.$ref !== "string" || !agent.$ref.trim()) return { ...agent };
    const base = asRecord(readJson(safeRefPath(agentsDir, agent.$ref)), `agent reference ${agent.$ref}`);
    const { $ref: _ref, ...overrides } = agent;
    return { ...base, ...overrides };
  });
  return { ...raw, agents } as ChainRecord;
}

/**
 * A fan-in member cannot also be its own join target. That would launch the
 * same agent once as a fan-out member and again when the one-member group
 * completes. Route normalization remains defensive for old persisted records,
 * but all newly decoded normalized definitions reject this invalid graph.
 */
export function validateNormalizedChainDefinition(chain: ChainRecord): void {
  const branches = chain.branches;
  if (branches === undefined) return;
  const record = asRecord(branches, "chain.branches");
  for (const [event, target] of Object.entries(record)) {
    if (!target || typeof target !== "object" || Array.isArray(target)) continue;
    const branch = target as Record<string, unknown>;
    if (
      typeof branch.fan_in === "string"
      && Array.isArray(branch.fan_out)
      && branch.fan_out.some((candidate) => candidate === branch.fan_in)
    ) {
      throw new Error(`branches.${event}: fan_in must not also appear in fan_out`);
    }
  }
}

export function loadNormalizedChainDefinition(chainPath: string, agentsDir: string): ChainRecord {
  const normalized = normalizeChainDefinition(decodeRawChainDefinition(chainPath), agentsDir);
  validateNormalizedChainDefinition(normalized);
  return normalized;
}

export function rawChainConfigField(chainPath: string, key: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) throw new Error(`Unsupported raw chain field: ${key}`);
  const raw = decodeRawChainDefinition(chainPath);
  const config = raw.config && typeof raw.config === "object" && !Array.isArray(raw.config) ? raw.config as Record<string, unknown> : {};
  return stringValue(config[key] ?? raw[key]);
}

export function materializeNormalizedChainDefinition(chainPath: string, agentsDir: string): string {
  const chain = loadNormalizedChainDefinition(chainPath, agentsDir);
  const directory = mkdtempSync(join(tmpdir(), "mentiko-normalized-chain-"));
  const output = join(directory, "chain.json");
  writeFileSync(output, `${JSON.stringify(chain, null, 2)}\n`, { mode: 0o600 });
  return output;
}

function profileData(configProfilesDir: string, kind: ProfileKind, id: unknown): Record<string, unknown> | undefined {
  if (typeof id !== "string" || !id.trim()) return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id)) throw new Error(`Config profile is not a safe id: ${id}`);
  const profilePath = join(configProfilesDir, kind, `${id}.json`);
  try {
    const profile = asRecord(readJson(profilePath), `config profile ${id}`);
    return asRecord(profile.data, `config profile ${id}.data`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Unable to read JSON")) return undefined;
    throw error;
  }
}

function cliFrom(config: Record<string, unknown>, fallback: string): string {
  const executor = stringValue(config.executor);
  return executor || stringValue(config.cli) || fallback;
}

export function resolveChainRuntimeConfig(chain: ChainRecord, configProfilesDir: string, cliOverride?: string): Record<string, string> {
  const config = asRecord(chain.config ?? {}, "chain.config");
  const routing = asRecord(chain.routing ?? {}, "chain.routing");
  const profiles = asRecord(chain.profiles ?? {}, "chain.profiles");
  let cli = cliOverride || cliFrom(config, "claude");
  let cliArgs = Array.isArray(config.cli_args) ? config.cli_args.filter((item): item is string => typeof item === "string").join(" ") : "";
  let monitor = stringValue(config.monitor, "true");
  let maxRounds = stringValue(config.max_rounds, "3");
  let maxStaleCount = stringValue(config.max_stale_count);
  let onComplete = stringValue(config.on_complete, "stop");

  const execution = profileData(configProfilesDir, "execution", profiles.execution);
  if (execution) {
    cli = cliFrom(execution, cli);
    const profileArgs = Array.isArray(execution.cli_args) ? execution.cli_args.filter((item): item is string => typeof item === "string").join(" ") : "";
    if (profileArgs) cliArgs = profileArgs;
    monitor = stringValue(execution.monitor, monitor);
    maxRounds = stringValue(execution.max_rounds, maxRounds);
    maxStaleCount = stringValue(execution.max_stale_count, maxStaleCount);
    onComplete = stringValue(execution.on_complete, onComplete);
  }
  const model = profileData(configProfilesDir, "model", profiles.model);
  if (model) {
    cli = cliFrom(model, cli);
    const profileArgs = Array.isArray(model.cli_args) ? model.cli_args.filter((item): item is string => typeof item === "string").join(" ") : "";
    if (profileArgs) cliArgs = profileArgs;
  }

  return {
    name: stringValue(chain.name), description: stringValue(chain.description), cli, cli_args: cliArgs, monitor,
    default_agent_profile: stringValue(chain.default_agent_profile), monitor_interval: stringValue(config.monitor_interval, "5"),
    max_rounds: maxRounds, max_stale_count: maxStaleCount, session_prefix: stringValue(config.session_prefix),
    on_complete: onComplete, webhook_url: stringValue(config.webhook_url), schedule: stringValue(config.schedule),
    project_root: stringValue(config.project_root, "auto"),
    "routing.default_timeout": stringValue(routing.default_timeout, "0"),
    "routing.error_handler": stringValue(routing.error_handler), "routing.timeout_agent": stringValue(routing.timeout_agent),
    "routing.timeout_handler": stringValue(routing.timeout_handler),
    "metadata.coreGenerationChain": stringValue(nested(chain, "metadata.coreGenerationChain"), "false"),
    "workspace.type": stringValue(nested(config, "workspace.type"), "local"),
    "workspace.ssh.host": stringValue(nested(config, "workspace.ssh.host")),
    "workspace.ssh.user": stringValue(nested(config, "workspace.ssh.user")),
    "workspace.ssh.path": stringValue(nested(config, "workspace.ssh.path")),
    "workspace.ssh.key": stringValue(nested(config, "workspace.ssh.key")),
    "workspace.ssh.port": stringValue(nested(config, "workspace.ssh.port"), "22"),
    "workspace.docker.container": stringValue(nested(config, "workspace.docker.container")),
    "workspace.docker.path": stringValue(nested(config, "workspace.docker.path")),
    "workspace.docker.user": stringValue(nested(config, "workspace.docker.user")),
    "workspace.docker.image": stringValue(nested(config, "workspace.docker.image")),
    "workspace.docker.network": stringValue(nested(config, "workspace.docker.network")),
  };
}

export function chainRuntimeField(chain: ChainRecord, configProfilesDir: string, field: string, cliOverride?: string): string {
  if (!CHAIN_FIELDS.has(field)) throw new Error(`Unsupported chain field: ${field}`);
  return resolveChainRuntimeConfig(chain, configProfilesDir, cliOverride)[field] ?? "";
}

export function findAgent(chain: ChainRecord, agentId: string): Record<string, unknown> {
  const agent = chain.agents.find((candidate) => candidate.id === agentId);
  if (!agent) throw new Error(`Agent not found: ${agentId}`);
  return agent;
}

export function agentField(chain: ChainRecord, agentId: string, field: string, fallback = ""): string {
  const agent = findAgent(chain, agentId);
  const value = nested(agent, field);
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").join(" ");
  return stringValue(value, fallback);
}

export function agentArray(chain: ChainRecord, agentId: string, field: string): string[] {
  const value = nested(findAgent(chain, agentId), field);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function agentAuthorities(chain: ChainRecord, agentId: string): string[] {
  const authorities = nested(findAgent(chain, agentId), "authorities");
  if (Array.isArray(authorities)) return authorities.filter((item): item is string => typeof item === "string");
  if (authorities && typeof authorities === "object" && Array.isArray((authorities as Record<string, unknown>).can)) {
    return ((authorities as Record<string, unknown>).can as unknown[]).filter((item): item is string => typeof item === "string");
  }
  return [];
}

export function agentArtifacts(chain: ChainRecord, agentId: string, direction: "produces" | "consumes"): string[] {
  const artifacts = agentArrayValue(findAgent(chain, agentId), `artifacts.${direction}`);
  // Artifact records intentionally retain their structured shape here rather than
  // leaking JSON into shell. The typed contract emits the exact display line.
  const raw = nested(findAgent(chain, agentId), `artifacts.${direction}`);
  if (!Array.isArray(raw)) return artifacts;
  return raw.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (direction === "consumes") {
      const from = stringValue(record.from); const artifact = stringValue(record.artifact);
      return from && artifact ? [`${from}.${artifact} (from ${from})`] : [];
    }
    const id = stringValue(record.id); if (!id) return [];
    const ext = ({ json: ".json", patch: ".patch", csv: ".csv", code: ".txt", text: ".txt" } as Record<string, string>)[stringValue(record.type)] || ".md";
    const description = stringValue(record.description);
    return [`${agentId}.${id}${ext}${description ? ` - ${description}` : ""}`];
  });
}

export function agentProfileField(chain: ChainRecord, configProfilesDir: string, agentId: string, field: string): string {
  if (!["cli", "cli_args", "monitor", "max_rounds", "max_stale_count", "on_complete"].includes(field)) {
    throw new Error(`Unsupported agent profile field: ${field}`);
  }
  const profiles = asRecord(findAgent(chain, agentId).profiles ?? {}, `agent ${agentId}.profiles`);
  const execution = profileData(configProfilesDir, "execution", profiles.execution);
  const model = profileData(configProfilesDir, "model", profiles.model);
  const data = execution ?? model;
  if (!data) return "";
  const value = data[field];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").join(" ") : stringValue(value);
}

export function gatewayField(chain: ChainRecord, gateway: string, field: string): string {
  const gateways = asRecord(chain.gateways ?? {}, "chain.gateways");
  const record = asRecord(gateways[gateway] ?? {}, `gateway ${gateway}`);
  const value = record[field];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").join(" ") : stringValue(value);
}

export function gatewayEnv(chain: ChainRecord, gateway: string): string[] {
  const gateways = asRecord(chain.gateways ?? {}, "chain.gateways");
  const record = asRecord(gateways[gateway] ?? {}, `gateway ${gateway}`);
  const env = asRecord(record.env ?? {}, `gateway ${gateway}.env`);
  return Object.entries(env).flatMap(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === "string" ? [`${key}=${value}`] : []);
}

export function firstAgentForEvent(chain: ChainRecord, event: string): string {
  const normalized = event.toLowerCase();
  return chain.agents.find((agent) => agentArrayValue(agent, "triggers").some((trigger) => trigger.toLowerCase() === normalized))?.id as string || "";
}

function agentArrayValue(agent: Record<string, unknown>, field: string): string[] {
  const value = nested(agent, field);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
