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

// lib/runner-v2/error-handling-cli.ts
var error_handling_cli_exports = {};
__export(error_handling_cli_exports, {
  runErrorHandlingCli: () => runErrorHandlingCli
});
module.exports = __toCommonJS(error_handling_cli_exports);

// lib/runner-v2/error-handling.ts
var import_node_fs3 = require("node:fs");
var import_node_child_process = require("node:child_process");
var import_node_path3 = require("node:path");

// lib/runner-v2/chain-contract.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
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

// lib/runner-v2/agent-state.ts
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");

// lib/runner-v2/file-claim.ts
var import_fs = require("fs");
var import_path = require("path");
var import_crypto = require("crypto");
var import_child_process = require("child_process");
var DEFAULT_FRESH_MS = 3e4;
var DEFAULT_WAIT_TIMEOUT_MS = 250;
var DEFAULT_RETRY_DELAY_MS = 10;
var ExclusiveFileClaimBusyError = class extends Error {
  constructor(claimDir) {
    super(`file claim already held: ${claimDir}`);
    this.claimDir = claimDir;
    this.name = "ExclusiveFileClaimBusyError";
  }
};
function withExclusiveFileClaim(claimDir, fn, options = {}) {
  const release = acquireExclusiveFileClaim(claimDir, options);
  try {
    const value = fn();
    if (isPromiseLike(value)) {
      return Promise.resolve(value).finally(release);
    }
    release();
    return value;
  } catch (error) {
    release();
    throw error;
  }
}
function acquireExclusiveFileClaim(claimDir, options) {
  const deadline = Date.now() + (options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS);
  while (true) {
    try {
      return tryAcquireExclusiveFileClaim(claimDir, options);
    } catch (error) {
      if (!(error instanceof ExclusiveFileClaimBusyError) || Date.now() >= deadline) throw error;
      waitSynchronously(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
    }
  }
}
function tryAcquireExclusiveFileClaim(claimDir, options) {
  const pid = options.pid ?? process.pid;
  const isAlive = options.isProcessAlive ?? processIsAlive;
  const identity = options.processIdentity ?? claimProcessIdentity;
  const freshMs = options.freshMs ?? DEFAULT_FRESH_MS;
  const reaperDir = `${claimDir}.reaper`;
  (0, import_fs.mkdirSync)((0, import_path.dirname)(claimDir), { recursive: true });
  cleanupOrphanedReleaseQuarantines(claimDir, isAlive, identity, freshMs);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if ((0, import_fs.existsSync)(reaperDir)) {
      const reaper2 = acquireReaperClaim(reaperDir, {
        pid,
        isAlive,
        identity,
        freshMs,
        removeDirectoryAttempt: options.removeDirectoryAttempt
      });
      reaper2.release();
      continue;
    }
    const owner = newOwner(pid, identity);
    try {
      const held = createOwnedDirectoryClaim(claimDir, owner, options.removeDirectoryAttempt);
      if ((0, import_fs.existsSync)(reaperDir)) {
        held.release();
        continue;
      }
      return held.release;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
    const observed = readOwner(claimDir);
    if (observed && ownerIsAlive(observed, isAlive, identity) || !observed && claimAgeMs(claimDir) < freshMs) {
      throw new ExclusiveFileClaimBusyError(claimDir);
    }
    const reaper = acquireReaperClaim(reaperDir, {
      pid,
      isAlive,
      identity,
      freshMs,
      removeDirectoryAttempt: options.removeDirectoryAttempt
    });
    try {
      const current = readOwner(claimDir);
      const ownerChanged = !sameOwner(observed, current);
      if (ownerChanged || current && ownerIsAlive(current, isAlive, identity) || !current && claimAgeMs(claimDir) < freshMs) {
        throw new ExclusiveFileClaimBusyError(claimDir);
      }
      if (!reaper.owns()) throw new ExclusiveFileClaimBusyError(claimDir);
      options.beforeStaleRetirement?.();
      if (!reaper.owns()) throw new ExclusiveFileClaimBusyError(claimDir);
      const quarantine = `${claimDir}.stale-${process.pid}-${(0, import_crypto.randomUUID)()}`;
      try {
        (0, import_fs.renameSync)(claimDir, quarantine);
      } catch (error) {
        if (isNotFound(error)) continue;
        throw error;
      }
      const moved = readOwner(quarantine);
      if (!sameOwner(observed, moved) || !reaper.owns()) {
        restoreQuarantine(quarantine, claimDir);
        throw new ExclusiveFileClaimBusyError(claimDir);
      }
      (0, import_fs.rmSync)(quarantine, { recursive: true, force: true });
    } finally {
      reaper.release();
    }
  }
  throw new ExclusiveFileClaimBusyError(claimDir);
}
function acquireReaperClaim(reaperDir, input) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const owner = newOwner(input.pid, input.identity);
    try {
      return createOwnedDirectoryClaim(reaperDir, owner, input.removeDirectoryAttempt);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
    const observed = readOwner(reaperDir);
    if (observed && ownerIsAlive(observed, input.isAlive, input.identity) || !observed && claimAgeMs(reaperDir) < input.freshMs) {
      throw new ExclusiveFileClaimBusyError(reaperDir);
    }
    const quarantine = `${reaperDir}.stale-${process.pid}-${(0, import_crypto.randomUUID)()}`;
    try {
      (0, import_fs.renameSync)(reaperDir, quarantine);
    } catch (error) {
      if (isNotFound(error)) continue;
      throw error;
    }
    const moved = readOwner(quarantine);
    if (!sameOwner(observed, moved)) {
      restoreQuarantine(quarantine, reaperDir);
      throw new ExclusiveFileClaimBusyError(reaperDir);
    }
    removeDirectoryWithRetries(quarantine, input.removeDirectoryAttempt);
  }
  throw new ExclusiveFileClaimBusyError(reaperDir);
}
function createOwnedDirectoryClaim(claimDir, owner, removeDirectoryAttempt) {
  const candidate = `${claimDir}.candidate-${owner.pid}-${owner.token}`;
  (0, import_fs.mkdirSync)(candidate);
  try {
    (0, import_fs.writeFileSync)(ownerPath(candidate), `${JSON.stringify(owner)}
`, {
      flag: "wx",
      mode: 384
    });
    (0, import_fs.renameSync)(candidate, claimDir);
  } catch (error) {
    (0, import_fs.rmSync)(candidate, { recursive: true, force: true });
    throw error;
  }
  return {
    owner,
    owns: () => sameOwner(readOwner(claimDir), owner),
    release: claimRelease(claimDir, owner, removeDirectoryAttempt)
  };
}
function claimRelease(claimDir, owner, removeDirectoryAttempt) {
  let released = false;
  return () => {
    if (released) return;
    const current = readOwner(claimDir);
    if (!sameOwner(current, owner)) return;
    const quarantine = `${claimDir}.release-${owner.pid}-${owner.token}`;
    try {
      (0, import_fs.renameSync)(claimDir, quarantine);
    } catch (error) {
      if (isNotFound(error)) released = true;
      else throw error;
      return;
    }
    const moved = readOwner(quarantine);
    if (!sameOwner(moved, owner)) {
      restoreQuarantine(quarantine, claimDir);
      return;
    }
    try {
      removeDirectoryWithRetries(quarantine, removeDirectoryAttempt);
      released = true;
    } catch {
      released = true;
    }
  };
}
function restoreQuarantine(quarantine, canonical) {
  if ((0, import_fs.existsSync)(canonical)) return;
  try {
    (0, import_fs.renameSync)(quarantine, canonical);
  } catch {
  }
}
function sameOwner(left, right) {
  if (!left || !right) return !left && !right;
  return left.pid === right.pid && left.token === right.token && left.processIdentity === right.processIdentity;
}
function ownerPath(claimDir) {
  return `${claimDir}/owner.json`;
}
function readOwner(claimDir) {
  try {
    const value = JSON.parse((0, import_fs.readFileSync)(ownerPath(claimDir), "utf8"));
    return Number.isInteger(value.pid) && Number(value.pid) > 0 && typeof value.token === "string" ? {
      pid: Number(value.pid),
      token: value.token,
      ...typeof value.processIdentity === "string" ? { processIdentity: value.processIdentity } : {}
    } : void 0;
  } catch {
    return void 0;
  }
}
function claimAgeMs(claimDir) {
  try {
    return Math.max(0, Date.now() - (0, import_fs.statSync)(claimDir).mtimeMs);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return hasCode(error, "EPERM");
  }
}
function claimProcessIsAlive(pid) {
  return processIsAlive(pid);
}
function claimProcessIdentity(pid) {
  try {
    const stat = (0, import_fs.readFileSync)(`/proc/${pid}/stat`, "utf8");
    const closingParen = stat.lastIndexOf(")");
    const fields = stat.slice(closingParen + 2).split(" ");
    if (fields[19]) return `proc:${fields[19]}`;
  } catch {
  }
  try {
    const value = (0, import_child_process.execFileSync)("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 1e3,
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return value ? `ps:${value}` : void 0;
  } catch {
    return void 0;
  }
}
function claimProcessMatchesIdentity(pid, recordedIdentity, isAlive = claimProcessIsAlive, identity = claimProcessIdentity) {
  if (!isAlive(pid)) return false;
  if (!recordedIdentity) return true;
  const currentIdentity = identity(pid);
  return currentIdentity === void 0 || currentIdentity === recordedIdentity;
}
function newOwner(pid, identity) {
  const value = identity(pid);
  return {
    pid,
    token: (0, import_crypto.randomUUID)(),
    ...value ? { processIdentity: value } : {}
  };
}
function ownerIsAlive(owner, isAlive, identity) {
  return claimProcessMatchesIdentity(owner.pid, owner.processIdentity, isAlive, identity);
}
function waitSynchronously(timeoutMs) {
  if (timeoutMs <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, timeoutMs);
}
function removeDirectoryWithRetries(path, attemptRemoval = (target) => {
  (0, import_fs.rmSync)(target, { recursive: true, force: true });
}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      attemptRemoval(path);
      return;
    } catch (error) {
      if (attempt >= 3 || !isTransientRemoveError(error)) throw error;
      waitSynchronously(10);
    }
  }
}
function cleanupOrphanedReleaseQuarantines(claimDir, isAlive, identity, freshMs) {
  const parent = (0, import_path.dirname)(claimDir);
  const prefix = `${(0, import_path.basename)(claimDir)}.release-`;
  let entries;
  try {
    entries = (0, import_fs.readdirSync)(parent);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.startsWith(prefix)) continue;
    const path = (0, import_path.join)(parent, entry);
    const owner = readOwner(path);
    if (owner && ownerIsAlive(owner, isAlive, identity) || !owner && claimAgeMs(path) < freshMs) continue;
    try {
      removeDirectoryWithRetries(path);
    } catch {
    }
  }
}
function isTransientRemoveError(error) {
  return ["EBUSY", "EMFILE", "ENFILE", "ENOTEMPTY", "EPERM"].some((code) => hasCode(error, code));
}
function isPromiseLike(value) {
  return !!value && (typeof value === "object" || typeof value === "function") && "then" in value && typeof value.then === "function";
}
function isAlreadyExists(error) {
  return hasCode(error, "EEXIST") || hasCode(error, "ENOTEMPTY");
}
function isNotFound(error) {
  return hasCode(error, "ENOENT");
}
function hasCode(error, code) {
  return !!error && typeof error === "object" && "code" in error && error.code === code;
}

