#!/usr/bin/env node
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// web/lib/runner-v2/chain-contract-cli.ts
var chain_contract_cli_exports = {};
__export(chain_contract_cli_exports, {
  runRunnerChainContractCli: () => runRunnerChainContractCli
});
module.exports = __toCommonJS(chain_contract_cli_exports);

// web/lib/runner-v2/chain-contract.ts
var import_node_fs = require("node:fs");
var import_node_os = require("node:os");
var import_node_path = require("node:path");
var CHAIN_FIELDS = /* @__PURE__ */ new Set([
  "name",
  "description",
  "cli",
  "cli_args",
  "monitor",
  "default_agent_profile",
  "monitor_interval",
  "max_rounds",
  "max_stale_count",
  "session_prefix",
  "on_complete",
  "webhook_url",
  "schedule",
  "project_root",
  "routing.default_timeout",
  "routing.error_handler",
  "routing.timeout_agent",
  "routing.timeout_handler",
  "metadata.coreGenerationChain",
  "workspace.type",
  "workspace.ssh.host",
  "workspace.ssh.user",
  "workspace.ssh.path",
  "workspace.ssh.key",
  "workspace.ssh.port",
  "workspace.docker.container",
  "workspace.docker.path",
  "workspace.docker.user",
  "workspace.docker.image",
  "workspace.docker.network"
]);
function asRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}
function readJson(path) {
  try {
    return JSON.parse((0, import_node_fs.readFileSync)(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read JSON ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function stringValue(value, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}
function nested(record, path) {
  return path.split(".").reduce((value, key) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
    return value[key];
  }, record);
}
function safeRefPath(agentsDir, reference) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(reference)) throw new Error(`Agent reference is not a safe id: ${reference}`);
  const candidates = [(0, import_node_path.join)(agentsDir, reference, "agent.json"), (0, import_node_path.join)(agentsDir, `${reference}.json`)];
  for (const candidate of candidates) {
    const resolvedRoot = (0, import_node_path.resolve)(agentsDir) + import_node_path.sep;
    if (!(0, import_node_path.resolve)(candidate).startsWith(resolvedRoot)) throw new Error(`Agent reference escapes agents directory: ${reference}`);
    try {
      (0, import_node_fs.readFileSync)(candidate);
      return candidate;
    } catch {
    }
  }
  throw new Error(`Agent reference not found: ${reference}`);
}
function decodeRawChainDefinition(chainPath) {
  return asRecord(readJson(chainPath), "chain");
}
function normalizeChainDefinition(raw, agentsDir) {
  if (!Array.isArray(raw.agents)) throw new Error("chain.agents must be an array");
  const agents = raw.agents.map((value, index) => {
    const agent = asRecord(value, `agents[${index}]`);
    if (typeof agent.$ref !== "string" || !agent.$ref.trim()) return { ...agent };
    const base = asRecord(readJson(safeRefPath(agentsDir, agent.$ref)), `agent reference ${agent.$ref}`);
    const { $ref: _ref, ...overrides } = agent;
    return { ...base, ...overrides };
  });
  return { ...raw, agents };
}
function validateNormalizedChainDefinition(chain) {
  const branches = chain.branches;
  if (branches === void 0) return;
  const record = asRecord(branches, "chain.branches");
  for (const [event, target] of Object.entries(record)) {
    if (!target || typeof target !== "object" || Array.isArray(target)) continue;
    const branch = target;
    if (typeof branch.fan_in === "string" && Array.isArray(branch.fan_out) && branch.fan_out.some((candidate) => candidate === branch.fan_in)) {
      throw new Error(`branches.${event}: fan_in must not also appear in fan_out`);
    }
  }
}
function loadNormalizedChainDefinition(chainPath, agentsDir) {
  const normalized = normalizeChainDefinition(decodeRawChainDefinition(chainPath), agentsDir);
  validateNormalizedChainDefinition(normalized);
  return normalized;
}
function rawChainConfigField(chainPath, key) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) throw new Error(`Unsupported raw chain field: ${key}`);
  const raw = decodeRawChainDefinition(chainPath);
  const config = raw.config && typeof raw.config === "object" && !Array.isArray(raw.config) ? raw.config : {};
  return stringValue(config[key] ?? raw[key]);
}
function materializeNormalizedChainDefinition(chainPath, agentsDir) {
  const chain = loadNormalizedChainDefinition(chainPath, agentsDir);
  const directory = (0, import_node_fs.mkdtempSync)((0, import_node_path.join)((0, import_node_os.tmpdir)(), "mentiko-normalized-chain-"));
  const output = (0, import_node_path.join)(directory, "chain.json");
  (0, import_node_fs.writeFileSync)(output, `${JSON.stringify(chain, null, 2)}
`, { mode: 384 });
  return output;
}
function profileData(configProfilesDir, kind, id) {
  if (typeof id !== "string" || !id.trim()) return void 0;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id)) throw new Error(`Config profile is not a safe id: ${id}`);
  const profilePath = (0, import_node_path.join)(configProfilesDir, kind, `${id}.json`);
  try {
    const profile = asRecord(readJson(profilePath), `config profile ${id}`);
    return asRecord(profile.data, `config profile ${id}.data`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Unable to read JSON")) return void 0;
    throw error;
  }
}
function cliFrom(config, fallback) {
  const executor = stringValue(config.executor);
  return executor || stringValue(config.cli) || fallback;
}
function resolveChainRuntimeConfig(chain, configProfilesDir, cliOverride) {
  const config = asRecord(chain.config ?? {}, "chain.config");
  const routing = asRecord(chain.routing ?? {}, "chain.routing");
  const profiles = asRecord(chain.profiles ?? {}, "chain.profiles");
  let cli = cliOverride || cliFrom(config, "claude");
  let cliArgs = Array.isArray(config.cli_args) ? config.cli_args.filter((item) => typeof item === "string").join(" ") : "";
  let monitor = stringValue(config.monitor, "true");
  let maxRounds = stringValue(config.max_rounds, "3");
  let maxStaleCount = stringValue(config.max_stale_count);
  let onComplete = stringValue(config.on_complete, "stop");
  const execution = profileData(configProfilesDir, "execution", profiles.execution);
  if (execution) {
    cli = cliFrom(execution, cli);
    const profileArgs = Array.isArray(execution.cli_args) ? execution.cli_args.filter((item) => typeof item === "string").join(" ") : "";
    if (profileArgs) cliArgs = profileArgs;
    monitor = stringValue(execution.monitor, monitor);
    maxRounds = stringValue(execution.max_rounds, maxRounds);
    maxStaleCount = stringValue(execution.max_stale_count, maxStaleCount);
    onComplete = stringValue(execution.on_complete, onComplete);
  }
  const model = profileData(configProfilesDir, "model", profiles.model);
  if (model) {
    cli = cliFrom(model, cli);
    const profileArgs = Array.isArray(model.cli_args) ? model.cli_args.filter((item) => typeof item === "string").join(" ") : "";
    if (profileArgs) cliArgs = profileArgs;
  }
  return {
    name: stringValue(chain.name),
    description: stringValue(chain.description),
    cli,
    cli_args: cliArgs,
    monitor,
    default_agent_profile: stringValue(chain.default_agent_profile),
    monitor_interval: stringValue(config.monitor_interval, "5"),
    max_rounds: maxRounds,
    max_stale_count: maxStaleCount,
    session_prefix: stringValue(config.session_prefix),
    on_complete: onComplete,
    webhook_url: stringValue(config.webhook_url),
    schedule: stringValue(config.schedule),
    project_root: stringValue(config.project_root, "auto"),
    "routing.default_timeout": stringValue(routing.default_timeout, "0"),
    "routing.error_handler": stringValue(routing.error_handler),
    "routing.timeout_agent": stringValue(routing.timeout_agent),
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
    "workspace.docker.network": stringValue(nested(config, "workspace.docker.network"))
  };
}
function chainRuntimeField(chain, configProfilesDir, field, cliOverride) {
  if (!CHAIN_FIELDS.has(field)) throw new Error(`Unsupported chain field: ${field}`);
  return resolveChainRuntimeConfig(chain, configProfilesDir, cliOverride)[field] ?? "";
}
function findAgent(chain, agentId) {
  const agent = chain.agents.find((candidate) => candidate.id === agentId);
  if (!agent) throw new Error(`Agent not found: ${agentId}`);
  return agent;
}
function agentField(chain, agentId, field, fallback = "") {
  const agent = findAgent(chain, agentId);
  const value = nested(agent, field);
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string").join(" ");
  return stringValue(value, fallback);
}
function agentArray(chain, agentId, field) {
  const value = nested(findAgent(chain, agentId), field);
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
function agentAuthorities(chain, agentId) {
  const authorities = nested(findAgent(chain, agentId), "authorities");
  if (Array.isArray(authorities)) return authorities.filter((item) => typeof item === "string");
  if (authorities && typeof authorities === "object" && Array.isArray(authorities.can)) {
    return authorities.can.filter((item) => typeof item === "string");
  }
  return [];
}
function agentArtifacts(chain, agentId, direction) {
  const artifacts = agentArrayValue(findAgent(chain, agentId), `artifacts.${direction}`);
  const raw = nested(findAgent(chain, agentId), `artifacts.${direction}`);
  if (!Array.isArray(raw)) return artifacts;
  return raw.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item;
    if (direction === "consumes") {
      const from = stringValue(record.from);
      const artifact = stringValue(record.artifact);
      return from && artifact ? [`${from}.${artifact} (from ${from})`] : [];
    }
    const id = stringValue(record.id);
    if (!id) return [];
    const ext = { json: ".json", patch: ".patch", csv: ".csv", code: ".txt", text: ".txt" }[stringValue(record.type)] || ".md";
    const description = stringValue(record.description);
    return [`${agentId}.${id}${ext}${description ? ` - ${description}` : ""}`];
  });
}
function agentProfileField(chain, configProfilesDir, agentId, field) {
  if (!["cli", "cli_args", "monitor", "max_rounds", "max_stale_count", "on_complete"].includes(field)) {
    throw new Error(`Unsupported agent profile field: ${field}`);
  }
  const profiles = asRecord(findAgent(chain, agentId).profiles ?? {}, `agent ${agentId}.profiles`);
  const execution = profileData(configProfilesDir, "execution", profiles.execution);
  const model = profileData(configProfilesDir, "model", profiles.model);
  const data = execution ?? model;
  if (!data) return "";
  const value = data[field];
  return Array.isArray(value) ? value.filter((item) => typeof item === "string").join(" ") : stringValue(value);
}
function gatewayField(chain, gateway, field) {
  const gateways = asRecord(chain.gateways ?? {}, "chain.gateways");
  const record = asRecord(gateways[gateway] ?? {}, `gateway ${gateway}`);
  const value = record[field];
  return Array.isArray(value) ? value.filter((item) => typeof item === "string").join(" ") : stringValue(value);
}
function gatewayEnv(chain, gateway) {
  const gateways = asRecord(chain.gateways ?? {}, "chain.gateways");
  const record = asRecord(gateways[gateway] ?? {}, `gateway ${gateway}`);
  const env = asRecord(record.env ?? {}, `gateway ${gateway}.env`);
  return Object.entries(env).flatMap(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === "string" ? [`${key}=${value}`] : []);
}
function firstAgentForEvent(chain, event) {
  const normalized = event.toLowerCase();
  return chain.agents.find((agent) => agentArrayValue(agent, "triggers").some((trigger) => trigger.toLowerCase() === normalized))?.id || "";
}
function agentArrayValue(agent, field) {
  const value = nested(agent, field);
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

// web/lib/runner-v2/chain-contract-cli.ts
function runRunnerChainContractCli(argv, write = (line) => console.log(line)) {
  const [command, ...rest] = argv;
  if (!isCommand(command)) throw new Error(usage());
  const values = parseValues(rest);
  const chainPath = required(values, "--chain-path");
  const agentsDir = required(values, "--agents-dir");
  const configProfilesDir = optional(values, "--config-profiles-dir") || "";
  if (command === "resolve") {
    rejectUnexpected(values, /* @__PURE__ */ new Set(["--chain-path", "--agents-dir", "--config-profiles-dir"]));
    write(materializeNormalizedChainDefinition(chainPath, agentsDir));
    return;
  }
  if (command === "raw-field") {
    rejectUnexpected(values, /* @__PURE__ */ new Set(["--chain-path", "--agents-dir", "--config-profiles-dir", "--field"]));
    write(rawChainConfigField(chainPath, required(values, "--field")));
    return;
  }
  const field = optional(values, "--field");
  const chain = command === "chain-field" && field?.startsWith("workspace.") ? { ...decodeRawChainDefinition(chainPath), agents: [] } : loadNormalizedChainDefinition(chainPath, agentsDir);
  switch (command) {
    case "chain-field":
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--chain-path", "--agents-dir", "--config-profiles-dir", "--field", "--cli-override"]));
      write(chainRuntimeField(chain, configProfilesDir, required(values, "--field"), optional(values, "--cli-override")));
      return;
    case "agent-field":
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--chain-path", "--agents-dir", "--config-profiles-dir", "--agent-id", "--field", "--default"]));
      write(agentField(chain, required(values, "--agent-id"), required(values, "--field"), optional(values, "--default") || ""));
      return;
    case "agent-array":
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--chain-path", "--agents-dir", "--config-profiles-dir", "--agent-id", "--field"]));
      agentArray(chain, required(values, "--agent-id"), required(values, "--field")).forEach(write);
      return;
    case "agent-authorities":
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--chain-path", "--agents-dir", "--config-profiles-dir", "--agent-id"]));
      agentAuthorities(chain, required(values, "--agent-id")).forEach(write);
      return;
    case "agent-artifacts": {
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--chain-path", "--agents-dir", "--config-profiles-dir", "--agent-id", "--direction"]));
      const direction = required(values, "--direction");
      if (direction !== "produces" && direction !== "consumes") throw new Error("--direction must be produces or consumes");
      agentArtifacts(chain, required(values, "--agent-id"), direction).forEach(write);
      return;
    }
    case "agent-profile-field":
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--chain-path", "--agents-dir", "--config-profiles-dir", "--agent-id", "--field"]));
      write(agentProfileField(chain, configProfilesDir, required(values, "--agent-id"), required(values, "--field")));
      return;
    case "gateway-field":
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--chain-path", "--agents-dir", "--config-profiles-dir", "--gateway", "--field"]));
      write(gatewayField(chain, required(values, "--gateway"), required(values, "--field")));
      return;
    case "gateway-env":
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--chain-path", "--agents-dir", "--config-profiles-dir", "--gateway"]));
      gatewayEnv(chain, required(values, "--gateway")).forEach(write);
      return;
    case "agent-count":
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--chain-path", "--agents-dir", "--config-profiles-dir"]));
      write(String(chain.agents.length));
      return;
    case "agent-ids":
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--chain-path", "--agents-dir", "--config-profiles-dir"]));
      chain.agents.map((agent) => stringId(agent)).forEach(write);
      return;
    case "first-agent":
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--chain-path", "--agents-dir", "--config-profiles-dir", "--event"]));
      write(firstAgentForEvent(chain, optional(values, "--event") || "manual-start") || stringId(chain.agents[0]));
      return;
  }
}
function stringId(agent) {
  return typeof agent?.id === "string" ? agent.id : "";
}
function parseValues(argv) {
  const values = /* @__PURE__ */ new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === void 0 || values.has(key)) throw new Error(usage());
    values.set(key, value);
  }
  return values;
}
function required(values, key) {
  const value = values.get(key);
  if (!value) throw new Error(`${key} is required`);
  return value;
}
function optional(values, key) {
  return values.get(key);
}
function rejectUnexpected(values, allowed) {
  for (const key of values.keys()) if (!allowed.has(key)) throw new Error(`${key} is not valid for runner-chain-contract`);
}
function isCommand(value) {
  return ["resolve", "raw-field", "chain-field", "agent-field", "agent-array", "agent-authorities", "agent-artifacts", "agent-profile-field", "gateway-field", "gateway-env", "agent-count", "agent-ids", "first-agent"].includes(value || "");
}
function usage() {
  return "usage: runner-chain-contract <resolve|raw-field|chain-field|agent-field|agent-array|agent-authorities|agent-artifacts|agent-profile-field|gateway-field|gateway-env|agent-count|agent-ids|first-agent> --chain-path <path> --agents-dir <path> [options]";
}
if (require.main === module) {
  try {
    runRunnerChainContractCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runRunnerChainContractCli
});
