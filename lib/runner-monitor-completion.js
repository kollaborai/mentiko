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

// lib/runner-v2/monitor-completion-cli.ts
var monitor_completion_cli_exports = {};
__export(monitor_completion_cli_exports, {
  runMonitorCompletionCli: () => runMonitorCompletionCli
});
module.exports = __toCommonJS(monitor_completion_cli_exports);

// lib/runner-v2/monitor-completion-contract.ts
var import_node_fs3 = require("node:fs");

// lib/runner-v2/chain-contract.ts
var import_node_fs = require("node:fs");
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

// lib/runner-v2/event-lifecycle.ts
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");

// lib/runner-v2/event-identity.ts
function runnerEventIdentityMatches(candidateValue, ownerValue, sessionName, allAgentIds) {
  const candidate = normalizeIdentity(candidateValue);
  const owner = normalizeIdentity(ownerValue);
  const session = normalizeIdentity(sessionName);
  if (!candidate || !owner) return false;
  if (candidate === owner || session && candidate === session) return true;
  const identities = Array.from(new Set(
    (allAgentIds || []).map(normalizeIdentity).filter(Boolean)
  ));
  if (identities.length === 0) return false;
  const namesAnotherAgent = identities.some((agentId) => agentId !== owner && identityAppearsAsToken(candidate, agentId));
  if (namesAnotherAgent) return false;
  return identityAppearsAsToken(candidate, owner) || identityAppearsAsToken(owner, candidate);
}
function identityAppearsAsToken(candidate, identity) {
  return candidate === identity || candidate.startsWith(`${identity}-`) || candidate.endsWith(`-${identity}`) || candidate.includes(`-${identity}-`);
}
function normalizeIdentity(value) {
  return value?.trim().toLowerCase() || "";
}

