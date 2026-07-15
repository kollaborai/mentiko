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

// lib/generation/payload-import-cli.ts
var payload_import_cli_exports = {};
__export(payload_import_cli_exports, {
  normalizeResultForKind: () => normalizeResultForKind,
  resolveGenerationPayload: () => resolveGenerationPayload,
  runGenerationPayloadImportCli: () => runGenerationPayloadImportCli
});
module.exports = __toCommonJS(payload_import_cli_exports);
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");

// lib/generation/payload-resolver.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");

// ../lib/job-runner-output-parser.mjs
function cleanAiOutput(output) {
  return String(output || "").replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
}
function extractJsonCandidates(text) {
  const candidates = [];
  const source = String(text || "");
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        candidates.push(source.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return candidates;
}
function parseAiJsonOutput(output) {
  const cleaned = cleanAiOutput(output);
  try {
    return JSON.parse(cleaned);
  } catch {
    for (const candidate of extractJsonCandidates(cleaned).reverse()) {
      try {
        return JSON.parse(candidate);
      } catch {
      }
    }
  }
  return null;
}

// lib/generation/payload-contract.ts
function isJsonRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isPayloadCompatibleWithKind(obj, kind) {
  if (!isJsonRecord(obj)) return false;
  if (kind === "task") {
    if (obj.route === "decision") {
      return typeof obj.reason === "string" && obj.reason.trim().length > 0;
    }
    const task = obj.route === "task" && isJsonRecord(obj.task) ? obj.task : obj;
    return typeof task.title === "string" || Array.isArray(task.tasks) || Array.isArray(task.subtasks);
  }
  if (kind === "chain_generation") {
    return typeof obj.output === "string" || Array.isArray(obj.agents);
  }
  if (kind === "chain_recommendation") {
    const recommendation = isJsonRecord(obj.recommendation) ? obj.recommendation : obj;
    const action = typeof recommendation.action === "string" ? recommendation.action : "";
    return Boolean(
      action || recommendation.chain_id || recommendation.generation_prompt || recommendation.suggested_name || recommendation.reasoning || recommendation.rationale
    );
  }
  return true;
}
function normalizeResultForKind(result, kind) {
  if (kind === "chain_generation" && isJsonRecord(result) && !("output" in result)) {
    return { output: JSON.stringify(result) };
  }
  return result;
}

// lib/generation/payload-resolver.ts
var CAPTURE_ARTIFACT_RE = /-(profile|conversations|events|files-changed|summary|started-at|git-before)\.json$/;
function isGenerationPayloadAlias(path) {
  const name = (0, import_node_path.basename)(path);
  return name === "generation-result.json" || name.endsWith("-generation-result.json") || name.endsWith("-output.json") || name.endsWith("-result.json");
}
function resolveGenerationPayload(explicitPath, artifactsDir, kind = "", eventData = process.env.MENTIKO_COMPLETION_EVENT_DATA ?? "") {
  const root = canonicalArtifactRoot(artifactsDir);
  const canonical = explicitPath ? artifactPath(root, explicitPath) : (0, import_node_path.join)(root, "generation-result.json");
  const direct = readJsonRecord(canonical);
  if (direct && isPayloadCompatibleWithKind(direct, kind)) return { result: direct, source: canonical };
  for (const name of readdirSafe(root)) {
    if (!name.endsWith(".json") || name === "generation-result.json" || CAPTURE_ARTIFACT_RE.test(name) || !isGenerationPayloadAlias(name)) continue;
    const source = (0, import_node_path.join)(root, name);
    const candidate = readJsonRecord(source);
    if (candidate && isPayloadCompatibleWithKind(candidate, kind)) return { result: candidate, source };
  }
  if (eventData.trim()) {
    const candidate = parseJsonValue(eventData);
    if (isRecord(candidate) && isPayloadCompatibleWithKind(candidate, kind)) return { result: candidate, source: "event-data" };
  }
  const transcript = resolveFromTranscript(root, kind);
  if (transcript) return transcript;
  for (const name of readdirSafe(root)) {
    if (!name.endsWith("-output.txt")) continue;
    const source = (0, import_node_path.join)(root, name);
    const candidate = parseAiJsonOutput(readFileSafe(source));
    if (isPayloadCompatibleWithKind(candidate, kind)) return { result: candidate, source };
  }
  return null;
}
function resolveFromTranscript(artifactsDir, kind) {
  for (const name of readdirSafe(artifactsDir)) {
    if (!name.endsWith("-conversations.json")) continue;
    const entries = parseJsonValue(readFileSafe((0, import_node_path.join)(artifactsDir, name)));
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const path = isRecord(entry) && typeof entry.path === "string" ? entry.path : "";
      if (!path || !(0, import_node_path.isAbsolute)(path) || !path.endsWith(".jsonl") || !(0, import_node_fs.existsSync)(path) || (0, import_node_fs.lstatSync)(path).isSymbolicLink()) continue;
      const result = scanTranscriptJsonl((0, import_node_fs.realpathSync)(path), kind);
      if (result) return { result, source: path };
    }
  }
  return null;
}
function scanTranscriptJsonl(path, kind) {
  let last = null;
  for (const line of readFileSafe(path).split("\n")) {
    const event = parseJsonValue(line);
    const message = isRecord(event) && isRecord(event.message) ? event.message : void 0;
    const content = message && Array.isArray(message.content) ? message.content : [];
    for (const block of content) {
      if (!isRecord(block)) continue;
      const text = block.type === "text" && typeof block.text === "string" ? block.text : block.type === "tool_use" && isRecord(block.input) && isGenerationPayloadAlias(String(block.input.file_path ?? block.input.path ?? "")) && typeof block.input.content === "string" ? block.input.content : "";
      const result = text ? parseAiJsonOutput(text) : null;
      if (isPayloadCompatibleWithKind(result, kind)) last = result;
    }
  }
  return last;
}
function canonicalArtifactRoot(artifactsDir) {
  if (!artifactsDir || !(0, import_node_path.isAbsolute)(artifactsDir) || !(0, import_node_fs.existsSync)(artifactsDir)) throw new Error("ARTIFACTS_DIR must be an existing absolute run artifact directory.");
  const root = (0, import_node_fs.realpathSync)(artifactsDir);
  if (!(0, import_node_fs.lstatSync)(root).isDirectory()) throw new Error("ARTIFACTS_DIR must be a directory.");
  return root;
}
function artifactPath(root, path) {
  if (!(0, import_node_path.isAbsolute)(path)) throw new Error("Generation artifact path must be absolute.");
  const resolved = (0, import_node_fs.existsSync)(path) ? (0, import_node_fs.realpathSync)(path) : (0, import_node_path.resolve)(path);
  const rel = (0, import_node_path.relative)(root, resolved);
  if (!rel || rel.startsWith("..") || (0, import_node_path.isAbsolute)(rel)) throw new Error("Generation artifact path must resolve beneath ARTIFACTS_DIR.");
  return resolved;
}
function readdirSafe(path) {
  try {
    return (0, import_node_fs.readdirSync)(path);
  } catch {
    return [];
  }
}
function readFileSafe(path) {
  try {
    return (0, import_node_fs.readFileSync)(path, "utf8");
  } catch {
    return "";
  }
}
function readJsonRecord(path) {
  const value = parseJsonValue(readFileSafe(path));
  return isRecord(value) ? value : null;
}
function parseJsonValue(content) {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// lib/generation/payload-import-cli.ts
async function runGenerationPayloadImportCli(argv, environment = process.env) {
  if (argv[0] !== "import") throw new Error("usage: generation import <artifact.json> --job <id> --kind <kind> [--run <runId>]");
  const positional = argv[1] && !argv[1].startsWith("--") ? argv[1] : "";
  const values = flags(positional ? argv.slice(2) : argv.slice(1));
  const jobId = values.get("--job") || environment.MENTIKO_GENERATION_JOB_ID || "";
  const kind = values.get("--kind") || environment.MENTIKO_GENERATION_KIND || "";
  const runId = values.get("--run") || environment.MENTIKO_RUN_ID || environment.RUN_ID || "";
  if (!jobId || !kind) throw new Error("generation import requires --job and --kind.");
  const artifactsDir = environment.ARTIFACTS_DIR || "";
  const payload = resolveGenerationPayload(positional, artifactsDir, kind, environment.MENTIKO_COMPLETION_EVENT_DATA ?? "");
  if (!payload) throw new Error("No valid generation payload was found in this run's artifact, event, transcript, or output sources.");
  const token = environment.MENTIKO_JOB_IMPORT_TOKEN || readRunScopedToken(positional || (0, import_node_path2.join)(artifactsDir, "generation-result.json"), "generation-import-token") || environment.BETTER_AUTH_SECRET || "";
  const baseUrl = environment.MENTIKO_WEB_URL || `http://localhost:${environment.WEB_PORT || environment.PORT || 3e3}`;
  const response = await fetch(`${baseUrl}/api/jobs/${encodeURIComponent(jobId)}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...token ? { Authorization: `Bearer ${token}` } : {}, "x-namespace-id": environment.NAMESPACE_ID || "default", "x-org-id": environment.ORG_ID || "default" },
    body: JSON.stringify({ status: "complete", result: normalizeResultForKind(payload.result, kind), runId: runId || void 0, generationKind: kind })
  });
  if (!response.ok) throw new Error(`generation import failed: ${response.status} ${await response.text().catch(() => "")}`);
}
function flags(argv) {
  const values = /* @__PURE__ */ new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === void 0 || values.has(key)) throw new Error("Invalid generation import arguments.");
    values.set(key, value);
  }
  return values;
}
function readRunScopedToken(artifactPath2, filename) {
  const artifactDir = (0, import_node_path2.dirname)((0, import_node_path2.resolve)(artifactPath2));
  const path = (0, import_node_path2.join)((0, import_node_path2.dirname)(artifactDir), ".internal", filename);
  if ((0, import_node_path2.basename)(artifactDir) !== "artifacts" || !(0, import_node_fs2.existsSync)(path)) return "";
  try {
    return (0, import_node_fs2.readFileSync)(path, "utf8").trim();
  } catch {
    return "";
  }
}
if (require.main === module) runGenerationPayloadImportCli(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  normalizeResultForKind,
  resolveGenerationPayload,
  runGenerationPayloadImportCli
});
