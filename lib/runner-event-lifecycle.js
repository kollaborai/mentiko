#!/usr/bin/env node
"use strict";

// lib/runner-v2/event-lifecycle-cli.ts
var import_node_path2 = require("node:path");

// lib/runner-v2/event-lifecycle.ts
var import_node_crypto = require("node:crypto");
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
var CLAIM_NAME = ".event-lifecycle.claim";
var CLAIM_WAIT_TIMEOUT_MS = 5e3;
var PORTABLE_NAME_MAX_BYTES = 255;
var ARCHIVE_RECEIPT_KEYS = [
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
var ARCHIVE_RECEIPT_NAME = /^\.event-receipt-[a-f0-9]{64}-[a-f0-9]{64}-[a-f0-9]{64}\.json$/;
function scanRunnerEventFiles(eventsDir, options = {}) {
  const root = requireEventsDir(eventsDir);
  const entries = (0, import_node_fs.readdirSync)(root, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".event")).sort((left, right) => compareFileNames(left.name, right.name));
  const valid = [];
  const invalid = [];
  for (const entry of entries) {
    const path = (0, import_node_path.join)(root, entry.name);
    let content;
    try {
      content = options.readFile?.(path) ?? (0, import_node_fs.readFileSync)(path, "utf8");
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
function markRunnerEventProcessed(input) {
  const root = requireEventsDir(input.eventsDir);
  return withExclusiveFileClaim((0, import_node_path.join)(root, CLAIM_NAME), () => {
    const path = resolveDirectEventPath(root, input.file, true);
    return markRunnerEventProcessedUnlocked(path);
  }, { waitTimeoutMs: CLAIM_WAIT_TIMEOUT_MS });
}
function captureRunnerEventAcceptedTrigger(input) {
  const root = requireEventsDir(input.eventsDir);
  const path = resolveDirectEventPath(root, input.file, true);
  const before = eventFileIdentity(path);
  const content = (0, import_node_fs.readFileSync)(path, "utf8");
  const event = strictEventAtPath(path, content);
  const after = eventFileIdentity(path);
  if (stableSerialize(before) !== stableSerialize(after)) {
    throw new Error(`Event file changed while capturing accepted trigger: ${path}`);
  }
  if (input.expected && normalizedEventDigest(input.expected) !== normalizedEventDigest(event)) {
    throw new Error(`Event file no longer matches the accepted normalized trigger: ${path}`);
  }
  if (event.processed) {
    throw new Error(`Accepted trigger must still be active and unprocessed: ${path}`);
  }
  return acceptedTriggerForSnapshot(path, content, event, after);
}
function consumeRunnerEvents(input) {
  requireNonEmpty("runId", input.runId);
  requireNonEmpty("source", input.source);
  requireNonEmpty("triggered", input.triggered);
  if (input.expectedEvent !== void 0) requireNonEmpty("expectedEvent", input.expectedEvent);
  const root = requireEventsDir(input.eventsDir);
  const allAgentIds = normalizeAgentIds(input.allAgentIds);
  return withExclusiveFileClaim((0, import_node_path.join)(root, CLAIM_NAME), () => {
    const triggeredPath = resolveDirectEventPath(root, input.triggered, false);
    assertAcceptedTriggerShape(input.acceptedTrigger, (0, import_node_path.basename)(triggeredPath));
    if ((0, import_node_fs.existsSync)(triggeredPath)) {
      const observed = captureRunnerEventAcceptedTrigger({
        eventsDir: root,
        file: triggeredPath
      });
      if (stableSerialize(observed) !== stableSerialize(input.acceptedTrigger)) {
        throw new Error(`Active event no longer matches the accepted trigger occurrence: ${triggeredPath}`);
      }
      assertExplicitTriggerMatches(
        strictEventAtPath(triggeredPath, (0, import_node_fs.readFileSync)(triggeredPath, "utf8")),
        input,
        allAgentIds,
        triggeredPath
      );
    } else {
      const triggered2 = proveAlreadyArchived(root, triggeredPath, input, allAgentIds);
      return {
        triggered: triggered2,
        archived: [],
        invalid: scanRunnerEventFiles(root).invalid
      };
    }
    const scan = scanRunnerEventFiles(root);
    const archived = [];
    for (const candidate of scan.valid) {
      if (candidate.path === triggeredPath) continue;
      if (!eventIsStrictlyOwned(candidate.event, {
        runId: input.runId,
        source: input.source,
        sessionName: input.sessionName,
        allAgentIds
      })) {
        continue;
      }
      const acceptedSibling = captureRunnerEventAcceptedTrigger({
        eventsDir: root,
        file: candidate.path,
        expected: candidate.event
      });
      archived.push(processAndArchiveUnlocked(
        root,
        candidate.path,
        "owned-sibling",
        void 0,
        acceptedSibling
      ));
    }
    const triggered = processAndArchiveUnlocked(root, triggeredPath, "trigger", (event) => {
      assertExplicitTriggerMatches(event, input, allAgentIds, triggeredPath);
    }, input.acceptedTrigger);
    return { triggered, archived, invalid: scan.invalid };
  }, { waitTimeoutMs: CLAIM_WAIT_TIMEOUT_MS });
}
function eventIsStrictlyOwned(event, owner) {
  if (!owner.runId || event.runId !== owner.runId) return false;
  const allAgentIds = normalizeAgentIds(owner.allAgentIds);
  return [event.source, event.fields.agent].filter((candidate) => Boolean(candidate)).some((candidate) => runnerEventIdentityMatches(
    candidate,
    owner.source,
    owner.sessionName,
    allAgentIds
  ));
}
function markRunnerEventProcessedUnlocked(path) {
  const prepared = prepareRunnerEventForProcessing(path);
  if (!prepared.changed) {
    return {
      filename: (0, import_node_path.basename)(path),
      path,
      status: "already-processed",
      event: prepared.event
    };
  }
  const temporaryPath = (0, import_node_path.join)(
    (0, import_node_path.dirname)(path),
    `.event-mark-${process.pid}-${(0, import_node_crypto.randomUUID)()}.tmp`
  );
  try {
    (0, import_node_fs.writeFileSync)(temporaryPath, prepared.processed, {
      encoding: "utf8",
      flag: "wx",
      mode: prepared.mode
    });
    (0, import_node_fs.renameSync)(temporaryPath, path);
  } finally {
    try {
      (0, import_node_fs.unlinkSync)(temporaryPath);
    } catch {
    }
  }
  return {
    filename: (0, import_node_path.basename)(path),
    path,
    status: "marked",
    event: { ...prepared.event, path }
  };
}
function processAndArchiveUnlocked(root, path, receiptRole, validate, acceptedTrigger) {
  const observedTrigger = captureRunnerEventAcceptedTrigger({
    eventsDir: root,
    file: path
  });
  if (acceptedTrigger && stableSerialize(observedTrigger) !== stableSerialize(acceptedTrigger)) {
    throw new Error(`Active event no longer matches the accepted trigger occurrence: ${path}`);
  }
  const prepared = prepareRunnerEventForProcessing(path);
  validate?.(prepared.event);
  const archiveDir = ensureArchiveDir(root);
  const requestedDestination = (0, import_node_path.join)(archiveDir, (0, import_node_path.basename)(path));
  const destination = claimArchiveDestination(
    requestedDestination,
    prepared.processed,
    prepared.mode
  );
  claimArchiveReceipt(
    archiveDir,
    receiptRole,
    (0, import_node_path.basename)(path),
    prepared.event.runId,
    (0, import_node_path.basename)(destination.path),
    acceptedTrigger || observedTrigger,
    prepared.processed
  );
  unlinkArchivedSource(path, prepared.original);
  return {
    filename: (0, import_node_path.basename)(path),
    path,
    destination: destination.path,
    status: destination.status,
    event: { ...prepared.event, path: destination.path }
  };
}
function prepareRunnerEventForProcessing(path) {
  const original = (0, import_node_fs.readFileSync)(path, "utf8");
  const parsed = strictEventAtPath(path, original);
  const mode = (0, import_node_fs.statSync)(path).mode & 511;
  if (parsed.processed) {
    return {
      original,
      processed: original,
      event: parsed,
      changed: false,
      mode
    };
  }
  const processed = original.replace(
    /^(processed:[\t ]*)false([\t ]*)$/m,
    "$1true$2"
  );
  if (processed === original) {
    throw new Error(`Strict event processed field could not be updated: ${path}`);
  }
  const event = strictEventAtPath(path, processed);
  if (!event.processed) {
    throw new Error(`Processed mutation did not validate as true: ${path}`);
  }
  return { original, processed, event, changed: true, mode };
}
function claimArchiveDestination(requestedDestination, content, mode) {
  const stagedPath = (0, import_node_path.join)(
    (0, import_node_path.dirname)(requestedDestination),
    `.event-archive-stage-${process.pid}-${(0, import_node_crypto.randomUUID)()}.tmp`
  );
  try {
    (0, import_node_fs.writeFileSync)(stagedPath, content, { encoding: "utf8", flag: "wx", mode });
    const requested = tryArchiveDestination(requestedDestination, stagedPath, content);
    if (requested) return requested;
    const parsed = (0, import_node_path.parse)(requestedDestination);
    const digest = (0, import_node_crypto.createHash)("sha256").update(content).digest("hex");
    const collisionDestination = (0, import_node_path.join)(
      parsed.dir,
      collisionArchiveFilename(parsed.base, digest)
    );
    const collision = tryArchiveDestination(collisionDestination, stagedPath, content);
    if (collision) {
      return {
        path: collision.path,
        status: collision.status === "already-archived" ? collision.status : "collision-archived"
      };
    }
    for (; ; ) {
      const unique = (0, import_node_path.join)(
        parsed.dir,
        collisionArchiveFilename(parsed.base, digest, (0, import_node_crypto.randomUUID)())
      );
      const result = tryArchiveDestination(unique, stagedPath, content);
      if (result) return { path: result.path, status: "collision-archived" };
    }
  } finally {
    try {
      (0, import_node_fs.unlinkSync)(stagedPath);
    } catch {
    }
  }
}
function tryArchiveDestination(destination, stagedPath, content) {
  try {
    (0, import_node_fs.linkSync)(stagedPath, destination);
  } catch (error) {
    if (!isAlreadyExists2(error)) throw error;
    if (!isRegularFile(destination)) {
      throw new Error(`Archive destination is not a direct regular file: ${destination}`);
    }
    if ((0, import_node_fs.readFileSync)(destination, "utf8") !== content) return void 0;
    return { path: destination, status: "already-archived" };
  }
  return { path: destination, status: "archived" };
}
function unlinkArchivedSource(sourcePath, expectedContent) {
  if (!isRegularFile(sourcePath)) {
    throw new Error(`Archived event source is not a direct regular file: ${sourcePath}`);
  }
  if ((0, import_node_fs.readFileSync)(sourcePath, "utf8") !== expectedContent) {
    throw new Error(`Archived event source changed before unlink: ${sourcePath}`);
  }
  (0, import_node_fs.unlinkSync)(sourcePath);
}
function claimArchiveReceipt(archiveDir, role, sourceFilename, runId, destinationFilename, acceptedTrigger, content) {
  const archivedContentSha256 = (0, import_node_crypto.createHash)("sha256").update(content).digest("hex");
  const receiptPath = archiveReceiptPath(
    archiveDir,
    sourceFilename,
    runId,
    acceptedTrigger.occurrenceToken,
    acceptedTrigger.rawContentSha256
  );
  if (isRegularFile(receiptPath)) {
    const existing = readArchiveReceiptProof(archiveDir, receiptPath);
    if (existing.receipt.role !== role || existing.receipt.destinationFilename !== destinationFilename || existing.receipt.acceptedRecordSha256 !== acceptedTrigger.normalizedRecordSha256 || existing.receipt.archivedContentSha256 !== archivedContentSha256) {
      throw new Error(`Archive receipt conflicts with claimed event: ${receiptPath}`);
    }
    return;
  }
  const occurrence = archiveReceiptPathsForIdentity(archiveDir, sourceFilename, runId).map((path) => readArchiveReceipt(archiveDir, path).occurrence).reduce((maximum, value) => Math.max(maximum, value), 0) + 1;
  const receipt = {
    version: 2,
    role,
    occurrence,
    sourceFilename,
    runId,
    destinationFilename,
    occurrenceToken: acceptedTrigger.occurrenceToken,
    acceptedContentSha256: acceptedTrigger.rawContentSha256,
    acceptedRecordSha256: acceptedTrigger.normalizedRecordSha256,
    archivedContentSha256
  };
  const receiptContent = `${JSON.stringify(receipt)}
`;
  const stagedPath = (0, import_node_path.join)(
    archiveDir,
    `.event-receipt-stage-${process.pid}-${(0, import_node_crypto.randomUUID)()}.tmp`
  );
  try {
    (0, import_node_fs.writeFileSync)(stagedPath, receiptContent, { encoding: "utf8", flag: "wx", mode: 384 });
    try {
      (0, import_node_fs.linkSync)(stagedPath, receiptPath);
    } catch (error) {
      if (!isAlreadyExists2(error)) throw error;
      if (!isRegularFile(receiptPath)) {
        throw new Error(`Archive receipt is not a direct regular file: ${receiptPath}`);
      }
      if ((0, import_node_fs.readFileSync)(receiptPath, "utf8") !== receiptContent) {
        throw new Error(`Archive receipt conflicts with claimed event: ${receiptPath}`);
      }
    }
  } finally {
    try {
      (0, import_node_fs.unlinkSync)(stagedPath);
    } catch {
    }
  }
}
function proveAlreadyArchived(root, sourcePath, input, allAgentIds) {
  const configuredArchiveDir = (0, import_node_path.join)(root, "archive");
  if (!(0, import_node_fs.existsSync)(configuredArchiveDir)) {
    throw new Error(`Triggered event file not found and no archive receipt exists: ${sourcePath}`);
  }
  const archiveDir = requireArchiveDir(root);
  const sourceFilename = (0, import_node_path.basename)(sourcePath);
  const receiptPath = archiveReceiptPath(
    archiveDir,
    sourceFilename,
    input.runId,
    input.acceptedTrigger.occurrenceToken,
    input.acceptedTrigger.rawContentSha256
  );
  if (!isRegularFile(receiptPath)) {
    throw new Error(`Triggered event file not found and no archive receipt exists: ${sourcePath}`);
  }
  const proof = readArchiveReceiptProof(archiveDir, receiptPath);
  if (proof.receipt.role !== "trigger" || proof.receipt.occurrenceToken !== input.acceptedTrigger.occurrenceToken || proof.receipt.acceptedContentSha256 !== input.acceptedTrigger.rawContentSha256 || proof.receipt.acceptedRecordSha256 !== input.acceptedTrigger.normalizedRecordSha256 || !explicitTriggerMatches(proof.event, input, allAgentIds)) {
    throw new Error(`Archive receipts do not prove the requested trigger identity: ${sourcePath}`);
  }
  return {
    filename: sourceFilename,
    path: sourcePath,
    destination: proof.destination,
    status: "already-archived",
    event: { ...proof.event, path: proof.destination }
  };
}
function readArchiveReceiptProof(archiveDir, receiptPath) {
  const receipt = readArchiveReceipt(archiveDir, receiptPath);
  const destination = (0, import_node_path.join)(archiveDir, receipt.destinationFilename);
  if (!isRegularFile(destination)) {
    throw new Error(`Archive receipt destination is missing: ${destination}`);
  }
  const content = (0, import_node_fs.readFileSync)(destination, "utf8");
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
  return { receipt, destination, content, event };
}
function readArchiveReceipt(archiveDir, receiptPath) {
  if (!isRegularFile(receiptPath)) {
    throw new Error(`Archive receipt is not a direct regular file: ${receiptPath}`);
  }
  const receipt = parseArchiveReceipt(receiptPath, (0, import_node_fs.readFileSync)(receiptPath, "utf8"));
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
  return (0, import_node_path.join)(
    archiveDir,
    `.event-receipt-${identityDigest}-${occurrenceToken}-${acceptedContentSha256}.json`
  );
}
function archiveReceiptPathsForIdentity(archiveDir, sourceFilename, runId) {
  const prefix = `.event-receipt-${archiveReceiptIdentityDigest(sourceFilename, runId)}-`;
  return (0, import_node_fs.readdirSync)(archiveDir, { withFileTypes: true }).filter((entry) => entry.name.startsWith(prefix) && ARCHIVE_RECEIPT_NAME.test(entry.name)).map((entry) => {
    const path = (0, import_node_path.join)(archiveDir, entry.name);
    if (!entry.isFile()) {
      throw new Error(`Archive receipt is not a direct regular file: ${path}`);
    }
    return path;
  }).sort(compareFileNames);
}
function parseArchiveReceipt(path, content) {
  let value;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error(`Archive receipt is not valid JSON: ${path}`);
  }
  const keys = typeof value === "object" && value !== null && !Array.isArray(value) ? Object.keys(value) : [];
  if (typeof value !== "object" || value === null || Array.isArray(value) || keys.length !== ARCHIVE_RECEIPT_KEYS.length || ARCHIVE_RECEIPT_KEYS.some((key) => !keys.includes(key)) || value.version !== 2 || value.role !== "trigger" && value.role !== "owned-sibling" || !Number.isSafeInteger(value.occurrence) || typeof value.sourceFilename !== "string" || typeof value.runId !== "string" || typeof value.destinationFilename !== "string" || typeof value.occurrenceToken !== "string" || typeof value.acceptedContentSha256 !== "string" || typeof value.acceptedRecordSha256 !== "string" || typeof value.archivedContentSha256 !== "string") {
    throw new Error(`Archive receipt has an invalid shape: ${path}`);
  }
  const receipt = value;
  if (!isDirectEventFilename(receipt.sourceFilename) || receipt.occurrence < 1 || !receipt.runId.trim() || !isDirectEventFilename(receipt.destinationFilename) || !/^[a-f0-9]{64}$/.test(receipt.occurrenceToken) || !/^[a-f0-9]{64}$/.test(receipt.acceptedContentSha256) || !/^[a-f0-9]{64}$/.test(receipt.acceptedRecordSha256) || !/^[a-f0-9]{64}$/.test(receipt.archivedContentSha256)) {
    throw new Error(`Archive receipt has invalid field values: ${path}`);
  }
  if (content !== `${JSON.stringify(receipt)}
`) {
    throw new Error(`Archive receipt is not in canonical single-field form: ${path}`);
  }
  return receipt;
}
function collisionArchiveFilename(requestedFilename, contentDigest, uniqueSuffix) {
  const parsed = (0, import_node_path.parse)(requestedFilename);
  const suffix = uniqueSuffix ? `-${uniqueSuffix}` : "";
  const preferred = `${parsed.name}-collision-${contentDigest.slice(0, 16)}${suffix}${parsed.ext}`;
  if (Buffer.byteLength(preferred, "utf8") <= PORTABLE_NAME_MAX_BYTES) return preferred;
  return `event-collision-${contentDigest}${suffix}.event`;
}
function isDirectEventFilename(value) {
  return Boolean(value) && (0, import_node_path.basename)(value) === value && value.endsWith(".event");
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
  const stat = (0, import_node_fs.lstatSync)(path, { bigint: true });
  if (!stat.isFile()) {
    throw new Error(`Event file is not a direct regular file: ${path}`);
  }
  return {
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
    birthtimeNs: stat.birthtimeNs.toString()
  };
}
function acceptedTriggerForSnapshot(path, content, event, identity) {
  return {
    version: 1,
    sourceFilename: (0, import_node_path.basename)(path),
    occurrenceToken: (0, import_node_crypto.createHash)("sha256").update(stableSerialize({ sourceFilename: (0, import_node_path.basename)(path), identity })).digest("hex"),
    rawContentSha256: (0, import_node_crypto.createHash)("sha256").update(content).digest("hex"),
    normalizedRecordSha256: normalizedEventDigest(event)
  };
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
function assertAcceptedTriggerShape(value, expectedFilename) {
  const keys = value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).sort() : [];
  const expectedKeys = [
    "normalizedRecordSha256",
    "occurrenceToken",
    "rawContentSha256",
    "sourceFilename",
    "version"
  ];
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index]) || value.version !== 1 || value.sourceFilename !== expectedFilename || !isDirectEventFilename(value.sourceFilename) || !/^[a-f0-9]{64}$/.test(value.occurrenceToken) || !/^[a-f0-9]{64}$/.test(value.rawContentSha256) || !/^[a-f0-9]{64}$/.test(value.normalizedRecordSha256)) {
    throw new Error(`Accepted trigger fingerprint is invalid for ${expectedFilename}`);
  }
}
function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
function requireEventsDir(eventsDir) {
  requireNonEmpty("eventsDir", eventsDir);
  if (!(0, import_node_path.isAbsolute)(eventsDir)) {
    throw new Error(`eventsDir must be an absolute configured path: ${eventsDir}`);
  }
  const root = (0, import_node_path.resolve)(eventsDir);
  if (!isRegularDirectory(root)) {
    throw new Error(`Configured eventsDir is not a directory: ${root}`);
  }
  return root;
}
function ensureArchiveDir(root) {
  const archiveDir = (0, import_node_path.join)(root, "archive");
  if ((0, import_node_fs.existsSync)(archiveDir)) {
    if (!isRegularDirectory(archiveDir)) {
      throw new Error(`Event archive is not a direct regular directory: ${archiveDir}`);
    }
    return archiveDir;
  }
  (0, import_node_fs.mkdirSync)(archiveDir);
  return archiveDir;
}
function requireArchiveDir(root) {
  const archiveDir = (0, import_node_path.join)(root, "archive");
  if (!isRegularDirectory(archiveDir)) {
    throw new Error(`Event archive is not a direct regular directory: ${archiveDir}`);
  }
  return archiveDir;
}
function resolveDirectEventPath(root, input, mustExist) {
  requireNonEmpty("event file", input);
  const path = (0, import_node_path.isAbsolute)(input) ? (0, import_node_path.resolve)(input) : (0, import_node_path.resolve)(root, input);
  if ((0, import_node_path.dirname)(path) !== root || !(0, import_node_path.basename)(path).endsWith(".event")) {
    throw new Error(`Event file must be a direct *.event child of configured root: ${input}`);
  }
  if (mustExist && !isRegularFile(path)) {
    throw new Error(`Event file is not a direct regular file: ${path}`);
  }
  if (!mustExist && (0, import_node_fs.existsSync)(path) && !isRegularFile(path)) {
    throw new Error(`Event file is not a direct regular file: ${path}`);
  }
  return path;
}
function completionEventMatches(event, input, allAgentIds) {
  if (event.runId !== input.runId) return false;
  if (input.expectedEvent !== void 0 && event.event !== input.expectedEvent) return false;
  if (DIAGNOSTIC_SOURCES.has(normalizeIdentity2(event.source))) return false;
  return runnerEventIdentityMatches(event.source, input.agentId, input.sessionName, allAgentIds);
}
function explicitTriggerMatches(event, input, allAgentIds) {
  return event.runId === input.runId && (input.expectedEvent === void 0 || event.event === input.expectedEvent) && runnerEventIdentityMatches(event.source, input.source, input.sessionName, allAgentIds);
}
function assertExplicitTriggerMatches(event, input, allAgentIds, path) {
  if (event.runId !== input.runId) {
    throw new Error(`Explicit trigger run id does not match requested run: ${path}`);
  }
  if (input.expectedEvent !== void 0 && event.event !== input.expectedEvent) {
    throw new Error(`Explicit trigger event does not match expected event: ${path}`);
  }
  if (!runnerEventIdentityMatches(event.source, input.source, input.sessionName, allAgentIds)) {
    throw new Error(`Explicit trigger owner does not match requested source: ${path}`);
  }
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
    return (0, import_node_fs.lstatSync)(path).isDirectory();
  } catch {
    return false;
  }
}
function isRegularFile(path) {
  try {
    return (0, import_node_fs.lstatSync)(path).isFile();
  } catch {
    return false;
  }
}
function isAlreadyExists2(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
function isMissingPath(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

// lib/runner-v2/event-lifecycle-cli.ts
function main() {
  const parsed = parseCli(process.argv.slice(2));
  const eventsDir = configuredEventsDir(parsed.values);
  const output = outputMode(single(parsed.values, "--output", false));
  if (parsed.command === "list") {
    rejectUnexpected(parsed, /* @__PURE__ */ new Set(["--events-dir", "--output"]));
    const scan = scanRunnerEventFiles(eventsDir);
    const valid = parsed.unprocessed ? scan.valid.filter(({ event }) => !event.processed) : scan.valid;
    if (output === "json") {
      printJson({ valid: valid.map(eventJson), invalid: scan.invalid.map(invalidJson) });
    } else {
      for (const file of valid) {
        console.log(`${file.event.processed ? "x" : "o"} ${file.filename}	${file.event.event}	${file.event.source}	${file.event.timestamp}`);
      }
      for (const file of scan.invalid) {
        console.log(`! ${file.filename}	invalid	${file.issues.map((issue) => issue.code).join(",")}`);
      }
    }
    return;
  }
  if (parsed.unprocessed) throw new Error("--unprocessed is valid only for list.");
  if (parsed.command === "find") {
    rejectUnexpected(parsed, /* @__PURE__ */ new Set([
      "--events-dir",
      "--run-id",
      "--expected-event",
      "--agent-id",
      "--session-name",
      "--all-agent-id",
      "--output"
    ]));
    const result2 = findRunnerCompletionEvent({
      eventsDir,
      runId: requiredSingle(parsed.values, "--run-id"),
      expectedEvent: single(parsed.values, "--expected-event", false),
      agentId: requiredSingle(parsed.values, "--agent-id"),
      sessionName: single(parsed.values, "--session-name", false),
      allAgentIds: parsed.values.get("--all-agent-id")
    });
    if (!result2.match) {
      process.exitCode = 3;
      return;
    }
    if (output === "json") {
      printJson(eventJson(result2.match));
    } else {
      console.log(result2.match.path);
    }
    return;
  }
  if (parsed.command === "mark") {
    rejectUnexpected(parsed, /* @__PURE__ */ new Set(["--events-dir", "--file", "--output"]));
    const result2 = markRunnerEventProcessed({
      eventsDir,
      file: requiredSingle(parsed.values, "--file")
    });
    if (output === "json") printJson(result2);
    else console.log(`${result2.status}: ${result2.path}`);
    return;
  }
  rejectUnexpected(parsed, /* @__PURE__ */ new Set([
    "--events-dir",
    "--run-id",
    "--source",
    "--triggered",
    "--expected-event",
    "--session-name",
    "--all-agent-id",
    "--output"
  ]));
  const triggered = requiredSingle(parsed.values, "--triggered");
  const acceptedTrigger = captureRunnerEventAcceptedTrigger({
    eventsDir,
    file: triggered
  });
  const result = consumeRunnerEvents({
    eventsDir,
    runId: requiredSingle(parsed.values, "--run-id"),
    source: requiredSingle(parsed.values, "--source"),
    triggered,
    expectedEvent: single(parsed.values, "--expected-event", false),
    sessionName: single(parsed.values, "--session-name", false),
    allAgentIds: parsed.values.get("--all-agent-id"),
    acceptedTrigger
  });
  if (output === "json") {
    printJson({
      triggered: archiveJson(result.triggered),
      archived: result.archived.map(archiveJson),
      invalid: result.invalid.map(invalidJson)
    });
  } else {
    console.log(`${result.triggered.status}: ${result.triggered.destination}`);
    for (const archived of result.archived) {
      console.log(`${archived.status}: ${archived.destination}`);
    }
  }
}
function parseCli(argv) {
  const command = argv[0];
  if (command !== "list" && command !== "find" && command !== "mark" && command !== "consume") {
    throw new Error("usage: runner-event-lifecycle <list|find|mark|consume> [options]");
  }
  const values = /* @__PURE__ */ new Map();
  let unprocessed = false;
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--unprocessed") {
      if (unprocessed) throw new Error("Duplicate runner event lifecycle argument: --unprocessed");
      unprocessed = true;
      continue;
    }
    if (!flag.startsWith("--")) throw new Error(`Unexpected positional argument: ${flag}`);
    const value = argv[index + 1];
    if (value === void 0 || value.startsWith("--")) {
      throw new Error(`Missing value for runner event lifecycle argument: ${flag}`);
    }
    const prior = values.get(flag) || [];
    if (flag !== "--all-agent-id" && prior.length > 0) {
      throw new Error(`Duplicate runner event lifecycle argument: ${flag}`);
    }
    values.set(flag, [...prior, value]);
    index += 1;
  }
  return { command, values, unprocessed };
}
function configuredEventsDir(values) {
  const flagValue = single(values, "--events-dir", false)?.trim();
  const environmentValue = process.env.EVENTS_DIR?.trim();
  if (!flagValue && !environmentValue) {
    throw new Error("Configured event root required: pass --events-dir or set EVENTS_DIR.");
  }
  if (flagValue && environmentValue && (0, import_node_path2.resolve)(flagValue) !== (0, import_node_path2.resolve)(environmentValue)) {
    throw new Error("--events-dir and EVENTS_DIR resolve to different event roots.");
  }
  const value = flagValue || environmentValue;
  if (!(0, import_node_path2.isAbsolute)(value)) throw new Error("Configured event root must be absolute.");
  return (0, import_node_path2.resolve)(value);
}
function rejectUnexpected(parsed, allowed) {
  for (const flag of parsed.values.keys()) {
    if (!allowed.has(flag)) throw new Error(`${flag} is not valid for ${parsed.command}.`);
  }
}
function requiredSingle(values, flag) {
  const value = single(values, flag, true);
  if (!value) throw new Error(`Runner event lifecycle argument must not be empty: ${flag}`);
  return value;
}
function single(values, flag, required) {
  const found = values.get(flag);
  if (!found || found.length === 0) {
    if (required) throw new Error(`Missing required runner event lifecycle argument: ${flag}`);
    return void 0;
  }
  if (found.length !== 1) throw new Error(`Expected one value for runner event lifecycle argument: ${flag}`);
  return found[0];
}
function outputMode(value) {
  if (value === void 0 || value === "text") return "text";
  if (value === "json") return "json";
  throw new Error("Runner event lifecycle --output must be text or json.");
}
function eventJson(file) {
  return { path: file.path, filename: file.filename, event: file.event };
}
function invalidJson(file) {
  return { path: file.path, filename: file.filename, issues: file.issues };
}
function archiveJson(result) {
  return {
    path: result.path,
    filename: result.filename,
    destination: result.destination,
    status: result.status,
    event: result.event
  };
}
function printJson(value) {
  console.log(JSON.stringify(value));
}
try {
  main();
} catch (error) {
  console.error(`runner event lifecycle failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
