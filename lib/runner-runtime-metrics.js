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

// lib/runner-v2/runtime-metrics-cli.ts
var runtime_metrics_cli_exports = {};
__export(runtime_metrics_cli_exports, {
  runRuntimeMetricsCli: () => runRuntimeMetricsCli
});
module.exports = __toCommonJS(runtime_metrics_cli_exports);

// lib/runner-v2/runtime-metrics.ts
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

// lib/runner-v2/runtime-metrics.ts
function runtimeProfilerPath(profilesDir, session) {
  return (0, import_node_path.join)(requireDirectory(profilesDir, "profiles directory"), `${safeSegment(session, "session")}.json`);
}
function performanceMetricsPath(metricsDir, runId) {
  return (0, import_node_path.join)(requireDirectory(metricsDir, "metrics directory"), safeSegment(runId, "run id"), "performance.json");
}
function startRuntimeProfile(input) {
  const path = runtimeProfilerPath(input.profilesDir, input.session);
  const profile = {
    session: input.session,
    agent_id: input.agentId,
    agent_name: input.agentName || input.agentId,
    run_id: input.runId || "",
    started_at: input.at || nowIso(),
    start_epoch: input.epoch ?? epochNs(),
    status: "running",
    snapshots: [],
    api_calls: [],
    tokens: { total_input: 0, total_output: 0, total: 0, by_model: {} },
    memory_samples: [],
    peak_memory_mb: 0,
    cpu_samples: [],
    avg_cpu_pct: 0
  };
  writeJsonAtomic(path, profile);
  return path;
}
function snapshotRuntimeProfile(input) {
  const path = runtimeProfilerPath(input.profilesDir, input.session);
  return mutateJson(path, parseProfile, (profile) => {
    const memoryMb = finite(input.memoryMb, 0);
    const cpuPct = finite(input.cpuPct, 0);
    const snapshots = [...profile.snapshots, { label: input.label || "snapshot", timestamp: input.at || nowIso(), epoch: input.epoch ?? epochNs(), memory_mb: memoryMb, cpu_pct: cpuPct }];
    const memorySamples = [...profile.memory_samples, memoryMb];
    const cpuSamples = [...profile.cpu_samples, cpuPct];
    return {
      ...profile,
      snapshots,
      memory_samples: memorySamples,
      cpu_samples: cpuSamples,
      peak_memory_mb: Math.max(profile.peak_memory_mb, memoryMb),
      avg_cpu_pct: cpuSamples.reduce((total, value) => total + value, 0) / cpuSamples.length
    };
  });
}
function recordRuntimeProfileTokens(input) {
  const path = runtimeProfilerPath(input.profilesDir, input.session);
  return mutateJson(path, parseProfile, (profile) => {
    const inputTokens = integer(input.inputTokens, 0);
    const outputTokens = integer(input.outputTokens, 0);
    const total = inputTokens + outputTokens;
    const previous = profile.tokens.by_model[input.model] || { input: 0, output: 0, total: 0 };
    return {
      ...profile,
      api_calls: [...profile.api_calls, { model: input.model, timestamp: input.at || nowIso(), input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: total, duration_ms: integer(input.durationMs, 0) }],
      tokens: {
        total_input: profile.tokens.total_input + inputTokens,
        total_output: profile.tokens.total_output + outputTokens,
        total: profile.tokens.total + total,
        by_model: { ...profile.tokens.by_model, [input.model]: { input: previous.input + inputTokens, output: previous.output + outputTokens, total: previous.total + total } }
      }
    };
  });
}
function endRuntimeProfile(input) {
  const path = runtimeProfilerPath(input.profilesDir, input.session);
  return mutateJson(path, parseProfile, (profile) => {
    const endEpoch = input.epoch ?? epochNs();
    return {
      ...profile,
      status: input.status || "complete",
      ended_at: input.at || nowIso(),
      end_epoch: endEpoch,
      duration_ms: endEpoch - profile.start_epoch,
      ...input.error ? { error: input.error } : {},
      final_snapshot: { timestamp: input.at || nowIso(), memory_mb: profile.peak_memory_mb, cpu_pct: profile.avg_cpu_pct }
    };
  });
}
function readRuntimeProfile(profilesDir, session) {
  return parseProfile(readJson(runtimeProfilerPath(profilesDir, session)));
}
function formatRuntimeProfileFile(profilesDir, profilePath) {
  const directory = requireDirectory(profilesDir, "profiles directory");
  const expected = runtimeProfilerPath(directory, (0, import_node_path.basename)(profilePath, ".json"));
  if (profilePath !== expected) throw new Error("profile path is outside profiles directory");
  return formatRuntimeProfile(parseProfile(readJson(expected)));
}
function listRuntimeProfiles(profilesDir, runId) {
  const dir = requireDirectory(profilesDir, "profiles directory");
  if (!(0, import_node_fs.existsSync)(dir)) return [];
  return (0, import_node_fs.readdirSync)(dir, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "export.json").flatMap((entry) => {
    try {
      const profile = parseProfile(readJson((0, import_node_path.join)(dir, entry.name)));
      return !runId || profile.run_id === runId ? [profile] : [];
    } catch {
      return [];
    }
  });
}
function exportRuntimeProfiles(profilesDir, outputPath) {
  const target = outputPath || (0, import_node_path.join)(requireDirectory(profilesDir, "profiles directory"), "export.json");
  writeJsonAtomic(target, { profiles: listRuntimeProfiles(profilesDir) });
  return target;
}
function cleanupRuntimeProfiles(profilesDir, days) {
  return cleanupChildren(requireDirectory(profilesDir, "profiles directory"), days, (entry) => entry.isFile() && entry.name.endsWith(".json"));
}
function pricePerMillion(model, type = "input") {
  const prices = {
    "claude-opus-4-6": [15, 75],
    "claude-sonnet-4-6": [3, 15],
    "claude-haiku-4-5": [0.8, 4],
    "gpt-4o": [2.5, 10],
    "gpt-4o-mini": [0.15, 0.6],
    "o3-mini": [1.1, 11]
  };
  return (prices[model] || [3, 15])[type === "output" ? 1 : 0];
}
function startPerformanceAgent(input) {
  const path = performanceMetricsPath(input.metricsDir, input.runId);
  return mutatePerformance(path, (record2) => ({
    ...record2,
    run_id: input.runId,
    started: record2.started || input.at || nowIso(),
    agents: { ...record2.agents, [input.agentId]: { id: input.agentId, name: input.agentName || input.agentId, session: input.session, started: input.at || nowIso(), start_ms: input.startMs ?? epochNs(), status: "running", api_calls: [], total_calls: 0, total_tokens: 0, total_cost_usd: 0, duration_ms: 0 } }
  }));
}
function recordPerformanceApiCall(input) {
  const path = performanceMetricsPath(input.metricsDir, input.runId);
  if (!(0, import_node_fs.existsSync)(path)) return void 0;
  return mutatePerformance(path, (record2) => {
    const agent = requireAgent(record2, input.agentId);
    const inputTokens = integer(input.inputTokens, 0);
    const outputTokens = integer(input.outputTokens, 0);
    const total = inputTokens + outputTokens;
    const cost = Number((inputTokens / 1e6 * pricePerMillion(input.model, "input") + outputTokens / 1e6 * pricePerMillion(input.model, "output")).toFixed(6));
    const calls = array(agent.api_calls);
    return { ...record2, agents: { ...record2.agents, [input.agentId]: { ...agent, api_calls: [...calls, { model: input.model, timestamp: input.at || nowIso(), input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: total, cost_usd: cost, duration_ms: integer(input.durationMs, 0) }], total_calls: integer(agent.total_calls, 0) + 1, total_tokens: integer(agent.total_tokens, 0) + total, total_cost_usd: finite(agent.total_cost_usd, 0) + cost } } };
  });
}
function endPerformanceAgent(input) {
  const path = performanceMetricsPath(input.metricsDir, input.runId);
  if (!(0, import_node_fs.existsSync)(path)) return void 0;
  return mutatePerformance(path, (record2) => {
    const agent = requireAgent(record2, input.agentId);
    const endMs = input.endMs ?? epochNs();
    const next = { ...agent, status: input.status || "complete", end_ms: endMs, duration_ms: endMs - integer(agent.start_ms, endMs) };
    return { ...record2, agents: { ...record2.agents, [input.agentId]: next }, summary: summarizeAgents({ ...record2.agents, [input.agentId]: next }) };
  });
}
function performanceAgentSession(metricsDir, runId, agentId) {
  const path = performanceMetricsPath(metricsDir, runId);
  if (!(0, import_node_fs.existsSync)(path)) return void 0;
  const agent = parsePerformance(readJson(path)).agents[agentId];
  return typeof agent?.session === "string" && agent.session ? agent.session : void 0;
}
function recordPerformanceResource(input) {
  const path = performanceMetricsPath(input.metricsDir, input.runId);
  if (!(0, import_node_fs.existsSync)(path)) return void 0;
  return mutatePerformance(path, (record2) => {
    const agent = requireAgent(record2, input.agentId);
    return { ...record2, agents: { ...record2.agents, [input.agentId]: { ...agent, resource_samples: [...array(agent.resource_samples), { timestamp: input.at || nowIso(), cpu_pct: finite(input.cpuPct, 0), mem_pct: finite(input.memPct, 0), elapsed: input.elapsed }] } } };
  });
}
function readPerformanceRecord(metricsDir, runId) {
  return parsePerformance(readJson(performanceMetricsPath(metricsDir, runId)));
}
function listPerformanceRuns(metricsDir) {
  const dir = requireDirectory(metricsDir, "metrics directory");
  if (!(0, import_node_fs.existsSync)(dir)) return [];
  return (0, import_node_fs.readdirSync)(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name.startsWith("run-")).flatMap((entry) => {
    try {
      return [{ runId: entry.name, record: readPerformanceRecord(dir, entry.name) }];
    } catch {
      return [];
    }
  });
}
function cleanupPerformanceRuns(metricsDir, days) {
  return cleanupChildren(requireDirectory(metricsDir, "metrics directory"), days, (entry) => entry.isDirectory() && entry.name.startsWith("run-"));
}
function formatRuntimeProfile(profile) {
  return `
  profile: ${profile.session}
  agent:   ${profile.agent_name}
  status:  ${profile.status}
  ---
  duration:    ${Math.floor(integer(profile.duration_ms, 0) / 1e9)}s
  api calls:   ${profile.api_calls.length}
  tokens:      ${profile.tokens.total}
  peak memory: ${profile.peak_memory_mb}MB
  avg cpu:     ${profile.avg_cpu_pct}%
`;
}
function formatPerformanceRecord(record2) {
  const rows = Object.entries(record2.agents).map(([id, agent]) => `    ${String(agent.name || id)}:
      id:        ${String(agent.id || id)}
      status:    ${String(agent.status || "")}
      calls:     ${integer(agent.total_calls, 0)}
      tokens:    ${integer(agent.total_tokens, 0)}
      cost:      $${finite(agent.total_cost_usd, 0)}
      duration:  ${integer(agent.duration_ms, 0) / 1e9}s`).join("\n");
  return `
  performance report:
  ---

  summary:
    api calls:     ${record2.summary.total_calls}
    tokens:        ${record2.summary.total_tokens}
    cost:          $${record2.summary.total_cost_usd.toFixed(4)}
    duration:      ${Math.floor(record2.summary.total_duration_ms / 1e9)}s

  agents:
${rows}
`;
}
function formatPerformanceRecordFile(metricsDir, path) {
  const directory = requireDirectory(metricsDir, "metrics directory");
  const runId = (0, import_node_path.basename)((0, import_node_path.dirname)(path));
  if (path !== performanceMetricsPath(directory, runId)) throw new Error("performance record path is outside the metrics directory");
  return formatPerformanceRecord(readPerformanceRecord(directory, runId));
}
function mutatePerformance(path, change) {
  return mutateJson(path, parsePerformance, change, true);
}
function mutateJson(path, parse, change, selfHeal = false) {
  return withExclusiveFileClaim(`${path}.lock`, () => {
    let current;
    try {
      current = (0, import_node_fs.existsSync)(path) ? parse(readJson(path)) : selfHeal ? parsePerformance({}) : (() => {
        throw new Error(`runtime metrics record not found: ${path}`);
      })();
    } catch (error) {
      if (!selfHeal) throw error;
      current = parsePerformance({});
    }
    const next = change(current);
    writeJsonAtomicUnlocked(path, next);
    return next;
  }, { waitTimeoutMs: 5e3 });
}
function writeJsonAtomic(path, value) {
  withExclusiveFileClaim(`${path}.lock`, () => writeJsonAtomicUnlocked(path, value), { waitTimeoutMs: 5e3 });
}
function writeJsonAtomicUnlocked(path, value) {
  (0, import_node_fs.mkdirSync)((0, import_node_path.dirname)(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
  (0, import_node_fs.writeFileSync)(temp, `${JSON.stringify(value, null, 2)}
`, { mode: 384 });
  (0, import_node_fs.renameSync)(temp, path);
}
function readJson(path) {
  return JSON.parse((0, import_node_fs.readFileSync)(path, "utf8"));
}
function parseProfile(value) {
  const v = record(value);
  if (!v || typeof v.session !== "string" || typeof v.agent_id !== "string") throw new Error("invalid runtime profiler record");
  const tokens = record(v.tokens) || {};
  return { ...v, session: v.session, agent_id: v.agent_id, agent_name: string(v.agent_name, v.agent_id), run_id: string(v.run_id, ""), started_at: string(v.started_at, ""), start_epoch: integer(v.start_epoch, 0), status: string(v.status, "running"), snapshots: array(v.snapshots), api_calls: array(v.api_calls), tokens: { total_input: integer(tokens.total_input, 0), total_output: integer(tokens.total_output, 0), total: integer(tokens.total, 0), by_model: record(tokens.by_model) || {} }, memory_samples: array(v.memory_samples).map((item) => finite(item, 0)), peak_memory_mb: finite(v.peak_memory_mb, 0), cpu_samples: array(v.cpu_samples).map((item) => finite(item, 0)), avg_cpu_pct: finite(v.avg_cpu_pct, 0) };
}
function parsePerformance(value) {
  const v = record(value) || {};
  const summary = record(v.summary) || {};
  return { ...v, run_id: string(v.run_id, ""), started: string(v.started, ""), agents: record(v.agents) || {}, summary: { total_calls: integer(summary.total_calls ?? summary.total_api_calls, 0), total_tokens: integer(summary.total_tokens, 0), total_cost_usd: finite(summary.total_cost_usd, 0), total_duration_ms: integer(summary.total_duration_ms, 0) } };
}
function summarizeAgents(agents) {
  const values = Object.values(agents);
  return { total_calls: values.reduce((total, agent) => total + integer(agent.total_calls, 0), 0), total_tokens: values.reduce((total, agent) => total + integer(agent.total_tokens, 0), 0), total_cost_usd: values.reduce((total, agent) => total + finite(agent.total_cost_usd, 0), 0), total_duration_ms: values.reduce((total, agent) => total + integer(agent.duration_ms, 0), 0) };
}
function requireAgent(record2, agentId) {
  const agent = record2.agents[agentId];
  if (!agent) throw new Error(`performance agent not found: ${agentId}`);
  return agent;
}
function cleanupChildren(dir, days, include) {
  if (!(0, import_node_fs.existsSync)(dir)) return 0;
  const cutoff = Date.now() - Math.max(0, days) * 864e5;
  let removed = 0;
  for (const entry of (0, import_node_fs.readdirSync)(dir, { withFileTypes: true })) {
    if (!include(entry)) continue;
    const path = (0, import_node_path.join)(dir, entry.name);
    if ((0, import_node_fs.statSync)(path).mtimeMs < cutoff) {
      (0, import_node_fs.rmSync)(path, { recursive: entry.isDirectory(), force: true });
      removed += 1;
    }
  }
  return removed;
}
function requireDirectory(path, label) {
  if (!path || !path.startsWith("/")) throw new Error(`${label} must be absolute`);
  return path;
}
function safeSegment(value, label) {
  if (!value || value.includes("/") || value.includes("\\") || value === "." || value === "..") throw new Error(`${label} is invalid`);
  return value;
}
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function epochNs() {
  return Date.now() * 1e6;
}
function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
function array(value) {
  return Array.isArray(value) ? value.filter((item) => Boolean(record(item))) : [];
}
function integer(value, fallback) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}
function finite(value, fallback) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function string(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

// lib/runner-v2/runtime-metrics-cli.ts
function runRuntimeMetricsCli(argv, env = process.env, write = console.log) {
  const [scope, command, ...args] = argv;
  const profilesDir = env.PROFILES_DIR || joinRoot(env, "profiles");
  const metricsDir = env.METRICS_DIR || joinRoot(env, "metrics");
  if (scope === "profile") {
    if (command === "start") return write(startRuntimeProfile({ profilesDir, session: required(args, 0), agentId: required(args, 1), agentName: args[2], runId: args[3] }));
    if (command === "snapshot") return write(JSON.stringify(snapshotRuntimeProfile({ profilesDir, session: required(args, 0), label: args[1], at: args[2], epoch: number(args[3]), memoryMb: number(args[4]), cpuPct: number(args[5]) })));
    if (command === "tokens") return write(JSON.stringify(recordRuntimeProfileTokens({ profilesDir, session: required(args, 0), model: required(args, 1), inputTokens: number(args[2]), outputTokens: number(args[3]), durationMs: number(args[4]) })));
    if (command === "end") {
      const session = required(args, 0);
      endRuntimeProfile({ profilesDir, session, status: args[1], error: args[2] });
      return write(runtimeProfilerPath(profilesDir, session));
    }
    if (command === "get") {
      const profile = readRuntimeProfile(profilesDir, required(args, 0));
      return write(args[1] === "text" ? formatRuntimeProfile(profile) : JSON.stringify(profile));
    }
    if (command === "format-file") return write(formatRuntimeProfileFile(profilesDir, required(args, 0)));
    if (command === "list") {
      const profiles = listRuntimeProfiles(profilesDir);
      return write(args[0] === "json" ? JSON.stringify(profiles) : formatProfileList(profiles, args[0]));
    }
    if (command === "compare") return write(formatProfileCompare(args.map((session) => readRuntimeProfile(profilesDir, session))));
    if (command === "aggregate") return write(formatProfileAggregate(listRuntimeProfiles(profilesDir, args[0])));
    if (command === "export") return write(exportRuntimeProfiles(profilesDir, args[0]));
    if (command === "cleanup") {
      const days = number(args[0]) ?? 30;
      cleanupRuntimeProfiles(profilesDir, days);
      return write(`  cleaned profiles older than ${days} days`);
    }
  }
  if (scope === "performance") {
    if (command === "price") return write(String(pricePerMillion(required(args, 0), args[1] === "output" ? "output" : "input")));
    if (command === "start") return write(JSON.stringify(startPerformanceAgent({ metricsDir, runId: required(args, 0), agentId: required(args, 1), session: required(args, 2), agentName: args[3] })));
    if (command === "record") return write(JSON.stringify(recordPerformanceApiCall({ metricsDir, runId: required(args, 0), agentId: required(args, 1), model: required(args, 2), inputTokens: number(args[3]), outputTokens: number(args[4]), durationMs: number(args[5]) }) || {}));
    if (command === "end") return write(JSON.stringify(endPerformanceAgent({ metricsDir, runId: required(args, 0), agentId: required(args, 1), status: args[2] }) || {}));
    if (command === "session") return write(performanceAgentSession(metricsDir, required(args, 0), required(args, 1)) || "");
    if (command === "resource") return write(JSON.stringify(recordPerformanceResource({ metricsDir, runId: required(args, 0), agentId: required(args, 1), cpuPct: number(args[2]) || 0, memPct: number(args[3]) || 0, elapsed: args[4] || "" }) || {}));
    if (command === "report") {
      const record2 = readPerformanceRecord(metricsDir, required(args, 0));
      return write(args[1] === "text" ? formatPerformanceRecord(record2) : JSON.stringify(record2));
    }
    if (command === "format-file") return write(formatPerformanceRecordFile(metricsDir, required(args, 0)));
    if (command === "list") return listPerformanceRuns(metricsDir).forEach(({ runId, record: record2 }) => write(`${runId} ${JSON.stringify({ id: record2.run_id, cost: record2.summary.total_cost_usd, tokens: record2.summary.total_tokens, agents: Object.keys(record2.agents).length })}`));
    if (command === "cleanup") {
      const days = number(args[0]) ?? 30;
      cleanupPerformanceRuns(metricsDir, days);
      return write(`  cleaned performance data older than ${days} days`);
    }
  }
  throw new Error("usage: runner-runtime-metrics <profile|performance> <command> ...");
}
function required(values, index) {
  const value = values[index];
  if (!value) throw new Error("required argument missing");
  return value;
}
function number(value) {
  if (value === void 0 || value === "") return void 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`invalid number: ${value}`);
  return parsed;
}
function joinRoot(env, child) {
  const root = env.MENTIKO_PROJECT_ROOT || env.MENTIKO_NAMESPACE_ROOT || env.HOME && `${env.HOME}/.mentiko/namespaces/${env.NAMESPACE_ID || "default"}`;
  if (!root) throw new Error("runtime root is required");
  return `${root}/${child}`;
}
function formatProfileList(profiles, format) {
  const lines = ["", "  profiles:", "  ---"];
  for (const p of profiles) {
    const seconds = Math.floor(Number(p.duration_ms || 0) / 1e9);
    if (format === "short" || !format) lines.push(`    ${p.session.padEnd(20)} ${p.agent_name.padEnd(15)} ${p.status.padEnd(10)} ${String(seconds).padStart(4)}s ${String(p.tokens.total).padStart(5)} tokens`);
    else lines.push(`    ${p.session}
      agent:     ${p.agent_name}
      status:    ${p.status}
      duration:  ${seconds}s
      tokens:    ${p.tokens.total}
`);
  }
  return lines.join("\n");
}
function formatProfileCompare(profiles) {
  return ["", "  comparison:", "  ---", "    session              status         duration     tokens    mem(mb)     cpu(%)", "    ----------------------------------------------------------------------", ...profiles.map((p) => `    ${p.session.padEnd(20)} ${p.status.padEnd(12)} ${`${Number(p.duration_ms || 0) / 1e9}s`.padStart(10)} ${String(p.tokens.total).padStart(10)} ${String(p.peak_memory_mb).padStart(10)} ${`${p.avg_cpu_pct}%`.padStart(10)}`), ""].join("\n");
}
function formatProfileAggregate(profiles) {
  const duration = profiles.reduce((sum, p) => sum + Number(p.duration_ms || 0), 0);
  const tokens = profiles.reduce((sum, p) => sum + p.tokens.total, 0);
  const calls = profiles.reduce((sum, p) => sum + p.api_calls.length, 0);
  const count = profiles.length;
  return ["", "  aggregate stats:", "  ---", `  sessions:     ${count}`, `  total time:   ${Math.floor(duration / 1e9)}s`, `  total tokens: ${tokens}`, `  total calls:  ${calls}`, ...count ? [`  avg time:     ${Math.floor(duration / count / 1e9)}s`, `  avg tokens:   ${Math.floor(tokens / count)}`] : [], ""].join("\n");
}
if (require.main === module) {
  try {
    runRuntimeMetricsCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runRuntimeMetricsCli
});
