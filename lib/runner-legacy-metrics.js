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
    for (let key2 of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key2) && key2 !== except)
        __defProp(to, key2, { get: () => from[key2], enumerable: !(desc = __getOwnPropDesc(from, key2)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// lib/runner-v2/legacy-metrics-cli.ts
var legacy_metrics_cli_exports = {};
__export(legacy_metrics_cli_exports, {
  runLegacyMetricsCli: () => runLegacyMetricsCli
});
module.exports = __toCommonJS(legacy_metrics_cli_exports);

// lib/runner-v2/legacy-metrics.ts
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

// lib/runner-v2/legacy-metrics.ts
function metricPaths(metricsDir, options = {}) {
  if (!metricsDir || !(0, import_node_path.isAbsolute)(metricsDir)) throw new Error("Configured metrics directory must be absolute.");
  const dir = (0, import_node_path.resolve)(metricsDir);
  if ((0, import_node_fs.existsSync)(dir)) {
    if ((0, import_node_fs.lstatSync)(dir).isSymbolicLink()) throw new Error("Configured metrics directory must not be a symbolic link.");
  } else if (options.create) (0, import_node_fs.mkdirSync)(dir, { recursive: true, mode: 448 });
  return { counters: (0, import_node_path.join)(dir, "counters.json"), gauges: (0, import_node_path.join)(dir, "gauges.json"), timers: (0, import_node_path.join)(dir, "timers.json"), "active-timers": (0, import_node_path.join)(dir, "active-timers.json"), webhooks: (0, import_node_path.join)(dir, "webhooks.json") };
}
function incrementCounter(dir, name, delta = 1) {
  mutate(dir, "counters", numberMap, (state) => ({ ...state, [key(name)]: (state[key(name)] || 0) + number(delta) }));
}
function setGauge(dir, name, value) {
  mutate(dir, "gauges", numberMap, (state) => ({ ...state, [key(name)]: number(value) }));
}
function startMetricTimer(dir, name, startMs) {
  mutate(dir, "active-timers", numberMap, (state) => ({ ...state, [key(name)]: integer(startMs) }));
}
function endMetricTimer(dir, name, type, endMs) {
  const timer = key(name);
  const end = integer(endMs);
  let start;
  mutate(dir, "active-timers", numberMap, (state) => {
    start = state[timer];
    const { [timer]: _, ...rest } = state;
    return rest;
  });
  if (!start) return void 0;
  const duration = Math.max(0, end - start);
  const timerKey = `${key(type)}_${timer}`;
  mutate(dir, "timers", timers, (state) => {
    const prior = state[timerKey];
    const count = (prior?.count || 0) + 1;
    const total = (prior?.total_ms || 0) + duration;
    return { ...state, [timerKey]: { count, total_ms: total, avg_ms: Math.floor(total / count), min_ms: prior ? Math.min(prior.min_ms, duration) : duration, max_ms: prior ? Math.max(prior.max_ms, duration) : duration, type: key(type) } };
  });
  return duration;
}
function recordWebhookMetric(dir, event, status, responseMs = 0) {
  mutate(dir, "webhooks", webhooks, (state) => {
    const delivered = status === "delivered";
    const prior = state.by_event[key(event)] || { total: 0, delivered: 0, failed: 0, total_rt: 0 };
    return { total: state.total + 1, delivered: state.delivered + Number(delivered), failed: state.failed + Number(!delivered), by_event: { ...state.by_event, [key(event)]: { total: prior.total + 1, delivered: prior.delivered + Number(delivered), failed: prior.failed + Number(!delivered), total_rt: prior.total_rt + number(responseMs) } } };
  });
}
function resetLegacyMetrics(dir) {
  mutate(dir, "counters", numberMap, () => ({}));
  mutate(dir, "gauges", numberMap, () => ({}));
  mutate(dir, "timers", timers, () => ({}));
  mutate(dir, "webhooks", webhooks, () => ({ total: 0, delivered: 0, failed: 0, by_event: {} }));
}
function readLegacyMetrics(dir) {
  const paths = metricPaths(dir);
  return { generated: (/* @__PURE__ */ new Date()).toISOString(), counters: read(paths.counters, numberMap), gauges: read(paths.gauges, numberMap), timers: read(paths.timers, timers), webhooks: read(paths.webhooks, webhooks) };
}
function metricsJson(dir) {
  return JSON.stringify(readLegacyMetrics(dir));
}
function formatLegacyMetrics(dir) {
  const m = readLegacyMetrics(dir);
  return ["", "  mentiko metrics:", "  ---", "  counters:", ...Object.entries(m.counters).map(([k, v]) => `    ${k}: ${v}`), "", "  gauges:", ...Object.entries(m.gauges).map(([k, v]) => `    ${k}: ${v}`), "", "  timers (avg ms):", ...Object.entries(m.timers).map(([k, v]) => `    ${k}: ${v.avg_ms}ms (${v.count} calls)`), "", "  webhooks:", `    total: ${m.webhooks.total}`, `    delivered: ${m.webhooks.delivered}`, `    failed: ${m.webhooks.failed}`, ""].join("\n");
}
function prometheusMetrics(dir) {
  const paths = metricPaths(dir);
  const c = read(paths.counters, numberMap), g = read(paths.gauges, numberMap), t = read(paths.timers, timers), w = read(paths.webhooks, webhooks);
  const esc = (v) => v.replace(/\\|"|\n/g, "_");
  const lines = ["# mentiko metrics", `# generated ${(/* @__PURE__ */ new Date()).toISOString()}`, "", "# HELP mentiko_counter Counter metrics", "# TYPE mentiko_counter gauge", ...Object.entries(c).map(([k, v]) => `mentiko_counter{name="${esc(k)}"} ${v}`), "", "# HELP mentiko_gauge Gauge metrics", "# TYPE mentiko_gauge gauge", ...Object.entries(g).map(([k, v]) => `mentiko_gauge{name="${esc(k)}"} ${v}`), "", "# HELP mentiko_timer_ms Timer metrics in milliseconds", "# TYPE mentiko_timer_count gauge", ...Object.entries(t).flatMap(([k, v]) => [`mentiko_timer_count{name="${esc(k)}"} ${v.count}`, `mentiko_timer_avg_ms{name="${esc(k)}"} ${v.avg_ms}`, `mentiko_timer_max_ms{name="${esc(k)}"} ${v.max_ms}`]), "", `mentiko_webhook_total ${w.total}`, `mentiko_webhook_delivered ${w.delivered}`, `mentiko_webhook_failed ${w.failed}`, `mentiko_webhook_success_rate ${w.total ? (w.delivered / w.total * 100).toFixed(2) : 0}`, ...Object.entries(w.by_event).flatMap(([k, v]) => [`mentiko_webhook_by_event{event="${esc(k)}",status="delivered"} ${v.delivered}`, `mentiko_webhook_by_event{event="${esc(k)}",status="failed"} ${v.failed}`])];
  return lines.join("\n");
}
function validateRawLegacyMetric(content) {
  if (!content.trim()) return { valid: false, issue: "empty-file" };
  try {
    const value = JSON.parse(content);
    return record(value) ? { valid: true, value } : { valid: false, issue: "invalid-root" };
  } catch {
    return { valid: false, issue: "invalid-json" };
  }
}
function mutate(dir, kind, parse, update) {
  const path = metricPaths(dir, { create: true })[kind];
  assertSafe(path);
  assertSafe(`${path}.lock`);
  try {
    withExclusiveFileClaim(`${path}.lock`, () => write(path, update(read(path, parse))));
  } catch (error) {
    if (!(error instanceof ExclusiveFileClaimBusyError)) throw error;
  }
}
function read(path, parse) {
  if (!(0, import_node_fs.existsSync)(path)) return parse(initial(kindFrom(path)));
  assertSafe(path);
  const raw = validateRawLegacyMetric((0, import_node_fs.readFileSync)(path, "utf8"));
  if (!raw.valid || !raw.value) throw new Error(`Invalid raw metrics JSON (${raw.issue}): ${path}`);
  return parse(raw.value);
}
function write(path, value) {
  assertSafe(path);
  const temp = `${path}.${process.pid}.${(0, import_node_crypto.randomUUID)()}.tmp`;
  try {
    (0, import_node_fs.writeFileSync)(temp, `${JSON.stringify(value)}
`, { flag: "wx", mode: 384 });
    (0, import_node_fs.renameSync)(temp, path);
  } finally {
    if ((0, import_node_fs.existsSync)(temp)) (0, import_node_fs.rmSync)(temp, { force: true });
  }
}
function assertSafe(path) {
  if ((0, import_node_fs.existsSync)(path) && (0, import_node_fs.lstatSync)(path).isSymbolicLink()) throw new Error(`Metrics path must not be a symbolic link: ${path}`);
}
function initial(kind) {
  return kind === "webhooks" ? { total: 0, delivered: 0, failed: 0, by_event: {} } : {};
}
function kindFrom(path) {
  const name = path.split("/").pop()?.replace(".json", "");
  if (name === "active-timers") return name;
  if (name === "counters" || name === "gauges" || name === "timers" || name === "webhooks") return name;
  throw new Error("Unknown metrics record");
}
function numberMap(value) {
  if (!record(value)) throw new Error("Invalid normalized metrics number map");
  for (const [k, v] of Object.entries(value)) {
    key(k);
    number(v);
  }
  return value;
}
function timers(value) {
  if (!record(value)) throw new Error("Invalid normalized timer metrics");
  for (const [k, v] of Object.entries(value)) {
    key(k);
    if (!record(v) || typeof v.type !== "string") throw new Error("Invalid normalized timer metric");
    for (const f of ["count", "total_ms", "avg_ms", "min_ms", "max_ms"]) number(v[f]);
  }
  return value;
}
function webhooks(value) {
  if (!record(value) || !record(value.by_event)) throw new Error("Invalid normalized webhook metrics");
  for (const f of ["total", "delivered", "failed"]) number(value[f]);
  for (const [k, v] of Object.entries(value.by_event)) {
    key(k);
    if (!record(v)) throw new Error("Invalid normalized webhook event metric");
    for (const f of ["total", "delivered", "failed", "total_rt"]) number(v[f]);
  }
  return value;
}
function record(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function key(v) {
  if (!v?.trim() || v.length > 240) throw new Error("Metric key must be non-empty and at most 240 characters.");
  return v;
}
function number(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error("Metric value must be finite.");
  return v;
}
function integer(v) {
  const n = number(v);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("Metric time must be a non-negative safe integer.");
  return n;
}

// lib/runner-v2/legacy-metrics-cli.ts
function runLegacyMetricsCli(argv, env = process.env, write2 = console.log) {
  const [c, ...a] = argv, dir = env.METRICS_DIR;
  if (!dir) throw new Error("METRICS_DIR is required");
  const now = () => Date.now();
  if (c === "counter") return incrementCounter(dir, req(a, 0), num(a[1], 1));
  if (c === "gauge") return setGauge(dir, req(a, 0), num(a[1]));
  if (c === "start") return startMetricTimer(dir, req(a, 0), num(a[1], now()));
  if (c === "end") {
    const d = endMetricTimer(dir, req(a, 0), a[1] || "agent", num(a[2], now()));
    if (d === void 0) process.exitCode = 1;
    else write2(String(d));
    return;
  }
  if (c === "webhook") return recordWebhookMetric(dir, req(a, 0), req(a, 1), num(a[2], 0));
  if (c === "json") return write2(metricsJson(dir));
  if (c === "show") return write2(formatLegacyMetrics(dir));
  if (c === "prometheus") return write2(prometheusMetrics(dir));
  if (c === "reset") {
    resetLegacyMetrics(dir);
    write2("  metrics reset");
    return;
  }
  throw new Error("usage: runner-legacy-metrics <counter|gauge|start|end|webhook|json|show|prometheus|reset>");
}
function req(a, i) {
  if (!a[i]) throw new Error("required metrics argument missing");
  return a[i];
}
function num(v, d) {
  if (v === void 0 && d !== void 0) return d;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error("metric argument must be finite");
  return n;
}
if (require.main === module) {
  try {
    runLegacyMetricsCli(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runLegacyMetricsCli
});