// lib/runner-v2/agent-state.ts
var REQUIRED_KEYS = ["status", "session", "agent_id"];
var KNOWN_KEYS = /* @__PURE__ */ new Set([
  ...REQUIRED_KEYS,
  "round",
  "started",
  "completed",
  "emits",
  "chain",
  "workspace",
  "timeout",
  "retry_max",
  "retry_attempt",
  "on_error",
  "on_timeout",
  "start_sha",
  "pid",
  "blocked_reason",
  "blocked_at",
  "error",
  "failed_reason",
  "failed_at"
]);
var STATE_STATUSES = /* @__PURE__ */ new Set(["running", "blocked", "failed", "completed", "unknown"]);
function runnerAgentStateKey(sessionPrefix, runId) {
  return [sessionPrefix, runId || "no_run"].map(normalizeKeyPart).join("_");
}
function runnerAgentStatePath(stateDir, sessionPrefix, runId) {
  return (0, import_node_path2.join)(requireAbsoluteStateDir(stateDir), `${runnerAgentStateKey(sessionPrefix, runId)}.state`);
}
function parseRunnerAgentState(content, filename = "") {
  const values = {};
  for (const rawLine of content.split(/\r?\n/)) {
    if (!rawLine) continue;
    const separator = rawLine.indexOf(":");
    if (separator <= 0) throw new Error(`Invalid runner agent state line in ${filename || "state file"}`);
    const key = rawLine.slice(0, separator).trim();
    const value = rawLine.slice(separator + 1).trim();
    if (!KNOWN_KEYS.has(key)) throw new Error(`Unknown runner agent state key '${key}'`);
    if (Object.hasOwn(values, key)) throw new Error(`Duplicate runner agent state key '${key}'`);
    values[key] = value;
  }
  for (const key of REQUIRED_KEYS) {
    if (!values[key]) throw new Error(`Runner agent state requires '${key}'`);
  }
  if (!STATE_STATUSES.has(values.status)) {
    throw new Error(`Invalid runner agent state status '${values.status}'`);
  }
  if (values.retry_attempt !== void 0 && !isNonNegativeInteger(values.retry_attempt)) {
    throw new Error("runner agent state retry_attempt must be a non-negative integer");
  }
  return values;
}
function serializeRunnerAgentState(state) {
  validateRunnerAgentState(state);
  const lines = [
    `status: ${state.status}`,
    `session: ${state.session}`,
    `agent_id: ${state.agent_id}`
  ];
  for (const key of [
    "round",
    "started",
    "completed",
    "emits",
    "chain",
    "workspace",
    "timeout",
    "retry_max",
    "retry_attempt",
    "on_error",
    "on_timeout",
    "start_sha",
    "pid",
    "blocked_reason",
    "blocked_at",
    "error",
    "failed_reason",
    "failed_at"
  ]) {
    const value = state[key];
    if (value !== void 0) lines.push(`${key}: ${value}`);
  }
  return `${lines.join("\n")}
`;
}
function readRunnerAgentState(path) {
  if (!(0, import_node_fs2.existsSync)(path)) return null;
  if ((0, import_node_fs2.lstatSync)(path).isSymbolicLink()) throw new Error(`Runner agent state must not be a symbolic link: ${path}`);
  return parseRunnerAgentState((0, import_node_fs2.readFileSync)(path, "utf8"), (0, import_node_path2.basename)(path));
}
function updateRunnerAgentState(path, update) {
  return withExclusiveFileClaim(`${path}.lock`, () => {
    const current = readRunnerAgentState(path);
    if (!current) throw new Error(`Runner agent state does not exist: ${path}`);
    const next = update(current);
    writeRunnerAgentStateUnlocked(path, next);
    return next;
  }, { waitTimeoutMs: 5e3 });
}
function transitionRunnerAgentState(path, status, reason, at = (/* @__PURE__ */ new Date()).toISOString()) {
  return updateRunnerAgentState(path, (current) => {
    const next = { ...current, status };
    if (status === "blocked") {
      next.blocked_reason = requireReason(reason, status);
      next.blocked_at = at;
    } else if (status === "failed") {
      next.error = requireReason(reason, status);
      next.failed_reason = reason;
      next.failed_at = at;
    } else {
      next.completed = at;
    }
    return next;
  });
}
function incrementRunnerAgentRetry(path) {
  return updateRunnerAgentState(path, (current) => ({
    ...current,
    retry_attempt: String(Number.parseInt(current.retry_attempt || "0", 10) + 1)
  }));
}
function writeRunnerAgentStateUnlocked(path, state) {
  validateRunnerAgentState(state);
  const directory = (0, import_node_path2.dirname)(path);
  (0, import_node_fs2.mkdirSync)(directory, { recursive: true });
  if (!(0, import_node_fs2.lstatSync)(directory).isDirectory() || (0, import_node_fs2.lstatSync)(directory).isSymbolicLink()) {
    throw new Error(`Runner agent state directory must be a real directory: ${directory}`);
  }
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  (0, import_node_fs2.writeFileSync)(temporaryPath, serializeRunnerAgentState(state), { mode: 384 });
  (0, import_node_fs2.renameSync)(temporaryPath, path);
}
function validateRunnerAgentState(state) {
  for (const key of REQUIRED_KEYS) {
    if (!state[key] || state[key].includes("\n")) throw new Error(`Runner agent state requires one-line '${key}'`);
  }
  if (!STATE_STATUSES.has(state.status)) throw new Error(`Invalid runner agent state status '${state.status}'`);
  for (const [key, value] of Object.entries(state)) {
    if (!KNOWN_KEYS.has(key)) throw new Error(`Unknown runner agent state key '${key}'`);
    if (value !== void 0 && value.includes("\n")) throw new Error(`Runner agent state '${key}' must be one line`);
  }
  if (state.retry_attempt !== void 0 && !isNonNegativeInteger(state.retry_attempt)) {
    throw new Error("runner agent state retry_attempt must be a non-negative integer");
  }
}
function normalizeKeyPart(value) {
  return value.replaceAll("-", "_").replaceAll(/[^a-zA-Z0-9_]/g, "_");
}
function requireAbsoluteStateDir(path) {
  if (!path || !path.startsWith("/")) throw new Error("Runner agent state directory must be absolute");
  return path.replace(/\/+$/, "") || "/";
}
function isNonNegativeInteger(value) {
  return /^\d+$/.test(value);
}
function requireReason(reason, status) {
  if (!reason || reason.includes("\n")) throw new Error(`Runner agent ${status} transition requires a one-line reason`);
  return reason;
}