// lib/runner-v2/events.ts
var RUNNER_EVENT_RAW_FIELDS = [
  "event",
  "source",
  "run_id",
  "timestamp",
  "processed",
  "data"
];
function parseRunnerEvent(content) {
  const raw = validateRawRunnerEvent(content);
  if (!raw.valid) {
    const summary = raw.issues.map((issue) => issue.code).join(", ");
    throw new Error(`Invalid runner event file: ${summary}`);
  }
  const record = {
    event: raw.fields.event,
    source: raw.fields.source,
    runId: raw.fields.run_id,
    timestamp: raw.fields.timestamp,
    processed: parseProcessed(raw.fields.processed),
    data: raw.fields.data,
    fields: raw.fields
  };
  const normalized = validateRunnerEventRecord(record);
  if (!normalized.valid) {
    const summary = normalized.issues.map((issue) => issue.code).join(", ");
    throw new Error(`Invalid normalized runner event: ${summary}`);
  }
  return record;
}
function validateRawRunnerEvent(content) {
  const fields = {};
  const issues = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const separator = line.indexOf(":");
    if (separator < 0) {
      issues.push({
        code: "malformed-line",
        line: index + 1,
        message: "Non-empty lines must use key: value syntax."
      });
      continue;
    }
    const rawKey = line.slice(0, separator).trim();
    const key = rawKey.toLowerCase();
    if (!key) {
      issues.push({ code: "empty-key", line: index + 1, message: "Field name is empty." });
      continue;
    }
    if (rawKey !== key) {
      issues.push({
        code: "noncanonical-key",
        field: key,
        line: index + 1,
        message: `Field ${key} must use lowercase canonical casing.`
      });
    }
    if (fields[key] !== void 0) {
      issues.push({
        code: "duplicate-field",
        field: key,
        line: index + 1,
        message: `Field ${key} appears more than once.`
      });
      continue;
    }
    fields[key] = line.slice(separator + 1).trim();
  }
  for (const field of RUNNER_EVENT_RAW_FIELDS) {
    if (fields[field] === void 0) {
      issues.push({ code: "missing-field", field, message: `Missing required field ${field}.` });
    }
  }
  for (const field of ["event", "source", "timestamp"]) {
    if (fields[field] !== void 0 && fields[field] === "") {
      issues.push({ code: "empty-field", field, message: `Field ${field} must not be empty.` });
    }
  }
  if (fields.timestamp && !Number.isFinite(new Date(fields.timestamp).getTime())) {
    issues.push({
      code: "invalid-timestamp",
      field: "timestamp",
      message: "Field timestamp must be a parseable date-time."
    });
  }
  if (fields.processed !== void 0 && !/^(?:true|false)$/.test(fields.processed)) {
    issues.push({
      code: "invalid-processed",
      field: "processed",
      message: "Field processed must be true or false."
    });
  }
  return { valid: issues.length === 0, fields, issues };
}
function validateRunnerEventRecord(value) {
  const issues = [];
  if (!isPlainRecord(value)) {
    return {
      valid: false,
      issues: [{ code: "invalid-record", message: "Runner event must be an object." }]
    };
  }
  for (const field of ["event", "source", "runId", "timestamp", "data"]) {
    if (typeof value[field] !== "string") {
      issues.push({
        code: "invalid-field-type",
        field,
        message: `Normalized field ${field} must be a string.`
      });
    }
  }
  for (const field of ["event", "source", "timestamp"]) {
    if (typeof value[field] === "string" && value[field] === "") {
      issues.push({ code: "empty-field", field, message: `Normalized field ${field} must not be empty.` });
    }
  }
  if (typeof value.timestamp === "string" && !Number.isFinite(new Date(value.timestamp).getTime())) {
    issues.push({
      code: "invalid-timestamp",
      field: "timestamp",
      message: "Normalized field timestamp must be a parseable date-time."
    });
  }
  if (typeof value.processed !== "boolean") {
    issues.push({
      code: "invalid-processed",
      field: "processed",
      message: "Normalized field processed must be a boolean."
    });
  }
  if (value.path !== void 0 && typeof value.path !== "string") {
    issues.push({
      code: "invalid-field-type",
      field: "path",
      message: "Normalized field path must be a string when present."
    });
  }
  if (!isStringRecord(value.fields)) {
    issues.push({
      code: "invalid-field-type",
      field: "fields",
      message: "Normalized field fields must map strings to strings."
    });
  } else {
    const expectedFields = [
      ["event", value.event],
      ["source", value.source],
      ["run_id", value.runId],
      ["timestamp", value.timestamp],
      ["processed", typeof value.processed === "boolean" ? String(value.processed) : void 0],
      ["data", value.data]
    ];
    for (const [field, expected] of expectedFields) {
      if (typeof expected === "string" && value.fields[field] !== expected) {
        issues.push({
          code: "field-mismatch",
          field: `fields.${field}`,
          message: `Normalized field fields.${field} must match ${field === "run_id" ? "runId" : field}.`
        });
      }
    }
  }
  return { valid: issues.length === 0, issues };
}
function parseProcessed(value) {
  return value === "true";
}
function isPlainRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isStringRecord(value) {
  return isPlainRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

// lib/runner-v2/event-lifecycle.ts
var DIAGNOSTIC_SOURCES = /* @__PURE__ */ new Set(["monitor", "watchdog", "chain-runner-complete"]);
function scanRunnerEventFiles(eventsDir, options = {}) {
  const root = requireConfiguredEventsDir(eventsDir);
  const entries = (0, import_node_fs2.readdirSync)(root, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".event")).sort((left, right) => compareFileNames(left.name, right.name));
  const valid = [];
  const invalid = [];
  for (const entry of entries) {
    const path = (0, import_node_path2.join)(root, entry.name);
    let content;
    try {
      content = options.readFile?.(path) ?? (0, import_node_fs2.readFileSync)(path, "utf8");
    } catch (error) {
      if (isMissingPath(error)) continue;
      throw error;
    }
    const raw = validateRawRunnerEvent(content);
    if (!raw.valid) {
      invalid.push({ filename: entry.name, path, issues: raw.issues });
      continue;
    }
    const event = { ...parseRunnerEvent(content), path };
    valid.push({ filename: entry.name, path, content, event });
  }
  return { valid, invalid };
}
function findRunnerCompletionEvent(input) {
  requireNonEmpty("runId", input.runId);
  if (input.expectedEvent !== void 0) requireNonEmpty("expectedEvent", input.expectedEvent);
  requireNonEmpty("agentId", input.agentId);
  const scan = scanRunnerEventFiles(input.eventsDir);
  const allAgentIds = normalizeAgentIds(input.allAgentIds);
  const match = scan.valid.find(({ event }) => !event.processed && completionEventMatches(event, input, allAgentIds));
  return { match, invalid: scan.invalid };
}
function requireConfiguredEventsDir(eventsDir) {
  requireNonEmpty("eventsDir", eventsDir);
  if (!(0, import_node_path2.isAbsolute)(eventsDir)) {
    throw new Error(`eventsDir must be an absolute configured path: ${eventsDir}`);
  }
  const root = (0, import_node_path2.resolve)(eventsDir);
  if (!isRegularDirectory(root)) {
    throw new Error(`Configured eventsDir is not a directory: ${root}`);
  }
  return root;
}
function completionEventMatches(event, input, allAgentIds) {
  if (event.runId !== input.runId) return false;
  if (input.expectedEvent !== void 0 && event.event !== input.expectedEvent) return false;
  if (DIAGNOSTIC_SOURCES.has(normalizeIdentity2(event.source))) return false;
  return runnerEventIdentityMatches(event.source, input.agentId, input.sessionName, allAgentIds);
}
function normalizeAgentIds(values) {
  return Array.from(new Set((values || []).map(normalizeIdentity2).filter(Boolean)));
}
function normalizeIdentity2(value) {
  return value?.trim().toLowerCase() || "";
}
function requireNonEmpty(label, value) {
  if (!value || !value.trim()) throw new Error(`${label} must not be empty.`);
}
function compareFileNames(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
function isRegularDirectory(path) {
  try {
    return (0, import_node_fs2.lstatSync)(path).isDirectory();
  } catch {
    return false;
  }
}
function isMissingPath(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

// lib/runner-v2/monitor-completion-contract.ts
function agentIds(chain) {
  return chain.agents.flatMap((agent) => typeof agent.id === "string" && agent.id ? [agent.id] : []);
}
function configuredAgent(chain, configuredAgentId) {
  if (!configuredAgentId) return void 0;
  const count = agentIds(chain).filter((id) => id === configuredAgentId).length;
  if (count !== 1) throw new Error(`Configured agent id '${configuredAgentId}' is not unique in chain definition`);
  return configuredAgentId;
}
function resolveMonitorCompletionAgent(input) {
  if (!(0, import_node_fs3.existsSync)(input.chainPath)) return "";
  const chain = loadNormalizedChainDefinition(input.chainPath, input.agentsDir);
  const explicit = configuredAgent(chain, input.configuredAgentId);
  if (explicit) return explicit;
  const chainPrefix = chainRuntimeField(chain, input.configProfilesDir, "session_prefix");
  const candidates = [input.sessionName];
  if (chainPrefix && input.sessionName.startsWith(`${chainPrefix}-`)) {
    candidates.push(input.sessionName.slice(chainPrefix.length + 1));
  }
  const exactMatches = agentIds(chain).filter((agentId) => {
    const sessionPrefix = agentField(chain, agentId, "session_prefix");
    return candidates.some((candidate) => candidate === agentId || sessionPrefix !== "" && candidate === sessionPrefix);
  });
  const uniqueExact = [...new Set(exactMatches)];
  if (uniqueExact.length === 1) return uniqueExact[0];
  if (uniqueExact.length > 1) {
    throw new Error(`Session '${input.sessionName}' has ambiguous exact agent matches: ${uniqueExact.join(", ")}`);
  }
  const tokenMatches = agentIds(chain).filter(
    (agentId) => [input.sessionName, ...candidates].some((candidate) => `-${candidate}-`.includes(`-${agentId}-`))
  );
  const uniqueToken = [...new Set(tokenMatches)];
  if (uniqueToken.length === 1) return uniqueToken[0];
  if (uniqueToken.length > 1) {
    throw new Error(`Session '${input.sessionName}' ambiguously matches agent ids: ${uniqueToken.join(", ")}`);
  }
  throw new Error(`Session '${input.sessionName}' does not uniquely identify a chain agent`);
}
function monitorCompletionExpectedEvent(input) {
  if (!(0, import_node_fs3.existsSync)(input.chainPath)) return "";
  const chain = loadNormalizedChainDefinition(input.chainPath, input.agentsDir);
  const agentId = input.agentId || resolveMonitorCompletionAgent(input);
  return agentField(chain, agentId, "emits");
}
function findMonitorCompletionEvent(input) {
  if (!(0, import_node_fs3.existsSync)(input.chainPath)) return "";
  const chain = loadNormalizedChainDefinition(input.chainPath, input.agentsDir);
  const agentId = input.agentId || resolveMonitorCompletionAgent(input);
  const expectedEvent = agentField(chain, agentId, "emits");
  if (!expectedEvent) return "";
  return findRunnerCompletionEvent({
    eventsDir: input.eventsDir,
    runId: input.runId,
    expectedEvent,
    agentId,
    sessionName: input.sessionName,
    allAgentIds: agentIds(chain)
  }).match?.path || "";
}

// lib/runner-v2/monitor-completion-cli.ts
function runMonitorCompletionCli(argv, write = (line) => console.log(line)) {
  const [command, ...rest] = argv;
  if (command !== "agent-id" && command !== "expected-event" && command !== "find") throw new Error(usage());
  const values = parseValues(rest);
  const common = {
    chainPath: required(values, "--chain-path"),
    agentsDir: required(values, "--agents-dir"),
    configProfilesDir: required(values, "--config-profiles-dir"),
    sessionName: required(values, "--session-name"),
    configuredAgentId: optional(values, "--configured-agent-id")
  };
  const agentId = optional(values, "--agent-id");
  if (command === "agent-id") {
    rejectUnexpected(values, /* @__PURE__ */ new Set(["--chain-path", "--agents-dir", "--config-profiles-dir", "--session-name", "--configured-agent-id"]));
    write(resolveMonitorCompletionAgent(common));
    return 0;
  }
  if (command === "expected-event") {
    rejectUnexpected(values, /* @__PURE__ */ new Set(["--chain-path", "--agents-dir", "--config-profiles-dir", "--session-name", "--configured-agent-id", "--agent-id"]));
    write(monitorCompletionExpectedEvent({ ...common, agentId }));
    return 0;
  }
  rejectUnexpected(values, /* @__PURE__ */ new Set(["--chain-path", "--agents-dir", "--config-profiles-dir", "--session-name", "--configured-agent-id", "--agent-id", "--events-dir", "--run-id"]));
  const result = findMonitorCompletionEvent({
    ...common,
    agentId,
    eventsDir: required(values, "--events-dir"),
    runId: required(values, "--run-id")
  });
  if (!result) return 3;
  write(result);
  return 0;
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
  for (const key of values.keys()) if (!allowed.has(key)) throw new Error(`${key} is not valid for runner-monitor-completion`);
}
function usage() {
  return "usage: runner-monitor-completion <agent-id|expected-event|find> --chain-path <path> --agents-dir <path> --config-profiles-dir <path> --session-name <name> [options]";
}
if (require.main === module) {
  try {
    process.exitCode = runMonitorCompletionCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runMonitorCompletionCli
});
