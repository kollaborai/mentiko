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

// lib/runner-v2/retry-circuit-cli.ts
var retry_circuit_cli_exports = {};
__export(retry_circuit_cli_exports, {
  runRetryCircuitCli: () => runRetryCircuitCli
});
module.exports = __toCommonJS(retry_circuit_cli_exports);

// lib/runner-v2/retry-circuit.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var import_node_crypto = require("node:crypto");

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

// lib/runner-v2/retry-circuit.ts
var STATE_NAMES = /* @__PURE__ */ new Set(["closed", "open", "half_open"]);
function configuredRetryDir(stateDir) {
  if (!stateDir || !(0, import_node_path.isAbsolute)(stateDir)) throw new Error("Configured state root must be an absolute path.");
  const canonicalStateDir = (0, import_node_fs.realpathSync)(stateDir);
  if ((0, import_node_fs.lstatSync)(canonicalStateDir).isSymbolicLink()) throw new Error("Configured state root must not be a symbolic link.");
  const retryDir = (0, import_node_path.resolve)(canonicalStateDir, "retry");
  if ((0, import_node_fs.existsSync)(retryDir) && (0, import_node_fs.lstatSync)(retryDir).isSymbolicLink()) throw new Error("Configured retry root must not be a symbolic link.");
  return retryDir;
}
function circuitStatePath(stateDir, chainId, agentName) {
  const retryDir = configuredRetryDir(stateDir);
  if (!/^[A-Za-z0-9_-]+$/.test(chainId)) throw new Error("Circuit chain id must contain only letters, numbers, underscores, or hyphens.");
  if (!agentName.trim()) throw new Error("Circuit agent name must not be empty.");
  const safeAgent = agentName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const path = (0, import_node_path.resolve)(retryDir, `circuit_${chainId}_${safeAgent}.json`);
  if ((0, import_node_path.dirname)(path) !== retryDir || (0, import_node_path.basename)(path) !== `circuit_${chainId}_${safeAgent}.json` || (0, import_node_path.relative)(retryDir, path).startsWith("..")) {
    throw new Error("Circuit state path escapes the configured retry root.");
  }
  return path;
}
function calculateBackoff(attempt, strategy, baseDelay, maxDelay = baseDelay * 10) {
  assertNonNegativeSafeInteger(attempt, "attempt");
  assertNonNegativeSafeInteger(baseDelay, "base delay");
  assertNonNegativeSafeInteger(maxDelay, "max delay");
  let delay = baseDelay;
  if (strategy === "linear") delay = baseDelay * attempt;
  else if (strategy === "exponential" || strategy === "exponential_with_jitter") {
    delay = baseDelay * 2 ** Math.max(0, attempt - 1);
    if (strategy === "exponential_with_jitter") {
      const jitterPercent = Math.floor(Math.random() * 50) - 25;
      delay += Math.trunc(delay * jitterPercent / 100);
      if (delay < 0) delay = baseDelay;
    }
  }
  if (!Number.isSafeInteger(delay)) delay = maxDelay;
  return Math.min(delay, maxDelay);
}
function shouldRetry(attempt, maxRetries) {
  assertNonNegativeSafeInteger(attempt, "attempt");
  assertNonNegativeSafeInteger(maxRetries, "max retries");
  return attempt < maxRetries;
}
function isCircuitOpen(stateDir, chainId, agentName, now = epochSeconds()) {
  const path = circuitStatePath(stateDir, chainId, agentName);
  return withCircuitClaim(path, () => {
    if (!(0, import_node_fs.existsSync)(path)) return false;
    const state = readCircuitState(path);
    if (state.state === "open" && now > state.open_until) {
      writeCircuitState(path, { ...state, state: "half_open", failure_count: 0, last_failure: 0, open_until: 0 });
      return false;
    }
    return state.state === "open";
  });
}
function recordCircuitFailure(input) {
  const threshold = input.threshold ?? 5;
  const timeout = input.timeout ?? 300;
  assertPositiveSafeInteger(threshold, "threshold");
  assertNonNegativeSafeInteger(timeout, "timeout");
  const now = input.now ?? epochSeconds();
  assertNonNegativeSafeInteger(now, "now");
  const path = circuitStatePath(input.stateDir, input.chainId, input.agentName);
  return withCircuitClaim(path, () => {
    const current = (0, import_node_fs.existsSync)(path) ? readCircuitState(path) : void 0;
    const failureCount = (current?.failure_count || 0) + 1;
    const opened = failureCount >= threshold;
    const next = {
      state: opened ? "open" : current?.state || "closed",
      failure_count: failureCount,
      last_failure: now,
      open_until: opened ? now + timeout : 0,
      threshold,
      timeout
    };
    writeCircuitState(path, next);
    return next;
  });
}
function resetCircuit(stateDir, chainId, agentName) {
  const path = circuitStatePath(stateDir, chainId, agentName);
  withCircuitClaim(path, () => {
    if ((0, import_node_fs.existsSync)(path)) (0, import_node_fs.rmSync)(path);
  });
}
function getCircuitState(stateDir, chainId, agentName) {
  const path = circuitStatePath(stateDir, chainId, agentName);
  return withCircuitClaim(path, () => (0, import_node_fs.existsSync)(path) ? readCircuitState(path) : { state: "closed", failure_count: 0 });
}
function validateRawCircuitState(content) {
  if (content.trim() === "") return { valid: false, issues: [{ code: "empty-file", message: "Circuit state file must not be empty." }] };
  let value;
  try {
    value = JSON.parse(content);
  } catch (error) {
    return { valid: false, issues: [{ code: "invalid-json", message: error instanceof Error ? error.message : "Circuit state is not valid JSON." }] };
  }
  if (!isRecord(value)) return { valid: false, issues: [{ code: "invalid-root", message: "Circuit state JSON root must be an object." }] };
  return { valid: true, value, issues: [] };
}
function validateCircuitState(value) {
  if (!isRecord(value)) return { valid: false, issues: [{ field: "root", message: "Circuit state must be an object." }] };
  const issues = [];
  if (typeof value.state !== "string" || !STATE_NAMES.has(value.state)) issues.push({ field: "state", message: "Circuit state name is invalid." });
  for (const field of ["failure_count", "last_failure", "open_until", "threshold", "timeout"]) {
    if (typeof value[field] !== "number" || !Number.isSafeInteger(value[field]) || value[field] < 0) issues.push({ field, message: "Circuit state value must be a non-negative safe integer." });
  }
  return { valid: issues.length === 0, issues };
}
function formatCircuitState(state) {
  const full = state;
  return `state: ${state.state}
failures: ${state.failure_count}
threshold: ${full.threshold ?? "N/A"}
opens_at: ${full.open_until ?? 0}`;
}
function readCircuitState(path) {
  assertNotSymbolicLink(path, "Circuit state record");
  const content = (0, import_node_fs.readFileSync)(path, "utf8");
  const raw = validateRawCircuitState(content);
  if (!raw.valid || !raw.value) throw new Error(`Invalid raw circuit state JSON at ${path}: ${raw.issues.map((issue) => issue.message).join(" ")}`);
  const normalized = validateCircuitState(raw.value);
  if (!normalized.valid) throw new Error(`Invalid normalized circuit state at ${path}: ${normalized.issues.map((issue) => issue.field).join(", ")}.`);
  return raw.value;
}
function writeCircuitState(path, state) {
  (0, import_node_fs.mkdirSync)((0, import_node_path.dirname)(path), { recursive: true, mode: 448 });
  assertNotSymbolicLink((0, import_node_path.dirname)(path), "Circuit retry root");
  assertNotSymbolicLink(path, "Circuit state record");
  const temp = `${path}.${process.pid}.${(0, import_node_crypto.randomUUID)()}.tmp`;
  try {
    (0, import_node_fs.writeFileSync)(temp, `${JSON.stringify(state, null, 2)}
`, { encoding: "utf8", mode: 384, flag: "wx" });
    (0, import_node_fs.renameSync)(temp, path);
  } finally {
    if ((0, import_node_fs.existsSync)(temp)) (0, import_node_fs.rmSync)(temp, { force: true });
  }
}
function withCircuitClaim(path, work) {
  assertNotSymbolicLink(`${path}.lock`, "Circuit state lock");
  return withExclusiveFileClaim(`${path}.lock`, work, { freshMs: 6e4, waitTimeoutMs: 5e3, retryDelayMs: 50 });
}
function epochSeconds() {
  return Math.floor(Date.now() / 1e3);
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function assertNotSymbolicLink(path, label) {
  if ((0, import_node_fs.existsSync)(path) && (0, import_node_fs.lstatSync)(path).isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${path}`);
}
function assertNonNegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer.`);
}
function assertPositiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer.`);
}

// lib/runner-v2/retry-circuit-cli.ts
var COMMANDS = ["backoff", "should-retry", "state-file", "is-open", "record-failure", "reset", "state", "format-backoff", "format-state"];
function runRetryCircuitCli(argv, write = console.log) {
  const command = argv[0];
  if (!COMMANDS.includes(command)) throw new Error(`usage: runner-retry-circuit <${COMMANDS.join("|")}> [options]`);
  const values = parseValues(argv.slice(1));
  if (command === "backoff" || command === "format-backoff") {
    allow(values, /* @__PURE__ */ new Set(["--attempt", "--strategy", "--base-ms", "--max-ms"]));
    const delay = calculateBackoff(integer(values, "--attempt"), required(values, "--strategy"), integer(values, "--base-ms"), optionalInteger(values, "--max-ms"));
    write(command === "format-backoff" ? `${delay} ms (${(delay / 1e3).toFixed(2)}s)` : String(delay));
    return;
  }
  if (command === "should-retry") {
    allow(values, /* @__PURE__ */ new Set(["--attempt", "--max-retries"]));
    write(String(shouldRetry(integer(values, "--attempt"), integer(values, "--max-retries"))));
    return;
  }
  const stateDir = required(values, "--state-dir");
  const chainId = required(values, "--chain-id");
  const agentName = required(values, "--agent-name");
  if (command === "state-file") {
    allow(values, /* @__PURE__ */ new Set(["--state-dir", "--chain-id", "--agent-name"]));
    write(circuitStatePath(stateDir, chainId, agentName));
  } else if (command === "is-open") {
    allow(values, /* @__PURE__ */ new Set(["--state-dir", "--chain-id", "--agent-name"]));
    write(String(isCircuitOpen(stateDir, chainId, agentName)));
  } else if (command === "record-failure") {
    allow(values, /* @__PURE__ */ new Set(["--state-dir", "--chain-id", "--agent-name", "--threshold", "--timeout"]));
    recordCircuitFailure({ stateDir, chainId, agentName, threshold: optionalInteger(values, "--threshold"), timeout: optionalInteger(values, "--timeout") });
  } else if (command === "reset") {
    allow(values, /* @__PURE__ */ new Set(["--state-dir", "--chain-id", "--agent-name"]));
    resetCircuit(stateDir, chainId, agentName);
    write("circuit reset");
  } else if (command === "format-state") {
    allow(values, /* @__PURE__ */ new Set(["--state-dir", "--chain-id", "--agent-name"]));
    write(formatCircuitState(getCircuitState(stateDir, chainId, agentName)));
  } else {
    allow(values, /* @__PURE__ */ new Set(["--state-dir", "--chain-id", "--agent-name"]));
    const state = getCircuitState(stateDir, chainId, agentName);
    write(JSON.stringify(state, null, "threshold" in state ? 2 : void 0));
  }
}
function parseValues(argv) {
  const values = /* @__PURE__ */ new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === void 0 || value.startsWith("--") || values.has(flag)) throw new Error(`Invalid retry circuit argument: ${flag || ""}`);
    values.set(flag, value);
  }
  return values;
}
function allow(values, allowed) {
  for (const key of values.keys()) if (!allowed.has(key)) throw new Error(`${key} is not valid for retry circuit command.`);
}
function required(values, flag) {
  const value = values.get(flag);
  if (!value?.trim()) throw new Error(`Missing required retry circuit argument: ${flag}`);
  return value;
}
function integer(values, flag) {
  const value = required(values, flag);
  if (!/^\d+$/.test(value)) throw new Error(`${flag} must be a non-negative integer.`);
  return Number(value);
}
function optionalInteger(values, flag) {
  return values.has(flag) ? integer(values, flag) : void 0;
}
if (typeof require !== "undefined" && require.main === module) {
  try {
    runRetryCircuitCli(process.argv.slice(2));
  } catch (error) {
    console.error(`runner retry circuit failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runRetryCircuitCli
});