// lib/runner-v2/error-handling.ts
function detectAgentError(reportFile) {
  if (!(0, import_node_fs3.existsSync)(reportFile)) return 0;
  assertRegularFile(reportFile, "Agent report");
  const text = (0, import_node_fs3.readFileSync)(reportFile, "utf8");
  if (/timeout|timed out|time limit exceeded|deadline exceeded/i.test(text)) return 2;
  const lines = text.split(/\r?\n/).filter((line) => /error|failed|exception|traceback|fatal/i.test(line));
  const meaningful = lines.find((line) => !/no error|zero errors|0 errors/i.test(line));
  return meaningful ? 1 : 0;
}
function calculateRetryDelay(attempt, backoff = "exponential", initialDelay = 5, maxDelay = 300, multiplier = 2) {
  assertNonNegativeFinite(attempt, "attempt");
  assertNonNegativeFinite(initialDelay, "initial delay");
  assertNonNegativeFinite(maxDelay, "max delay");
  assertNonNegativeFinite(multiplier, "multiplier");
  let delay = initialDelay;
  if (backoff === "linear") delay = initialDelay * (Math.trunc(attempt) + 1);
  else if (backoff === "exponential") delay = initialDelay * multiplier ** Math.trunc(attempt);
  if (!Number.isFinite(delay)) delay = maxDelay;
  return Math.min(Math.round(delay), Math.trunc(maxDelay));
}
function getAgentRetryCount(stateDir, sessionPrefix, runId) {
  const state = readRunnerAgentState(runnerAgentStatePath(stateDir, sessionPrefix, runId));
  const attempt = Number.parseInt(state?.retry_attempt || "0", 10);
  return Number.isSafeInteger(attempt) && attempt >= 0 ? attempt : 0;
}
function incrementAgentRetryCount(stateDir, sessionPrefix, runId) {
  return Number(incrementRunnerAgentRetry(runnerAgentStatePath(stateDir, sessionPrefix, runId)).retry_attempt || "0");
}
function handleAgentError(input, write = console.log, schedule = scheduleChainRunner) {
  if (input.errorType !== "error" && input.errorType !== "timeout") throw new Error(`Unsupported agent error type: ${input.errorType}`);
  const chain = loadChain(input.chainFile, input.agentsDir);
  const agent = findAgent(chain, input.agentId);
  const retry = retryConfig(agent);
  const sessionPrefix = sessionPrefixFor(chain, agent, input.agentId);
  const retryCount = getAgentRetryCount(input.stateDir, sessionPrefix, input.runId);
  write("");
  write(`  *** ${input.errorType} detected in agent ${input.agentId}`);
  write(`      retry: ${retryCount} / ${retry.maxRetries}`);
  const agentName = stringValue(agent.name, input.agentId);
  const errorDetails = errorDetailsFromReport(input.reportFile, input.errorType);
  if (retryCount >= retry.maxRetries) notifySlack(chain, input.chainFile, "agent_error", agentName, input.agentId, errorDetails);
  const routing = recordValue(chain.routing);
  const handlerAgent = input.errorType === "timeout" ? stringValue(agent.on_timeout) || stringValue(agent.on_error) || stringValue(routing.timeout_agent) || stringValue(routing.timeout_handler) : stringValue(agent.on_error) || stringValue(routing.error_handler);
  if (retryCount < retry.maxRetries) {
    const nextCount = retryCount + 1;
    const delay = calculateRetryDelay(retryCount, retry.backoff, retry.initialDelay, retry.maxDelay, retry.multiplier);
    write(`      scheduling retry ${nextCount} in ${delay}s...`);
    incrementAgentRetryCount(input.stateDir, sessionPrefix, input.runId);
    schedule(input.chainRunner, input.chainFile, input.agentId, delay);
    return { code: 0, retryCount, maxRetries: retry.maxRetries, action: "retry" };
  }
  if (handlerAgent) {
    write(`      max retries reached. routing to error handler: ${handlerAgent}`);
    transitionRunnerAgentState(
      runnerAgentStatePath(input.stateDir, sessionPrefix, input.runId),
      "failed",
      input.errorType
    );
    schedule(input.chainRunner, input.chainFile, handlerAgent, 2);
    return { code: 0, retryCount, maxRetries: retry.maxRetries, handlerAgent, action: "handler" };
  }
  write("      no error handler configured. chain stops.");
  notifySlack(chain, input.chainFile, "chain_error", agentName, input.agentId, `${input.errorType} (no handler configured)`);
  return { code: 1, retryCount, maxRetries: retry.maxRetries, action: "stop" };
}
function scheduleChainRunner(chainRunner, chainFile, agentId, delaySeconds) {
  assertExternalPath(chainRunner, "chain runner");
  assertExternalPath(chainFile, "chain file");
  if (!agentId.trim()) throw new Error("agent id must not be empty");
  assertNonNegativeFinite(delaySeconds, "delay seconds");
  const bundle = (0, import_node_path3.resolve)(process.argv[1] || "");
  if (!bundle || !(0, import_node_path3.isAbsolute)(bundle)) throw new Error("Typed error-handling bundle path is unavailable for dispatch.");
  const child = (0, import_node_child_process.spawn)(process.execPath, [bundle, "dispatch", "--delay-seconds", String(delaySeconds), "--chain-runner", chainRunner, "--chain-file", chainFile, "--agent-id", agentId], {
    detached: true,
    stdio: "ignore",
    env: process.env
  });
  child.on("error", () => void 0);
  child.unref();
}
function dispatchChainRunner(chainRunner, chainFile, agentId, delaySeconds) {
  assertExternalPath(chainRunner, "chain runner");
  assertExternalPath(chainFile, "chain file");
  assertNonNegativeFinite(delaySeconds, "delay seconds");
  return new Promise((resolveDispatch, rejectDispatch) => {
    setTimeout(() => {
      const child = (0, import_node_child_process.spawn)("/bin/bash", [chainRunner, chainFile, "--start", agentId], { detached: true, stdio: "ignore", env: process.env });
      child.on("error", rejectDispatch);
      child.unref();
      resolveDispatch();
    }, delaySeconds * 1e3);
  });
}
function loadChain(chainFile, agentsDir) {
  assertRegularFile(chainFile, "Chain file");
  const raw = decodeRawChainDefinition(chainFile);
  const agents = Array.isArray(raw.agents) ? raw.agents : [];
  const hasReferences = agents.some((agent) => isRecord(agent) && typeof agent.$ref === "string" && agent.$ref.trim());
  return hasReferences ? loadNormalizedChainDefinition(chainFile, requiredAgentsDir(agentsDir)) : raw;
}
function retryConfig(agent) {
  const retry = recordValue(agent.retry);
  return {
    maxRetries: nonNegativeInteger(retry.max_retries, 0),
    backoff: stringValue(retry.backoff, "exponential"),
    initialDelay: nonNegativeNumber(retry.initial_delay, 5),
    maxDelay: nonNegativeNumber(retry.max_delay, 300),
    multiplier: nonNegativeNumber(retry.backoff_multiplier, 2)
  };
}
function sessionPrefixFor(chain, agent, agentId) {
  const configuredAgentPrefix = stringValue(agent.session_prefix);
  if (configuredAgentPrefix) return configuredAgentPrefix;
  const config = recordValue(chain.config);
  const chainPrefix = stringValue(config.session_prefix);
  return chainPrefix ? `${chainPrefix}-${agentId}` : agentId;
}
function findAgent(chain, agentId) {
  if (!Array.isArray(chain.agents)) throw new Error("chain.agents must be an array");
  const agent = chain.agents.find((candidate) => stringValue(candidate.id) === agentId);
  if (!agent) throw new Error(`Agent not found: ${agentId}`);
  return agent;
}
function errorDetailsFromReport(reportFile, errorType2) {
  if (!(0, import_node_fs3.existsSync)(reportFile)) return `Agent ${errorType2}`;
  assertRegularFile(reportFile, "Agent report");
  const line = (0, import_node_fs3.readFileSync)(reportFile, "utf8").split(/\r?\n/).find((candidate) => /error|failed|exception/i.test(candidate));
  return line?.trim() || `Agent ${errorType2}`;
}
function notifySlack(chain, chainFile, event, agentName, agentId, error) {
  try {
    const config = recordValue(chain.config);
    const slack = recordValue(config.slack);
    const webhook = stringValue(process.env.SLACK_WEBHOOK_URL) || stringValue(slack.webhook_url);
    const enabled = slack.enabled === true || Boolean(process.env.SLACK_WEBHOOK_URL);
    if (!enabled || !webhook) return;
    const events = Array.isArray(slack.events) ? slack.events.filter((value) => typeof value === "string") : [];
    if (events.length > 0 && !events.includes(event)) return;
    const chainName = stringValue(chain.name, "unknown");
    const runId = process.env.MENTIKO_RUN_ID || process.env.RUN_ID || "";
    const fields = [
      { title: "Chain", value: chainName, short: true },
      { title: "Agent", value: agentName, short: true },
      { title: "Error", value: error.slice(0, 300), short: false }
    ];
    if (runId) fields.push({ title: "Run ID", value: runId, short: true });
    const payload = {
      username: "Agent Chain",
      icon_emoji: ":robot_face:",
      attachments: [{ color: event === "chain_error" ? "#dc3545" : "#ffc107", footer: "mentiko", ts: Math.floor(Date.now() / 1e3), fields }]
    };
    const response = (0, import_node_child_process.spawnSync)("curl", ["-sS", "--max-time", "5", "-X", "POST", webhook, "-H", "Content-Type: application/json", "-d", JSON.stringify(payload)], { encoding: "utf8" });
    if (response.status === 0) console.log(`  slack: sent ${event} notification`);
  } catch {
  }
  void chainFile;
}
function requiredAgentsDir(path) {
  if (!path?.trim()) throw new Error("Agent references require an agents directory.");
  return path;
}
function assertExternalPath(path, label) {
  if (!path || !(0, import_node_path3.isAbsolute)(path)) throw new Error(`${label} path must be absolute.`);
}
function assertRegularFile(path, label) {
  const stat = (0, import_node_fs3.lstatSync)(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a regular file: ${path}`);
}
function recordValue(value) {
  return isRecord(value) ? value : {};
}
function stringValue(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}
function nonNegativeNumber(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && /^(?:\d+|\d*\.\d+)$/.test(value)) return Number(value);
  return fallback;
}
function nonNegativeInteger(value, fallback) {
  const number2 = nonNegativeNumber(value, fallback);
  return Number.isSafeInteger(number2) ? number2 : fallback;
}
function assertNonNegativeFinite(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be finite and non-negative.`);
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// lib/runner-v2/error-handling-cli.ts
async function runErrorHandlingCli(argv, write = console.log) {
  const command = argv[0];
  if (!isCommand(command)) throw new Error(usage());
  const values = parseValues(argv.slice(1));
  if (command === "detect") {
    rejectUnexpected(values, /* @__PURE__ */ new Set(["--report-file"]));
    return detectAgentError(required(values, "--report-file"));
  }
  if (command === "delay") {
    rejectUnexpected(values, /* @__PURE__ */ new Set(["--attempt", "--backoff", "--initial-delay", "--max-delay", "--multiplier"]));
    write(String(calculateRetryDelay(number(values, "--attempt"), optional(values, "--backoff") || "exponential", number(values, "--initial-delay", 5), number(values, "--max-delay", 300), number(values, "--multiplier", 2))));
    return 0;
  }
  if (command === "retry-count") {
    const stateDir2 = required(values, "--state-dir");
    const runId2 = required(values, "--run-id");
    const sessionPrefix = required(values, "--session-prefix");
    rejectUnexpected(values, /* @__PURE__ */ new Set(["--state-dir", "--run-id", "--session-prefix"]));
    write(String(getAgentRetryCount(stateDir2, sessionPrefix, runId2)));
    return 0;
  }
  if (command === "increment-retry") {
    const stateDir2 = required(values, "--state-dir");
    const runId2 = required(values, "--run-id");
    const sessionPrefix = required(values, "--session-prefix");
    rejectUnexpected(values, /* @__PURE__ */ new Set(["--state-dir", "--run-id", "--session-prefix"]));
    write(String(incrementAgentRetryCount(stateDir2, sessionPrefix, runId2)));
    return 0;
  }
  if (command === "dispatch") {
    rejectUnexpected(values, /* @__PURE__ */ new Set(["--delay-seconds", "--chain-runner", "--chain-file", "--agent-id"]));
    await dispatchChainRunner(required(values, "--chain-runner"), required(values, "--chain-file"), required(values, "--agent-id"), number(values, "--delay-seconds"));
    return 0;
  }
  rejectUnexpected(values, /* @__PURE__ */ new Set(["--state-dir", "--run-id", "--session-prefix", "--agent-id", "--error-type", "--report-file", "--chain-file", "--chain-runner", "--agents-dir"]));
  const stateDir = required(values, "--state-dir");
  const runId = required(values, "--run-id");
  const result = handleAgentError({
    agentId: required(values, "--agent-id"),
    errorType: errorType(values),
    reportFile: required(values, "--report-file"),
    chainFile: required(values, "--chain-file"),
    chainRunner: required(values, "--chain-runner"),
    stateDir,
    runId,
    agentsDir: optional(values, "--agents-dir")
  }, write);
  return result.code;
}
function parseValues(argv) {
  const values = /* @__PURE__ */ new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === void 0 || values.has(flag)) throw new Error(usage());
    values.set(flag, value);
  }
  return values;
}
function rejectUnexpected(values, allowed) {
  for (const key of values.keys()) if (!allowed.has(key)) throw new Error(`${key} is not valid for runner-error-handling.`);
}
function required(values, key) {
  const value = values.get(key);
  if (!value?.trim()) throw new Error(`${key} is required.`);
  return value;
}
function optional(values, key) {
  return values.get(key);
}
function number(values, key, fallback) {
  const value = optional(values, key);
  if (value === void 0 && fallback !== void 0) return fallback;
  if (value === void 0 || !/^(?:\d+|\d*\.\d+)$/.test(value)) throw new Error(`${key} must be a non-negative number.`);
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`${key} must be finite.`);
  return result;
}
function errorType(values) {
  const value = optional(values, "--error-type") || "error";
  if (value !== "error" && value !== "timeout") throw new Error("--error-type must be error or timeout.");
  return value;
}
function isCommand(value) {
  return value === "detect" || value === "retry-count" || value === "increment-retry" || value === "delay" || value === "handle" || value === "dispatch";
}
function usage() {
  return "usage: runner-error-handling <detect|retry-count|increment-retry|delay|handle|dispatch> [options]";
}
if (require.main === module) {
  runErrorHandlingCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`runner error handling failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runErrorHandlingCli
});
