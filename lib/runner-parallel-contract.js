#!/usr/bin/env node
"use strict";

// lib/runner-v2/parallel-contract.ts
var import_node_fs = require("node:fs");
var import_node_crypto = require("node:crypto");
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

// lib/runner-v2/parallel-contract.ts
var GROUP_ID = /^parallel-[A-Za-z0-9][A-Za-z0-9._-]*$/;
var AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function parallelDir(stateDir) {
  if (!(0, import_node_path.isAbsolute)(stateDir)) throw new Error("state directory must be absolute");
  const root = (0, import_node_path.resolve)(stateDir);
  ensureDirectory(root, "state directory");
  const directory = (0, import_node_path.join)(root, "parallel");
  ensureDirectory(directory, "parallel state directory");
  return directory;
}
function validateRawParallelGroup(text) {
  try {
    const value = JSON.parse(text);
    return isRecord(value) && !Array.isArray(value) ? { valid: true, value } : { valid: false };
  } catch {
    return { valid: false };
  }
}
function validateParallelGroup(value) {
  if (!isRecord(value) || !GROUP_ID.test(stringValue(value.id))) return false;
  if (value.status !== "running" && value.status !== "complete") return false;
  if (!isIsoDate(value.started) || !stringArray(value.agents) || value.agents.length === 0) return false;
  if (new Set(value.agents).size !== value.agents.length || value.agents.some((agent) => !AGENT_ID.test(agent))) return false;
  if (!recordMap(value.pids, value.agents, isPid)) return false;
  const results = value.results;
  if (!recordMap(results, value.agents, isParallelResult)) return false;
  const complete = value.agents.every((agent) => Object.hasOwn(results, agent));
  if (value.status === "complete" && (!complete || !isIsoDate(value.completed))) return false;
  if (value.status === "running" && value.completed !== void 0) return false;
  return true;
}
function createParallelGroup(stateDir, agents, id = `parallel-${Date.now()}-${(0, import_node_crypto.randomUUID)().slice(0, 8)}`) {
  assertGroupId(id);
  if (!stringArray(agents) || agents.length === 0 || new Set(agents).size !== agents.length || agents.some((agent) => !AGENT_ID.test(agent))) {
    throw new Error("parallel group agents must be unique, non-empty ids");
  }
  const group = {
    id,
    status: "running",
    started: (/* @__PURE__ */ new Date()).toISOString(),
    agents: [...agents],
    pids: {},
    results: {}
  };
  writeRecord(recordPath(stateDir, id), group);
  return group;
}
function recordParallelPid(stateDir, id, agent, pid) {
  assertPid(pid);
  return mutate(stateDir, id, (group) => {
    assertKnownAgent(group, agent);
    if (group.status === "complete") throw new Error(`parallel group is already complete: ${id}`);
    return { ...group, pids: { ...group.pids, [agent]: pid } };
  });
}
function recordParallelResult(stateDir, id, agent, exitCode) {
  if (!Number.isSafeInteger(exitCode)) throw new Error("parallel exit code must be a safe integer");
  return mutate(stateDir, id, (group) => {
    assertKnownAgent(group, agent);
    if (group.status === "complete") throw new Error(`parallel group is already complete: ${id}`);
    const results = {
      ...group.results,
      [agent]: exitCode === 0 ? { status: "success" } : { status: "failed", exitCode }
    };
    const complete = group.agents.every((candidate) => Object.hasOwn(results, candidate));
    return {
      ...group,
      results,
      status: complete ? "complete" : "running",
      ...complete ? { completed: (/* @__PURE__ */ new Date()).toISOString() } : {}
    };
  });
}
function cleanupParallelGroups(stateDir, days) {
  if (!Number.isSafeInteger(days) || days < 0) throw new Error("cleanup days must be a non-negative safe integer");
  const directory = parallelDir(stateDir);
  const cutoff = Date.now() - days * 864e5;
  return (0, import_node_fs.readdirSync)(directory).filter((name) => name.endsWith(".json")).map((name) => (0, import_node_path.join)(directory, name)).filter((path) => {
    const entry = (0, import_node_fs.lstatSync)(path);
    if (entry.isSymbolicLink() || !entry.isFile()) return false;
    return entry.mtimeMs < cutoff;
  }).map((path) => {
    (0, import_node_fs.rmSync)(path);
    return path;
  });
}
function mutate(stateDir, id, update) {
  const path = recordPath(stateDir, id);
  const lock = `${path}.lock`;
  return withExclusiveFileClaim(lock, () => {
    assertRegularFile(path, "parallel group record");
    const raw = validateRawParallelGroup((0, import_node_fs.readFileSync)(path, "utf8"));
    if (!raw.valid || !validateParallelGroup(raw.value)) throw new Error(`invalid parallel group record: ${path}`);
    const next = update(raw.value);
    if (!validateParallelGroup(next)) throw new Error(`parallel group mutation produced invalid state: ${id}`);
    writeRecord(path, next);
    return next;
  });
}
function recordPath(stateDir, id) {
  assertGroupId(id);
  return (0, import_node_path.join)(parallelDir(stateDir), `${id}.json`);
}
function writeRecord(path, group) {
  const directory = (0, import_node_path.dirname)(path);
  ensureDirectory(directory, "parallel state directory");
  if ((0, import_node_fs.existsSync)(path)) assertRegularFile(path, "parallel group record");
  const temporary = (0, import_node_path.join)(directory, `.${(0, import_node_path.basename)(path)}.${(0, import_node_crypto.randomUUID)()}.tmp`);
  (0, import_node_fs.writeFileSync)(temporary, `${JSON.stringify(group, null, 2)}
`, { flag: "wx", mode: 384 });
  (0, import_node_fs.renameSync)(temporary, path);
}
function ensureDirectory(path, label) {
  if ((0, import_node_fs.existsSync)(path)) {
    const entry2 = (0, import_node_fs.lstatSync)(path);
    if (entry2.isSymbolicLink() || !entry2.isDirectory()) throw new Error(`${label} must be a non-symlink directory: ${path}`);
    return;
  }
  (0, import_node_fs.mkdirSync)(path, { recursive: true, mode: 448 });
  const entry = (0, import_node_fs.lstatSync)(path);
  if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error(`${label} must be a non-symlink directory: ${path}`);
}
function assertRegularFile(path, label) {
  const entry = (0, import_node_fs.lstatSync)(path);
  if (entry.isSymbolicLink() || !entry.isFile()) throw new Error(`${label} must be a non-symlink regular file: ${path}`);
}
function assertGroupId(value) {
  if (!GROUP_ID.test(value)) throw new Error(`invalid parallel group id: ${value}`);
}
function assertKnownAgent(group, agent) {
  if (!group.agents.includes(agent)) throw new Error(`agent is not part of parallel group: ${agent}`);
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function stringValue(value) {
  return typeof value === "string" ? value : "";
}
function stringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
function isPid(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function assertPid(value) {
  if (!isPid(value)) throw new Error("parallel pid must be a non-negative safe integer");
}
function isIsoDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function recordMap(value, agents, predicate) {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([agent, entry]) => agents.includes(agent) && predicate(entry));
}
function isParallelResult(value) {
  if (!isRecord(value) || value.status !== "success" && value.status !== "failed") return false;
  return value.status === "success" ? value.exitCode === void 0 : typeof value.exitCode === "number" && Number.isSafeInteger(value.exitCode);
}

// lib/runner-v2/parallel-contract-cli.ts
function flag(values2, name) {
  const value = values2.get(name);
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value;
}
function values(argv) {
  const result = /* @__PURE__ */ new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === void 0 || result.has(key)) throw new Error("invalid parallel arguments");
    result.set(key, value);
  }
  return result;
}
function main(argv) {
  const command = argv[0];
  const parsed = values(argv.slice(1));
  if (command === "create" || command === "create-id") {
    const agents = flag(parsed, "--agents").split(",").map((agent) => agent.trim()).filter(Boolean);
    const group = createParallelGroup(flag(parsed, "--state-dir"), agents);
    console.log(command === "create-id" ? group.id : JSON.stringify(group));
    return;
  }
  if (command === "pid") {
    const updated = recordParallelPid(flag(parsed, "--state-dir"), flag(parsed, "--id"), flag(parsed, "--agent"), safeInteger(flag(parsed, "--pid")));
    console.log(JSON.stringify(updated));
    return;
  }
  if (command === "result") {
    const updated = recordParallelResult(flag(parsed, "--state-dir"), flag(parsed, "--id"), flag(parsed, "--agent"), safeInteger(flag(parsed, "--exit")));
    console.log(JSON.stringify(updated));
    return;
  }
  if (command === "cleanup") {
    console.log(JSON.stringify(cleanupParallelGroups(flag(parsed, "--state-dir"), safeInteger(flag(parsed, "--days")))));
    return;
  }
  throw new Error("usage: runner-parallel-contract <create|create-id|pid|result|cleanup>");
}
function safeInteger(value) {
  if (!/^-?\d+$/.test(value)) throw new Error(`expected integer, got ${value}`);
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(`integer is out of range: ${value}`);
  return result;
}
if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
