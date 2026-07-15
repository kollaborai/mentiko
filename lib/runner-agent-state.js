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

// lib/runner-v2/agent-state-cli.ts
var agent_state_cli_exports = {};
__export(agent_state_cli_exports, {
  runRunnerAgentStateCli: () => runRunnerAgentStateCli
});
module.exports = __toCommonJS(agent_state_cli_exports);

// lib/runner-v2/agent-state.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");

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
  return (0, import_node_path.join)(requireAbsoluteStateDir(stateDir), `${runnerAgentStateKey(sessionPrefix, runId)}.state`);
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
function createRunnerAgentState(path, input) {
  const state = {
    ...input,
    status: "running",
    retry_attempt: input.retry_attempt ?? "0"
  };
  writeRunnerAgentState(path, state);
  return state;
}
function readRunnerAgentState(path) {
  if (!(0, import_node_fs.existsSync)(path)) return null;
  if ((0, import_node_fs.lstatSync)(path).isSymbolicLink()) throw new Error(`Runner agent state must not be a symbolic link: ${path}`);
  return parseRunnerAgentState((0, import_node_fs.readFileSync)(path, "utf8"), (0, import_node_path.basename)(path));
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
function writeRunnerAgentState(path, state) {
  withExclusiveFileClaim(`${path}.lock`, () => writeRunnerAgentStateUnlocked(path, state), { waitTimeoutMs: 5e3 });
}
function writeRunnerAgentStateUnlocked(path, state) {
  validateRunnerAgentState(state);
  const directory = (0, import_node_path.dirname)(path);
  (0, import_node_fs.mkdirSync)(directory, { recursive: true });
  if (!(0, import_node_fs.lstatSync)(directory).isDirectory() || (0, import_node_fs.lstatSync)(directory).isSymbolicLink()) {
    throw new Error(`Runner agent state directory must be a real directory: ${directory}`);
  }
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  (0, import_node_fs.writeFileSync)(temporaryPath, serializeRunnerAgentState(state), { mode: 384 });
  (0, import_node_fs.renameSync)(temporaryPath, path);
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

// lib/runner-v2/agent-state-cli.ts
var COMMANDS = ["start", "block", "fail", "complete", "increment-retry", "retry-attempt", "started-at", "status", "path"];
function runRunnerAgentStateCli(argv, write = (line) => console.log(line)) {
  const parsed = parseCli(argv);
  const stateDir = required(parsed.values, "--state-dir");
  const sessionPrefix = required(parsed.values, "--session-prefix");
  const path = runnerAgentStatePath(stateDir, sessionPrefix, optional(parsed.values, "--run-id"));
  if (parsed.command === "path") {
    rejectUnexpected(parsed, /* @__PURE__ */ new Set(["--state-dir", "--session-prefix", "--run-id"]));
    write(path);
    return;
  }
  if (parsed.command === "start") {
    rejectUnexpected(parsed, /* @__PURE__ */ new Set([
      "--state-dir",
      "--session-prefix",
      "--run-id",
      "--session",
      "--agent-id",
      "--round",
      "--emits",
      "--chain",
      "--workspace",
      "--timeout",
      "--retry-max",
      "--on-error",
      "--on-timeout",
      "--start-sha",
      "--pid"
    ]));
    const state2 = createRunnerAgentState(path, {
      session: required(parsed.values, "--session"),
      agent_id: required(parsed.values, "--agent-id"),
      round: optional(parsed.values, "--round"),
      emits: optional(parsed.values, "--emits"),
      chain: optional(parsed.values, "--chain"),
      workspace: optional(parsed.values, "--workspace"),
      timeout: optional(parsed.values, "--timeout"),
      retry_max: optional(parsed.values, "--retry-max"),
      on_error: optional(parsed.values, "--on-error"),
      on_timeout: optional(parsed.values, "--on-timeout"),
      start_sha: optional(parsed.values, "--start-sha"),
      pid: optional(parsed.values, "--pid"),
      started: (/* @__PURE__ */ new Date()).toISOString()
    });
    write(JSON.stringify(state2));
    return;
  }
  if (parsed.command === "status") {
    rejectUnexpected(parsed, /* @__PURE__ */ new Set(["--state-dir", "--session-prefix", "--run-id"]));
    const state2 = readRunnerAgentState(path);
    if (!state2) throw new Error(`Runner agent state does not exist: ${path}`);
    write(state2.status);
    return;
  }
  if (parsed.command === "increment-retry") {
    rejectUnexpected(parsed, /* @__PURE__ */ new Set(["--state-dir", "--session-prefix", "--run-id"]));
    write(incrementRunnerAgentRetry(path).retry_attempt || "0");
    return;
  }
  if (parsed.command === "retry-attempt") {
    rejectUnexpected(parsed, /* @__PURE__ */ new Set(["--state-dir", "--session-prefix", "--run-id"]));
    const state2 = readRunnerAgentState(path);
    write(state2?.retry_attempt || "0");
    return;
  }
  if (parsed.command === "started-at") {
    rejectUnexpected(parsed, /* @__PURE__ */ new Set(["--state-dir", "--session-prefix", "--run-id"]));
    const state2 = readRunnerAgentState(path);
    write(state2?.started || "");
    return;
  }
  rejectUnexpected(parsed, /* @__PURE__ */ new Set(["--state-dir", "--session-prefix", "--run-id", "--reason"]));
  const state = parsed.command === "block" ? transitionRunnerAgentState(path, "blocked", required(parsed.values, "--reason")) : parsed.command === "fail" ? transitionRunnerAgentState(path, "failed", required(parsed.values, "--reason")) : transitionRunnerAgentState(path, "completed");
  write(JSON.stringify(state));
}
function parseCli(argv) {
  const command = argv[0];
  if (!command || !COMMANDS.includes(command)) throw new Error(usage());
  const values = /* @__PURE__ */ new Map();
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || !value || !flag.startsWith("--") || values.has(flag)) throw new Error(usage());
    values.set(flag, value);
  }
  return { command, values };
}
function rejectUnexpected(parsed, allowed) {
  for (const key of parsed.values.keys()) {
    if (!allowed.has(key)) throw new Error(`${key} is not valid for ${parsed.command}`);
  }
}
function required(values, key) {
  const value = values.get(key);
  if (!value) throw new Error(`${key} is required`);
  return value;
}
function optional(values, key) {
  return values.get(key) || void 0;
}
function usage() {
  return `usage: runner-agent-state <${COMMANDS.join("|")}> --state-dir <absolute-dir> --session-prefix <prefix> [options]`;
}
if (require.main === module) {
  try {
    runRunnerAgentStateCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runRunnerAgentStateCli
});
