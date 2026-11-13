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
var import_node_crypto = require("node:crypto");
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
var TRANSACTION_ROOT_NAME = ".event-transactions";
var TRANSACTION_MANIFEST_NAME = "manifest.json";
var TRANSACTION_CLAIMED_NAME = "claimed.event";
var ARCHIVE_RECEIPT_V2_KEYS = [
  "version",
  "role",
  "occurrence",
  "sourceFilename",
  "runId",
  "destinationFilename",
  "occurrenceToken",
  "acceptedContentSha256",
  "acceptedRecordSha256",
  "archivedContentSha256"
];
var ARCHIVE_RECEIPT_V3_KEYS = [...ARCHIVE_RECEIPT_V2_KEYS, "occurrenceId"];
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
  return {
    match: match || readPendingRunnerEventTransactions(input.eventsDir, input.runId).find(({ event }) => completionEventMatches(event, input, allAgentIds)),
    invalid: scan.invalid
  };
}
function readPendingRunnerEventTransactions(eventsDir, runId) {
  const root = requireConfiguredEventsDir(eventsDir);
  requireNonEmpty("runId", runId);
  const transactionRoot = (0, import_node_path2.join)(root, TRANSACTION_ROOT_NAME);
  if (!(0, import_node_fs2.existsSync)(transactionRoot)) return [];
  if (!isRegularDirectory(transactionRoot)) {
    throw new Error(`Event transaction root is not a direct regular directory: ${transactionRoot}`);
  }
  const pending = [];
  const entries = (0, import_node_fs2.readdirSync)(transactionRoot, { withFileTypes: true }).sort((left, right) => compareFileNames(left.name, right.name));
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) {
      throw new Error(`Event transaction entry has an invalid name or type: ${(0, import_node_path2.join)(transactionRoot, entry.name)}`);
    }
    const transactionDir = (0, import_node_path2.join)(transactionRoot, entry.name);
    const manifestPath = (0, import_node_path2.join)(transactionDir, TRANSACTION_MANIFEST_NAME);
    if (!(0, import_node_fs2.existsSync)(manifestPath)) continue;
    const manifest = readArchiveTransactionManifest(transactionDir);
    if (manifest.role !== "trigger" || manifest.runId !== runId || manifest.state === "conflict") continue;
    const sourcePath = (0, import_node_path2.join)(root, manifest.sourceFilename);
    if (pathEntryExists(sourcePath)) continue;
    const replay = pendingArchiveTrigger(root, transactionDir, manifest);
    if (replay) pending.push(replay);
  }
  return pending.sort((left, right) => compareFileNames(left.filename, right.filename) || compareFileNames(left.event.fields.occurrence_id || "", right.event.fields.occurrence_id || ""));
}
function pendingArchiveTrigger(root, transactionDir, manifest) {
  if (manifest.role !== "trigger" || manifest.state === "conflict") return void 0;
  const sourcePath = (0, import_node_path2.join)(root, manifest.sourceFilename);
  if (pathEntryExists(sourcePath)) return void 0;
  const claimedPath = (0, import_node_path2.join)(transactionDir, TRANSACTION_CLAIMED_NAME);
  let acceptedContent;
  if (pathEntryExists(claimedPath)) {
    const claimed = snapshotEventFile(claimedPath);
    const claimedState = verifyClaimedTransactionSnapshot(claimed, manifest);
    if (!claimedState) return void 0;
    acceptedContent = claimedState === "raw" ? claimed.content : claimed.content.replace(/^(processed:[\t ]*)true([\t ]*)$/m, "$1false$2");
  } else if (manifest.state === "complete" && manifest.destinationFilename) {
    verifyTransactionReceipt(root, manifest);
    const archivePath = (0, import_node_path2.join)(requireArchiveDir(root), manifest.destinationFilename);
    if (!isRegularFile(archivePath)) return void 0;
    const archivedContent = (0, import_node_fs2.readFileSync)(archivePath, "utf8");
    if (sha256(archivedContent) !== manifest.archivedContentSha256) return void 0;
    acceptedContent = archivedContent.replace(/^(processed:[\t ]*)true([\t ]*)$/m, "$1false$2");
  } else {
    return void 0;
  }
  if (sha256(acceptedContent) !== manifest.acceptedTrigger.rawContentSha256) return void 0;
  const event = strictEventAtPath(sourcePath, acceptedContent);
  if (event.processed || normalizedEventDigest(event) !== manifest.acceptedTrigger.normalizedRecordSha256 || archiveOccurrenceId(event, manifest.acceptedTrigger) !== manifest.occurrenceId || stableSerialize(eventSourceClaimIdentity(event)) !== stableSerialize(manifest.sourceIdentity) || !archiveTransactionEventMatches(event, "trigger", manifestOwner(manifest))) return void 0;
  return { filename: manifest.sourceFilename, path: sourcePath, content: acceptedContent, event };
}
function eventIsStrictlyOwned(event, owner) {
  if (!owner.runId || event.runId !== owner.runId) return false;
  const allAgentIds = normalizeAgentIds(owner.allAgentIds);
  const candidates = DIAGNOSTIC_SOURCES.has(normalizeIdentity2(event.source)) ? [event.source, event.fields.agent] : [event.source];
  return candidates.filter((candidate) => Boolean(candidate)).some((candidate) => runnerEventIdentityMatches(
    candidate,
    owner.source,
    owner.sessionName,
    allAgentIds
  ));
}
function verifyClaimedTransactionSnapshot(snapshot, manifest, requireOriginalIdentity = false) {
  const contentHash = sha256(snapshot.content);
  const occurrenceId = archiveOccurrenceId(snapshot.event, manifest.acceptedTrigger);
  if (occurrenceId !== manifest.occurrenceId || stableSerialize(eventSourceClaimIdentity(snapshot.event)) !== stableSerialize(manifest.sourceIdentity)) return void 0;
  if (contentHash === manifest.acceptedTrigger.rawContentSha256) {
    if (normalizedEventDigest(snapshot.event) !== manifest.acceptedTrigger.normalizedRecordSha256) return void 0;
    if (requireOriginalIdentity && !identityMatches(snapshot.identity, manifest.fileIdentity)) return void 0;
    if (!identityMatchesAfterRename(snapshot.identity, manifest.fileIdentity)) return void 0;
    return "raw";
  }
  if (contentHash !== manifest.processedContentSha256 || !snapshot.event.processed) return void 0;
  const acceptedRecord = normalizedEventDigest({
    ...snapshot.event,
    processed: false,
    fields: { ...snapshot.event.fields, processed: "false" }
  });
  if (acceptedRecord !== manifest.acceptedTrigger.normalizedRecordSha256) return void 0;
  return "processed";
}
function archiveOccurrenceId(event, accepted) {
  return event.fields.occurrence_id || accepted.occurrenceToken;
}
function archiveTransactionEventMatches(event, role, owner) {
  if (event.runId !== owner.runId) return false;
  if (role === "trigger") {
    return (owner.expectedEvent === void 0 || event.event === owner.expectedEvent) && runnerEventIdentityMatches(event.source, owner.source, owner.sessionName, owner.allAgentIds);
  }
  return eventIsStrictlyOwned(event, {
    runId: owner.runId,
    source: owner.source,
    sessionName: owner.sessionName,
    allAgentIds: owner.allAgentIds
  });
}
function manifestOwner(manifest) {
  return {
    runId: manifest.runId,
    source: manifest.ownerSource,
    expectedEvent: manifest.expectedEvent,
    sessionName: manifest.sessionName,
    allAgentIds: manifest.allAgentIds
  };
}
function eventSourceClaimIdentity(event) {
  return {
    scope: "run",
    runId: event.runId,
    source: DIAGNOSTIC_SOURCES.has(normalizeIdentity2(event.source)) && event.fields.agent ? event.fields.agent : event.source
  };
}
function identityMatches(left, right) {
  return stableSerialize(left) === stableSerialize(right);
}
function identityMatchesAfterRename(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeNs === right.mtimeNs && left.birthtimeNs === right.birthtimeNs;
}
function verifyTransactionReceipt(root, manifest) {
  if (!manifest.destinationFilename || !manifest.archivedContentSha256) {
    throw new Error(`Archive transaction is missing its archived identity: ${manifest.transactionId}`);
  }
  const archiveDir = requireArchiveDir(root);
  const receiptPath = archiveReceiptPath(
    archiveDir,
    manifest.sourceFilename,
    manifest.runId,
    manifest.acceptedTrigger.occurrenceToken,
    manifest.acceptedTrigger.rawContentSha256
  );
  const proof = readArchiveReceiptProof(archiveDir, receiptPath);
  const claimedPath = (0, import_node_path2.join)(transactionPath(root, manifest), TRANSACTION_CLAIMED_NAME);
  const claimedStillPresent = (0, import_node_fs2.existsSync)(claimedPath);
  if (proof.receipt.role !== manifest.role || proof.receipt.destinationFilename !== manifest.destinationFilename || proof.receipt.occurrenceToken !== manifest.acceptedTrigger.occurrenceToken || proof.receipt.acceptedContentSha256 !== manifest.acceptedTrigger.rawContentSha256 || proof.receipt.acceptedRecordSha256 !== manifest.acceptedTrigger.normalizedRecordSha256 || proof.receipt.archivedContentSha256 !== manifest.archivedContentSha256 || proof.receipt.version === 3 && proof.receipt.occurrenceId !== manifest.occurrenceId || claimedStillPresent && (!isRegularFile(claimedPath) || proof.content !== (0, import_node_fs2.readFileSync)(claimedPath, "utf8")) || !claimedStillPresent && manifest.state !== "complete") {
    throw new Error(`Archive transaction receipt does not prove the claimed occurrence: ${receiptPath}`);
  }
}
function transactionPath(root, manifest) {
  return (0, import_node_path2.join)(root, TRANSACTION_ROOT_NAME, manifest.transactionId);
}
function readArchiveTransactionManifest(transactionDir) {
  const manifestPath = (0, import_node_path2.join)(transactionDir, TRANSACTION_MANIFEST_NAME);
  let fd;
  try {
    fd = (0, import_node_fs2.openSync)(manifestPath, import_node_fs2.constants.O_RDONLY | import_node_fs2.constants.O_NOFOLLOW);
    if (!(0, import_node_fs2.fstatSync)(fd).isFile()) throw new Error("manifest is not a regular file");
    const content = (0, import_node_fs2.readFileSync)(fd, "utf8");
    const value = JSON.parse(content);
    if (!isValidArchiveTransactionManifest(value)) {
      throw new Error("manifest has an invalid shape");
    }
    if (content !== `${JSON.stringify(value)}
`) throw new Error("manifest is not canonical");
    return value;
  } catch (error) {
    throw new Error(`Unable to read archive transaction manifest ${manifestPath}: ${String(error)}`);
  } finally {
    if (fd !== void 0) (0, import_node_fs2.closeSync)(fd);
  }
}
function isValidArchiveTransactionManifest(value) {
  if (!value || typeof value !== "object") return false;
  const knownKeys = [
    "version",
    "state",
    "transactionId",
    "role",
    "sourceFilename",
    "runId",
    "sourceIdentity",
    "ownerSource",
    "expectedEvent",
    "sessionName",
    "allAgentIds",
    "occurrenceId",
    "acceptedTrigger",
    "fileIdentity",
    "fileMode",
    "processedContentSha256",
    "destinationFilename",
    "archivedContentSha256",
    "archiveStatus",
    "conflictReason"
  ];
  const record = value;
  if (Object.keys(record).some((key) => !knownKeys.includes(key))) return false;
  return value.version === 1 && ["prepared", "claimed", "archived", "receipted", "complete", "conflict"].includes(String(value.state)) && /^[a-f0-9]{64}$/.test(value.transactionId || "") && (value.role === "trigger" || value.role === "owned-sibling") && isDirectEventFilename(value.sourceFilename || "") && Boolean(value.runId?.trim()) && value.sourceIdentity?.scope === "run" && value.sourceIdentity.runId === value.runId && Boolean(value.sourceIdentity.source?.trim()) && Boolean(value.ownerSource?.trim()) && Array.isArray(value.allAgentIds) && value.allAgentIds.every((id) => typeof id === "string") && Boolean(value.occurrenceId?.trim()) && value.acceptedTrigger !== void 0 && value.acceptedTrigger?.sourceFilename === value.sourceFilename && value.acceptedTrigger.occurrenceToken === value.transactionId && value.fileIdentity !== void 0 && ["dev", "ino", "size", "mtimeNs", "ctimeNs", "birthtimeNs"].every((key) => typeof value.fileIdentity[key] === "string") && Number.isInteger(value.fileMode) && /^[a-f0-9]{64}$/.test(value.processedContentSha256 || "") && (value.destinationFilename === void 0 || isDirectEventFilename(value.destinationFilename)) && (value.archivedContentSha256 === void 0 || /^[a-f0-9]{64}$/.test(value.archivedContentSha256)) && (value.archiveStatus === void 0 || ["archived", "collision-archived", "already-archived"].includes(value.archiveStatus)) && (value.conflictReason === void 0 || typeof value.conflictReason === "string");
}
function sha256(content) {
  return (0, import_node_crypto.createHash)("sha256").update(content).digest("hex");
}
function readArchiveReceiptProof(archiveDir, receiptPath) {
  const receipt = readArchiveReceipt(archiveDir, receiptPath);
  const destination = (0, import_node_path2.join)(archiveDir, receipt.destinationFilename);
  if (!isRegularFile(destination)) {
    throw new Error(`Archive receipt destination is missing: ${destination}`);
  }
  const content = (0, import_node_fs2.readFileSync)(destination, "utf8");
  const contentSha256 = (0, import_node_crypto.createHash)("sha256").update(content).digest("hex");
  if (contentSha256 !== receipt.archivedContentSha256) {
    throw new Error(`Archive receipt content hash does not match destination: ${destination}`);
  }
  const event = strictEventAtPath(destination, content);
  if (!event.processed) {
    throw new Error(`Archived proof is not processed: ${destination}`);
  }
  if (event.runId !== receipt.runId) {
    throw new Error(`Archived proof run id does not match receipt: ${destination}`);
  }
  if (receipt.version === 3 && receipt.occurrenceId !== archiveOccurrenceId(event, {
    version: 1,
    sourceFilename: receipt.sourceFilename,
    occurrenceToken: receipt.occurrenceToken,
    rawContentSha256: receipt.acceptedContentSha256,
    normalizedRecordSha256: receipt.acceptedRecordSha256
  })) {
    throw new Error(`Archive receipt occurrence ID does not match destination: ${destination}`);
  }
  return { receipt, destination, content, event };
}
function readArchiveReceipt(archiveDir, receiptPath) {
  if (!isRegularFile(receiptPath)) {
    throw new Error(`Archive receipt is not a direct regular file: ${receiptPath}`);
  }
  const receipt = parseArchiveReceipt(receiptPath, (0, import_node_fs2.readFileSync)(receiptPath, "utf8"));
  if (receiptPath !== archiveReceiptPath(
    archiveDir,
    receipt.sourceFilename,
    receipt.runId,
    receipt.occurrenceToken,
    receipt.acceptedContentSha256
  )) {
    throw new Error(`Archive receipt filename does not match its identity: ${receiptPath}`);
  }
  return receipt;
}
function archiveReceiptIdentityDigest(sourceFilename, runId) {
  return (0, import_node_crypto.createHash)("sha256").update(sourceFilename).update("\0").update(runId).digest("hex");
}
function archiveReceiptPath(archiveDir, sourceFilename, runId, occurrenceToken, acceptedContentSha256) {
  const identityDigest = archiveReceiptIdentityDigest(sourceFilename, runId);
  return (0, import_node_path2.join)(
    archiveDir,
    `.event-receipt-${identityDigest}-${occurrenceToken}-${acceptedContentSha256}.json`
  );
}
function parseArchiveReceipt(path, content) {
  let value;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error(`Archive receipt is not valid JSON: ${path}`);
  }
  const keys = typeof value === "object" && value !== null && !Array.isArray(value) ? Object.keys(value) : [];
  const version = typeof value === "object" && value !== null && !Array.isArray(value) ? value.version : void 0;
  const expectedKeys = version === 2 ? ARCHIVE_RECEIPT_V2_KEYS : version === 3 ? ARCHIVE_RECEIPT_V3_KEYS : [];
  if (typeof value !== "object" || value === null || Array.isArray(value) || keys.length !== expectedKeys.length || expectedKeys.some((key) => !keys.includes(key)) || version !== 2 && version !== 3 || value.role !== "trigger" && value.role !== "owned-sibling" || !Number.isSafeInteger(value.occurrence) || typeof value.sourceFilename !== "string" || typeof value.runId !== "string" || typeof value.destinationFilename !== "string" || typeof value.occurrenceToken !== "string" || typeof value.acceptedContentSha256 !== "string" || typeof value.acceptedRecordSha256 !== "string" || typeof value.archivedContentSha256 !== "string" || version === 3 && typeof value.occurrenceId !== "string") {
    throw new Error(`Archive receipt has an invalid shape: ${path}`);
  }
  const receipt = value;
  if (!isDirectEventFilename(receipt.sourceFilename) || receipt.occurrence < 1 || !receipt.runId.trim() || !isDirectEventFilename(receipt.destinationFilename) || !/^[a-f0-9]{64}$/.test(receipt.occurrenceToken) || !/^[a-f0-9]{64}$/.test(receipt.acceptedContentSha256) || !/^[a-f0-9]{64}$/.test(receipt.acceptedRecordSha256) || !/^[a-f0-9]{64}$/.test(receipt.archivedContentSha256) || receipt.version === 3 && !/^[A-Za-z0-9._-]{1,128}$/.test(receipt.occurrenceId || "")) {
    throw new Error(`Archive receipt has invalid field values: ${path}`);
  }
  if (content !== `${JSON.stringify(receipt)}
`) {
    throw new Error(`Archive receipt is not in canonical single-field form: ${path}`);
  }
  return receipt;
}
function isDirectEventFilename(value) {
  return Boolean(value) && (0, import_node_path2.basename)(value) === value && value.endsWith(".event");
}
function strictEventAtPath(path, content) {
  const raw = validateRawRunnerEvent(content);
  if (!raw.valid) {
    throw new Error(
      `Invalid runner event file ${path}: ${raw.issues.map((issue) => issue.code).join(", ")}`
    );
  }
  return { ...parseRunnerEvent(content), path };
}
function eventFileIdentity(path) {
  const stat = (0, import_node_fs2.lstatSync)(path, { bigint: true });
  if (!stat.isFile()) {
    throw new Error(`Event file is not a direct regular file: ${path}`);
  }
  return eventFileIdentityFromStat(stat);
}
function eventFileIdentityFromStat(stat) {
  return {
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
    birthtimeNs: stat.birthtimeNs.toString()
  };
}
function snapshotEventFile(path) {
  const flags = import_node_fs2.constants.O_RDONLY | import_node_fs2.constants.O_NOFOLLOW;
  let fd;
  try {
    fd = (0, import_node_fs2.openSync)(path, flags);
    const before = (0, import_node_fs2.fstatSync)(fd, { bigint: true });
    if (!before.isFile()) throw new Error(`Event file is not a direct regular file: ${path}`);
    const content = (0, import_node_fs2.readFileSync)(fd, "utf8");
    const after = (0, import_node_fs2.fstatSync)(fd, { bigint: true });
    const pathIdentity = eventFileIdentity(path);
    const beforeIdentity = eventFileIdentityFromStat(before);
    if (stableSerialize(beforeIdentity) !== stableSerialize(eventFileIdentityFromStat(after)) || stableSerialize(beforeIdentity) !== stableSerialize(pathIdentity)) {
      throw new Error(`Event file changed while capturing accepted trigger: ${path}`);
    }
    return {
      content,
      event: strictEventAtPath(path, content),
      identity: beforeIdentity,
      mode: Number(before.mode) & 511
    };
  } finally {
    if (fd !== void 0) (0, import_node_fs2.closeSync)(fd);
  }
}
function normalizedEventDigest(event) {
  return (0, import_node_crypto.createHash)("sha256").update(stableSerialize({
    event: event.event,
    source: event.source,
    runId: event.runId,
    timestamp: event.timestamp,
    processed: event.processed,
    data: event.data,
    fields: event.fields
  })).digest("hex");
}
function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
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
function requireArchiveDir(root) {
  const archiveDir = (0, import_node_path2.join)(root, "archive");
  if (!isRegularDirectory(archiveDir)) {
    throw new Error(`Event archive is not a direct regular directory: ${archiveDir}`);
  }
  return archiveDir;
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
function isRegularFile(path) {
  try {
    return (0, import_node_fs2.lstatSync)(path).isFile();
  } catch {
    return false;
  }
}
function pathEntryExists(path) {
  try {
    (0, import_node_fs2.lstatSync)(path);
    return true;
  } catch (error) {
    if (isMissingPath(error)) return false;
    throw error;
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
