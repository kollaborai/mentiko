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

// lib/runner-v2/schedule-contract-cli.ts
var schedule_contract_cli_exports = {};
__export(schedule_contract_cli_exports, {
  runScheduleContractCli: () => runScheduleContractCli
});
module.exports = __toCommonJS(schedule_contract_cli_exports);
var import_node_fs3 = require("node:fs");
var import_node_path2 = require("node:path");

// lib/runner-v2/schedule-contract.ts
var import_node_fs2 = require("node:fs");
var import_node_path = require("node:path");

// lib/runner-v2/chain-contract.ts
var import_node_fs = require("node:fs");
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
function decodeRawChainDefinition(chainPath) {
  return asRecord(readJson(chainPath), "chain");
}

// lib/schedules/cron-next-run.ts
var import_child_process = require("child_process");

// lib/schedules/cron-validation.ts
var SAFE_CRON_RE = /^[A-Za-z0-9*,/\-?#LW\s]+$/;
function normalizeCronExpression(value) {
  if (typeof value !== "string") {
    throw new Error("cron expression must be a string");
  }
  const cron = value.trim().replace(/\s+/g, " ");
  if (!cron) throw new Error("cron expression required");
  if (cron.length > 200) throw new Error("cron expression is too long");
  if (cron.includes("\0") || cron.includes("\n") || cron.includes("\r")) {
    throw new Error("cron expression contains invalid characters");
  }
  if (!SAFE_CRON_RE.test(cron)) {
    throw new Error("cron expression contains invalid characters");
  }
  const parts = cron.split(/\s+/);
  if (parts.length < 5 || parts.length > 6) {
    throw new Error("cron expression must have 5 or 6 fields");
  }
  return cron;
}

// lib/schedules/cron-next-run.ts
var CRONITER_SCRIPT = `
from datetime import datetime
from croniter import croniter
import sys

cron_expr = sys.argv[1]
if len(sys.argv) > 2:
    base = datetime.fromtimestamp(int(sys.argv[2]) / 1000)
else:
    base = datetime.now()

iterator = croniter(cron_expr, base)
print(iterator.get_next(datetime).isoformat())
`;
function calculateCronNextRun(cron, { afterMs, timeoutMs = 2e3 } = {}) {
  const safeCron = normalizeCronExpression(cron);
  const args = ["-c", CRONITER_SCRIPT, safeCron];
  if (afterMs !== void 0) {
    if (!Number.isFinite(afterMs) || afterMs < 0) return null;
    args.push(String(Math.floor(afterMs)));
  }
  try {
    const result = (0, import_child_process.execFileSync)("python3", args, {
      encoding: "utf-8",
      timeout: timeoutMs,
      shell: false
    });
    return result.trim() || null;
  } catch {
    return null;
  }
}

// lib/runner-v2/schedule-contract.ts
var SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
function asRecord2(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}
function assertDirectory(path, label) {
  const entry = (0, import_node_fs2.lstatSync)(path);
  if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error(`${label} must be a non-symlink directory: ${path}`);
}
function assertRegularFile(path, label) {
  const entry = (0, import_node_fs2.lstatSync)(path);
  if (entry.isSymbolicLink() || !entry.isFile()) throw new Error(`${label} must be a non-symlink regular file: ${path}`);
}
function containedChainFile(root, candidate) {
  const resolvedRoot = (0, import_node_path.resolve)(root);
  const resolvedCandidate = (0, import_node_path.resolve)(candidate);
  assertDirectory(resolvedRoot, "Configured chains directory");
  if (!resolvedCandidate.startsWith(`${resolvedRoot}${import_node_path.sep}`)) throw new Error(`Chain path escapes configured chains directory: ${candidate}`);
  assertRegularFile(resolvedCandidate, "Chain definition");
  return resolvedCandidate;
}
function safeScheduleId(scheduleId) {
  if (!SAFE_ID.test(scheduleId)) throw new Error(`Schedule id is not safe: ${scheduleId}`);
  return scheduleId;
}
function validateSchedulesDir(schedulesDir) {
  const resolved = (0, import_node_path.resolve)(schedulesDir);
  if (!resolved || resolved === import_node_path.sep) throw new Error("Schedules directory must be a concrete path");
  if (!(0, import_node_fs2.existsSync)(resolved)) (0, import_node_fs2.mkdirSync)(resolved, { recursive: true, mode: 448 });
  assertDirectory(resolved, "Schedules directory");
  return resolved;
}
function scheduleIdForChain(chainPath, chainDir) {
  const safeChainPath = containedChainFile(chainDir, chainPath);
  const path = (0, import_node_path.relative)((0, import_node_path.resolve)(chainDir), safeChainPath).split(import_node_path.sep).join("_");
  if (!path || path === (0, import_node_path.basename)(safeChainPath) && (0, import_node_path.dirname)(safeChainPath) === (0, import_node_path.resolve)(chainDir)) return safeScheduleId(path || (0, import_node_path.basename)(safeChainPath));
  return safeScheduleId(path);
}
function decodeEmbeddedSchedule(chainPath, chainDir) {
  const safeChainPath = containedChainFile(chainDir, chainPath);
  (0, import_node_fs2.readFileSync)(safeChainPath, "utf8");
  const raw = decodeRawChainDefinition(safeChainPath);
  const config = raw.config === void 0 ? {} : asRecord2(raw.config, "chain.config");
  const schedule = config.schedule;
  if (schedule === void 0 || schedule === null || schedule === "") return null;
  let cron = "";
  let timezone = typeof config.timezone === "string" && config.timezone ? config.timezone : "UTC";
  if (typeof schedule === "string") {
    cron = schedule;
  } else {
    const nested = asRecord2(schedule, "chain.config.schedule");
    if (typeof nested.cron !== "string" || !nested.cron.trim()) throw new Error("chain.config.schedule.cron must be a non-empty string");
    cron = nested.cron;
    if (nested.timezone !== void 0) {
      if (typeof nested.timezone !== "string" || !nested.timezone.trim()) throw new Error("chain.config.schedule.timezone must be a non-empty string");
      timezone = nested.timezone;
    }
  }
  if (!cron.trim()) return null;
  return {
    chainPath: safeChainPath,
    chainName: typeof raw.name === "string" ? raw.name : "",
    scheduleId: scheduleIdForChain(safeChainPath, chainDir),
    cron,
    timezone
  };
}
function validateCron(cron) {
  const partCount = cron.trim() ? cron.trim().split(/\s+/).length : 0;
  return partCount === 5 || partCount === 6 ? null : "must have 5 or 6 space-separated parts";
}
function calculateNextRunSeconds(cron, afterSeconds = Math.floor(Date.now() / 1e3)) {
  if (validateCron(cron)) return 0;
  const next = calculateCronNextRun(cron, { afterMs: afterSeconds * 1e3 });
  const millis = next ? Date.parse(next) : Number.NaN;
  return Number.isFinite(millis) ? Math.floor(millis / 1e3) : 0;
}
function statePath(schedulesDir) {
  return (0, import_node_path.join)(validateSchedulesDir(schedulesDir), "state.json");
}
function statusPath(schedulesDir, scheduleId) {
  return (0, import_node_path.join)(validateSchedulesDir(schedulesDir), `${safeScheduleId(scheduleId)}.status`);
}
function lockPath(schedulesDir, scheduleId) {
  return (0, import_node_path.join)(validateSchedulesDir(schedulesDir), `${safeScheduleId(scheduleId)}.lock`);
}
function pidPath(schedulesDir, scheduleId) {
  return (0, import_node_path.join)(validateSchedulesDir(schedulesDir), `${safeScheduleId(scheduleId)}.pid`);
}
function historyPath(schedulesDir, scheduleId) {
  return (0, import_node_path.join)(validateSchedulesDir(schedulesDir), `${safeScheduleId(scheduleId)}.history`);
}
function readRawScheduleState(schedulesDir) {
  const path = statePath(schedulesDir);
  if (!(0, import_node_fs2.existsSync)(path)) return {};
  assertRegularFile(path, "Schedule state");
  let parsed;
  try {
    parsed = JSON.parse((0, import_node_fs2.readFileSync)(path, "utf8"));
  } catch {
    throw new Error(`Schedule state is not valid JSON: ${path}`);
  }
  return parsed;
}
function normalizeScheduleState(parsed) {
  const record = asRecord2(parsed, "schedule state");
  const normalized = {};
  for (const [id, value] of Object.entries(record)) {
    safeScheduleId(id);
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`Schedule state ${id} must be a non-negative integer`);
    normalized[id] = value;
  }
  return normalized;
}
function readState(schedulesDir) {
  return normalizeScheduleState(readRawScheduleState(schedulesDir));
}
function writeAtomic(path, content) {
  (0, import_node_fs2.mkdirSync)((0, import_node_path.dirname)(path), { recursive: true });
  assertDirectory((0, import_node_path.dirname)(path), "Schedule record parent");
  if ((0, import_node_fs2.existsSync)(path)) assertRegularFile(path, "Schedule record");
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
  (0, import_node_fs2.writeFileSync)(temp, content, { mode: 384 });
  (0, import_node_fs2.renameSync)(temp, path);
}
function withStateLock(schedulesDir, operation) {
  const directory = validateSchedulesDir(schedulesDir);
  (0, import_node_fs2.mkdirSync)(directory, { recursive: true });
  const lock = (0, import_node_path.join)(directory, ".state.lock");
  const deadline = Date.now() + 5e3;
  while (true) {
    try {
      (0, import_node_fs2.mkdirSync)(lock, { mode: 448 });
      break;
    } catch (error) {
      if (error.code !== "EEXIST" || Date.now() >= deadline) throw new Error(`Unable to acquire schedule state lock: ${lock}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try {
    return operation();
  } finally {
    (0, import_node_fs2.rmdirSync)(lock);
  }
}
function getScheduleState(schedulesDir, scheduleId) {
  return readState(schedulesDir)[safeScheduleId(scheduleId)] || 0;
}
function initializeScheduleState(schedulesDir) {
  withStateLock(schedulesDir, () => {
    const path = statePath(schedulesDir);
    if ((0, import_node_fs2.existsSync)(path)) assertRegularFile(path, "Schedule state");
    else writeAtomic(path, "{}\n");
  });
}
function setScheduleState(schedulesDir, scheduleId, timestamp) {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error("Schedule timestamp must be a non-negative integer");
  withStateLock(schedulesDir, () => {
    const state = readState(schedulesDir);
    state[safeScheduleId(scheduleId)] = timestamp;
    writeAtomic(statePath(schedulesDir), `${JSON.stringify(state, null, 2)}
`);
  });
}
function scheduleEnabled(schedulesDir, schedule) {
  const path = statusPath(schedulesDir, schedule.scheduleId);
  if (!(0, import_node_fs2.existsSync)(path)) return true;
  assertRegularFile(path, "Schedule status");
  const content = (0, import_node_fs2.readFileSync)(path, "utf8").trim();
  if (content === "enabled: true") return true;
  if (content === "enabled: false") return false;
  throw new Error(`Schedule status is invalid: ${path}`);
}
function setScheduleEnabled(schedulesDir, scheduleId, enabled) {
  writeAtomic(statusPath(schedulesDir, scheduleId), `enabled: ${enabled ? "true" : "false"}
`);
}
function scheduleRunning(schedulesDir, scheduleId, nowSeconds = Math.floor(Date.now() / 1e3)) {
  const lock = lockPath(schedulesDir, scheduleId);
  if (!(0, import_node_fs2.existsSync)(lock)) return false;
  assertRegularFile(lock, "Schedule lock");
  const started = Number((0, import_node_fs2.readFileSync)(lock, "utf8").trim());
  if (!Number.isSafeInteger(started) || nowSeconds - started >= 7200) {
    (0, import_node_fs2.unlinkSync)(lock);
    return false;
  }
  const pidFile = pidPath(schedulesDir, scheduleId);
  if ((0, import_node_fs2.existsSync)(pidFile)) assertRegularFile(pidFile, "Schedule pid");
  const pid = Number((0, import_node_fs2.existsSync)(pidFile) ? (0, import_node_fs2.readFileSync)(pidFile, "utf8").trim() : "");
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function scheduleDue(schedulesDir, schedule, nowSeconds = Math.floor(Date.now() / 1e3)) {
  if (!scheduleEnabled(schedulesDir, schedule) || scheduleRunning(schedulesDir, schedule.scheduleId, nowSeconds)) return false;
  const lastRun = getScheduleState(schedulesDir, schedule.scheduleId);
  const next = calculateNextRunSeconds(schedule.cron, lastRun);
  return next > lastRun && next <= nowSeconds;
}
function markScheduleRunStart(schedulesDir, scheduleId, pid, nowSeconds = Math.floor(Date.now() / 1e3)) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(nowSeconds) || nowSeconds < 0) throw new Error("Schedule lock inputs are invalid");
  writeAtomic(lockPath(schedulesDir, scheduleId), `${nowSeconds}
`);
  writeAtomic(pidPath(schedulesDir, scheduleId), `${pid}
`);
}
function markScheduleRunEnd(schedulesDir, scheduleId, status, timestamp = Math.floor(Date.now() / 1e3)) {
  if (!/^[A-Za-z0-9_.-]+$/.test(status)) throw new Error("Schedule status is not safe");
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error("Schedule timestamp must be a non-negative integer");
  withStateLock(schedulesDir, () => {
    const state = readState(schedulesDir);
    state[safeScheduleId(scheduleId)] = timestamp;
    writeAtomic(statePath(schedulesDir), `${JSON.stringify(state, null, 2)}
`);
    const lock = lockPath(schedulesDir, scheduleId);
    const pid = pidPath(schedulesDir, scheduleId);
    const history = historyPath(schedulesDir, scheduleId);
    if ((0, import_node_fs2.existsSync)(lock)) assertRegularFile(lock, "Schedule lock");
    if ((0, import_node_fs2.existsSync)(pid)) assertRegularFile(pid, "Schedule pid");
    if ((0, import_node_fs2.existsSync)(history)) assertRegularFile(history, "Schedule history");
    if ((0, import_node_fs2.existsSync)(lock)) (0, import_node_fs2.unlinkSync)(lock);
    if ((0, import_node_fs2.existsSync)(pid)) (0, import_node_fs2.unlinkSync)(pid);
    (0, import_node_fs2.appendFileSync)(history, `[${new Date(timestamp * 1e3).toISOString()}] ${status}
`, { mode: 384 });
  });
}

// lib/runner-v2/schedule-contract-cli.ts
function runScheduleContractCli(argv, write = (line) => console.log(line)) {
  const [command, ...rest] = argv;
  if (!isCommand(command)) throw new Error(usage());
  const values = parseValues(rest);
  switch (command) {
    case "field": {
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--chain-path", "--chain-dir", "--field"]));
      const schedule = decodeEmbeddedSchedule(required(values, "--chain-path"), required(values, "--chain-dir"));
      const field = required(values, "--field");
      if (!["cron", "timezone", "id", "name"].includes(field)) throw new Error("--field must be cron, timezone, id, or name");
      write(!schedule ? "" : field === "id" ? schedule.scheduleId : field === "name" ? schedule.chainName : field === "cron" ? schedule.cron : schedule.timezone);
      return;
    }
    case "validate-cron": {
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--cron"]));
      const cron = values.get("--cron");
      if (cron === void 0) throw new Error("--cron is required");
      const reason = validateCron(cron);
      if (reason) {
        write(`invalid: ${reason}`);
        throw new Error(`invalid: ${reason}`);
      }
      write("valid");
      return;
    }
    case "next": {
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--cron", "--after"]));
      write(String(calculateNextRunSeconds(required(values, "--cron"), integer(values, "--after", Math.floor(Date.now() / 1e3)))));
      return;
    }
    case "state-init":
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--schedules-dir"]));
      initializeScheduleState(required(values, "--schedules-dir"));
      return;
    case "state-get":
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--schedules-dir", "--schedule-id"]));
      write(String(getScheduleState(required(values, "--schedules-dir"), required(values, "--schedule-id"))));
      return;
    case "state-set":
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--schedules-dir", "--schedule-id", "--timestamp"]));
      setScheduleState(required(values, "--schedules-dir"), required(values, "--schedule-id"), integer(values, "--timestamp", Math.floor(Date.now() / 1e3)));
      return;
    case "enabled": {
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--chain-path", "--chain-dir", "--schedules-dir"]));
      const schedule = decodeEmbeddedSchedule(required(values, "--chain-path"), required(values, "--chain-dir"));
      write(schedule && scheduleEnabled(required(values, "--schedules-dir"), schedule) ? "true" : "false");
      return;
    }
    case "set-enabled": {
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--chain-path", "--chain-dir", "--schedules-dir", "--enabled"]));
      const schedule = decodeEmbeddedSchedule(required(values, "--chain-path"), required(values, "--chain-dir"));
      if (!schedule) throw new Error("Chain has no embedded schedule");
      const enabled = required(values, "--enabled");
      if (enabled !== "true" && enabled !== "false") throw new Error("--enabled must be true or false");
      setScheduleEnabled(required(values, "--schedules-dir"), schedule.scheduleId, enabled === "true");
      return;
    }
    case "running":
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--schedules-dir", "--schedule-id", "--now"]));
      write(scheduleRunning(required(values, "--schedules-dir"), required(values, "--schedule-id"), integer(values, "--now", Math.floor(Date.now() / 1e3))) ? "true" : "false");
      return;
    case "due": {
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--chain-path", "--chain-dir", "--schedules-dir", "--now"]));
      const schedule = decodeEmbeddedSchedule(required(values, "--chain-path"), required(values, "--chain-dir"));
      write(schedule && scheduleDue(required(values, "--schedules-dir"), schedule, integer(values, "--now", Math.floor(Date.now() / 1e3))) ? "true" : "false");
      return;
    }
    case "mark-start": {
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--chain-path", "--chain-dir", "--schedules-dir", "--pid", "--timestamp"]));
      const schedule = requireSchedule(values);
      markScheduleRunStart(required(values, "--schedules-dir"), schedule.scheduleId, integer(values, "--pid"), integer(values, "--timestamp", Math.floor(Date.now() / 1e3)));
      return;
    }
    case "mark-end": {
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--chain-path", "--chain-dir", "--schedules-dir", "--status", "--timestamp"]));
      const schedule = requireSchedule(values);
      markScheduleRunEnd(required(values, "--schedules-dir"), schedule.scheduleId, required(values, "--status"), integer(values, "--timestamp", Math.floor(Date.now() / 1e3)));
      return;
    }
    case "list": {
      rejectUnexpected(values, /* @__PURE__ */ new Set(["--chain-dir", "--schedules-dir"]));
      write("scheduled chains:");
      write("");
      for (const chainPath of findChainFiles(required(values, "--chain-dir"))) {
        const schedule = decodeEmbeddedSchedule(chainPath, required(values, "--chain-dir"));
        if (!schedule) continue;
        const lastRun = getScheduleState(required(values, "--schedules-dir"), schedule.scheduleId);
        const next = calculateNextRunSeconds(schedule.cron);
        write(`  ${schedule.chainName}`);
        write(`    schedule: ${schedule.cron}`);
        write(`    status:   ${scheduleEnabled(required(values, "--schedules-dir"), schedule) ? "enabled" : "disabled"}`);
        write(`    last:     ${lastRun ? new Date(lastRun * 1e3).toISOString() : "never"}`);
        write(`    next:     ${next ? new Date(next * 1e3).toISOString() : "unknown"}`);
        write("");
      }
      return;
    }
  }
}
function requireSchedule(values) {
  const schedule = decodeEmbeddedSchedule(required(values, "--chain-path"), required(values, "--chain-dir"));
  if (!schedule) throw new Error("Chain has no embedded schedule");
  return schedule;
}
function findChainFiles(dir) {
  const output = [];
  for (const entry of (0, import_node_fs3.readdirSync)(dir, { withFileTypes: true })) {
    const path = (0, import_node_path2.join)(dir, entry.name);
    if (entry.isDirectory()) output.push(...findChainFiles(path));
    else if (entry.isFile() && entry.name === "chain.json") output.push(path);
  }
  return output;
}
function parseValues(argv) {
  const values = /* @__PURE__ */ new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
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
function integer(values, key, fallback) {
  const value = values.get(key);
  if (value === void 0 && fallback !== void 0) return fallback;
  if (value === void 0 || !/^\d+$/.test(value)) throw new Error(`${key} must be a non-negative integer`);
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(`${key} must be a safe integer`);
  return result;
}
function rejectUnexpected(values, allowed) {
  for (const key of values.keys()) if (!allowed.has(key)) throw new Error(`${key} is not valid for runner-schedule-contract`);
}
function isCommand(value) {
  return ["field", "validate-cron", "next", "state-init", "state-get", "state-set", "enabled", "set-enabled", "running", "due", "mark-start", "mark-end", "list"].includes(value || "");
}
function usage() {
  return "usage: runner-schedule-contract <field|validate-cron|next|state-init|state-get|state-set|enabled|set-enabled|running|due|mark-start|mark-end|list> [options]";
}
if (require.main === module) {
  try {
    runScheduleContractCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runScheduleContractCli
});
