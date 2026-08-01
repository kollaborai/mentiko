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

// lib/runner-v2/agent-transcript-cli.ts
var agent_transcript_cli_exports = {};
__export(agent_transcript_cli_exports, {
  resolveTranscriptPath: () => resolveTranscriptPath,
  runRunnerAgentTranscriptCli: () => runRunnerAgentTranscriptCli
});
module.exports = __toCommonJS(agent_transcript_cli_exports);
var import_node_fs2 = require("node:fs");

// lib/runner-v2/agent-transcript.ts
var import_node_fs = require("node:fs");
var import_node_os = require("node:os");
var import_node_path = require("node:path");
var TRANSCRIPT_UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
var TRANSCRIPT_ATTEMPT_CLOCK_SKEW_MS = 5e3;
var TRANSCRIPT_FUTURE_TIMESTAMP_TOLERANCE_MS = 6e4;
function assistantTexts(record) {
  if (!record || typeof record !== "object") return [];
  const r = record;
  const out = [];
  if (r.type === "assistant" && r.message && typeof r.message === "object") {
    const content = r.message.content;
    if (Array.isArray(content)) {
      for (const item of content) {
        if (item && typeof item === "object" && item.type === "text") {
          const text = item.text;
          if (typeof text === "string") out.push(text);
        }
      }
    }
  }
  if ((r.type === "message" || r.type === "response_item") && r.role === "assistant") {
    let content = [];
    if (Array.isArray(r.content)) {
      content = r.content;
    } else if ((r.content === void 0 || r.content === null) && r.payload && typeof r.payload === "object" && Array.isArray(r.payload.content)) {
      content = r.payload.content;
    }
    for (const item of content) {
      if (item && typeof item === "object") {
        const text = item.text;
        if (typeof text === "string") out.push(text);
      }
    }
  }
  return out;
}
function transcriptRootFromProfile(profilePath) {
  if (!profilePath || !(0, import_node_fs.existsSync)(profilePath)) return "";
  try {
    const profile = JSON.parse((0, import_node_fs.readFileSync)(profilePath, "utf8"));
    if (typeof profile.log_path !== "string" || !profile.log_path.trim()) return "";
    return profile.log_path.trim().replace(/^~(?=\/|$)/, (0, import_node_os.homedir)()).replace(/\/$/, "");
  } catch {
    return "";
  }
}
function hasStandaloneAgentComplete(text) {
  return text.split(/\r?\n/).some((line) => line.trim() === "AGENT_COMPLETE");
}
function readAssistantTextsFromTranscript(jsonlPath) {
  let body;
  try {
    body = (0, import_node_fs.readFileSync)(jsonlPath, "utf8");
  } catch {
    return [];
  }
  const texts = [];
  for (const line of body.split("\n")) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    texts.push(...assistantTexts(record));
  }
  return texts;
}
function agentCompleteMarkerDurable(jsonlPath) {
  return readAssistantTextsFromTranscript(jsonlPath).some((text) => hasStandaloneAgentComplete(text));
}
function isWithinWorkspace(workspace, cwd) {
  const rel = (0, import_node_path.relative)(workspace, (0, import_node_path.resolve)(cwd));
  return rel === "" || !rel.startsWith(`..${import_node_path.sep}`) && rel !== ".." && !rel.startsWith(import_node_path.sep);
}
function containsIdentityToken(body, token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}(?=$|[^A-Za-z0-9_-])`).test(body);
}
function scoreTranscriptIdentity(path, uuid, identity) {
  let body = "";
  try {
    body = (0, import_node_fs.readFileSync)(path, "utf8");
  } catch {
    return null;
  }
  const cwds = /* @__PURE__ */ new Set();
  const sessionIds = /* @__PURE__ */ new Set();
  const runIds = /* @__PURE__ */ new Set();
  const timestamps = [];
  for (const line of body.split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (typeof record.cwd === "string") cwds.add(record.cwd);
      for (const key of ["sessionId", "session_id"]) {
        if (typeof record[key] === "string") sessionIds.add(record[key].toLowerCase());
      }
      for (const key of ["runId", "run_id"]) {
        if (typeof record[key] === "string") runIds.add(record[key]);
      }
      if (typeof record.timestamp === "string") {
        const value = Date.parse(record.timestamp);
        if (Number.isFinite(value)) timestamps.push(value);
      }
    } catch {
      continue;
    }
  }
  if (uuid && sessionIds.size > 0 && !sessionIds.has(uuid)) return null;
  const requestedSessionId = identity.sessionId?.toLowerCase();
  if (requestedSessionId && (sessionIds.size === 0 || !sessionIds.has(requestedSessionId))) return null;
  if (identity.runId && runIds.size > 0 && !runIds.has(identity.runId)) return null;
  let score = uuid && sessionIds.has(uuid) ? 40 : 0;
  if (requestedSessionId && sessionIds.has(requestedSessionId)) score += 60;
  if (identity.workspacePath) {
    const workspace = (0, import_node_path.resolve)(identity.workspacePath);
    const workspaceMatch = [...cwds].some((cwd) => isWithinWorkspace(workspace, cwd));
    if (!workspaceMatch) return null;
    score += 100;
  }
  if (identity.attemptStartedAt) {
    const started = Date.parse(identity.attemptStartedAt);
    const latest = timestamps.length ? Math.max(...timestamps) : Number.NaN;
    const now = (identity.now ?? /* @__PURE__ */ new Date()).getTime();
    if (!Number.isFinite(started) || !Number.isFinite(latest) || latest < started - TRANSCRIPT_ATTEMPT_CLOCK_SKEW_MS || latest > now + TRANSCRIPT_FUTURE_TIMESTAMP_TOLERANCE_MS) {
      return null;
    }
    score += 80;
  }
  const runMatch = Boolean(identity.runId && containsIdentityToken(body, identity.runId));
  const instructionMatch = Boolean(identity.instructionPath && body.includes(identity.instructionPath));
  if (runMatch) score += 20;
  if (instructionMatch) score += 30;
  if (!identity.attemptStartedAt && !identity.instructionPath && !requestedSessionId) return null;
  return score;
}
function hasTranscriptIdentityBoundary(identity) {
  return Boolean(identity.sessionId || identity.attemptStartedAt || identity.instructionPath);
}
function selectTranscriptFromCapture(capture, resolve2, identity = {}, findByInstructionPath) {
  const uuids = [...new Set((capture.match(TRANSCRIPT_UUID_RE) ?? []).map((u) => u.toLowerCase()))];
  if (!hasTranscriptIdentityBoundary(identity)) return "";
  const candidates = uuids.flatMap((uuid) => {
    const path = resolve2(uuid);
    if (!path) return [];
    const score = scoreTranscriptIdentity(path, uuid, identity);
    return score === null ? [] : [{ path, score }];
  });
  if (identity.instructionPath && findByInstructionPath) {
    const alreadyScored = new Set(candidates.map((candidate) => candidate.path));
    for (const path of findByInstructionPath()) {
      if (alreadyScored.has(path)) continue;
      alreadyScored.add(path);
      const score = scoreTranscriptIdentity(path, void 0, identity);
      if (score !== null) candidates.push({ path, score });
    }
  }
  if (!candidates.length) return "";
  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
    return "";
  }
  return candidates[0].path;
}
function findTranscriptJsonl(root, uuid, depth) {
  if (depth < 0 || !(0, import_node_fs.existsSync)(root)) return "";
  let entries = [];
  try {
    entries = (0, import_node_fs.readdirSync)(root);
  } catch {
    return "";
  }
  for (const entry of entries) {
    const path = (0, import_node_path.join)(root, entry);
    try {
      const entryStat = (0, import_node_fs.lstatSync)(path);
      if (entry.includes(uuid) && entry.endsWith(".jsonl") && entryStat.isFile()) return path;
      if (entryStat.isDirectory()) {
        const nested = findTranscriptJsonl(path, uuid, depth - 1);
        if (nested) return nested;
      }
    } catch {
      continue;
    }
  }
  return "";
}
function collectJsonlFiles(root, depth) {
  if (depth < 0 || !(0, import_node_fs.existsSync)(root)) return [];
  let entries = [];
  try {
    entries = (0, import_node_fs.readdirSync)(root);
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    const path = (0, import_node_path.join)(root, entry);
    try {
      const entryStat = (0, import_node_fs.lstatSync)(path);
      if (entry.endsWith(".jsonl") && entryStat.isFile()) {
        out.push(path);
      } else if (entryStat.isDirectory()) {
        out.push(...collectJsonlFiles(path, depth - 1));
      }
    } catch {
      continue;
    }
  }
  return out;
}
var TRANSCRIPT_INSTRUCTION_PATH_SCAN_LIMIT = 20;
function findTranscriptJsonlByInstructionPath(root, identity, depth) {
  if (!identity.instructionPath) return [];
  const files = collectJsonlFiles(root, depth);
  if (!files.length) return [];
  const started = identity.attemptStartedAt ? Date.parse(identity.attemptStartedAt) : Number.NaN;
  const now = (identity.now ?? /* @__PURE__ */ new Date()).getTime();
  const withinWindow = (mtimeMs) => !Number.isFinite(started) || mtimeMs >= started - TRANSCRIPT_ATTEMPT_CLOCK_SKEW_MS && mtimeMs <= now + TRANSCRIPT_FUTURE_TIMESTAMP_TOLERANCE_MS;
  const narrowed = files.map((path) => {
    try {
      return { path, mtimeMs: (0, import_node_fs.statSync)(path).mtimeMs };
    } catch {
      return null;
    }
  }).filter((entry) => entry !== null && withinWindow(entry.mtimeMs)).sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, TRANSCRIPT_INSTRUCTION_PATH_SCAN_LIMIT);
  const matches = [];
  for (const { path } of narrowed) {
    let body;
    try {
      body = (0, import_node_fs.readFileSync)(path, "utf8");
    } catch {
      continue;
    }
    if (body.includes(identity.instructionPath)) matches.push(path);
  }
  return matches;
}

// lib/runner-v2/agent-transcript-cli.ts
var COMMANDS = ["resolve", "durable-marker"];
var IDENTITY_FLAGS = /* @__PURE__ */ new Set([
  "--session-id",
  "--profile-path",
  "--explicit-jsonl",
  "--run-id",
  "--workspace",
  "--attempt-started-at",
  "--instruction-path",
  "--capture-depth"
]);
var DEFAULT_CAPTURE_DEPTH = 4;
function resolveTranscriptPath(values, deps) {
  const identity = identityFromValues(values, deps.now);
  const explicit = values.get("--explicit-jsonl");
  if (explicit) {
    try {
      if (!(0, import_node_fs2.lstatSync)(explicit).isFile()) return "";
    } catch {
      return "";
    }
    if (!hasTranscriptIdentityBoundary(identity)) {
      const hasWeakIdentity = Boolean(identity.workspacePath || identity.runId);
      return hasWeakIdentity ? "" : explicit;
    }
    return scoreTranscriptIdentity(explicit, void 0, identity) === null ? "" : explicit;
  }
  if (!hasTranscriptIdentityBoundary(identity)) return "";
  const root = transcriptRootFromProfile(values.get("--profile-path"));
  if (!root) return "";
  const depth = captureDepth(values.get("--capture-depth"));
  return selectTranscriptFromCapture(
    deps.readCapture(),
    (uuid) => findTranscriptJsonl(root, uuid, depth),
    identity,
    () => findTranscriptJsonlByInstructionPath(root, identity, depth)
  );
}
function runRunnerAgentTranscriptCli(argv, deps, write = (line) => console.log(line)) {
  const parsed = parseCli(argv);
  const path = resolveTranscriptPath(parsed.values, deps);
  if (parsed.command === "resolve") {
    if (path) write(path);
    return 0;
  }
  if (!path) return 1;
  return agentCompleteMarkerDurable(path) ? 0 : 1;
}
function parseCli(argv) {
  const command = argv[0];
  if (!command || !COMMANDS.includes(command)) throw new Error(usage());
  const values = /* @__PURE__ */ new Map();
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || !value || !flag.startsWith("--") || values.has(flag)) throw new Error(usage());
    if (!IDENTITY_FLAGS.has(flag)) throw new Error(`${flag} is not valid for ${command}`);
    values.set(flag, value);
  }
  return { command, values };
}
function identityFromValues(values, now) {
  return {
    sessionId: values.get("--session-id"),
    workspacePath: values.get("--workspace"),
    attemptStartedAt: values.get("--attempt-started-at"),
    runId: values.get("--run-id"),
    instructionPath: values.get("--instruction-path"),
    now
  };
}
function captureDepth(raw) {
  if (!raw) return DEFAULT_CAPTURE_DEPTH;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_CAPTURE_DEPTH;
}
function usage() {
  return `usage: runner-agent-transcript <${COMMANDS.join("|")}> [--profile-path <path>] [--explicit-jsonl <path>] [--session-id <uuid>] [--run-id <id>] [--workspace <path>] [--attempt-started-at <iso>] [--instruction-path <path>] [--capture-depth <n>] < capture`;
}
function readStdinCapture() {
  try {
    return (0, import_node_fs2.readFileSync)(0, "utf8");
  } catch {
    return "";
  }
}
if (require.main === module) {
  try {
    process.exitCode = runRunnerAgentTranscriptCli(process.argv.slice(2), { readCapture: readStdinCapture });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  resolveTranscriptPath,
  runRunnerAgentTranscriptCli
});
