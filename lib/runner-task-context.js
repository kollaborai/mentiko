#!/usr/bin/env node
// GENERATED FROM web/lib/runner-v2/task-context-cli.ts - DO NOT EDIT. Rebuild: node scripts/build-runner-bundles.mjs
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

// lib/runner-v2/task-context-cli.ts
var task_context_cli_exports = {};
__export(task_context_cli_exports, {
  runRunnerTaskContextCli: () => runRunnerTaskContextCli
});
module.exports = __toCommonJS(task_context_cli_exports);

// lib/runner-v2/task-context.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function asText(value, field, fallback = "") {
  if (value === void 0 || value === null) return fallback;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  throw new Error(`${field} must be a string, number, boolean, or null`);
}
function requireText(value, field) {
  const normalized = asText(value, field).trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}
function parseRawTaskJson(body) {
  if (!body.trim()) throw new Error("task API returned an empty response");
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`task API returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function validateRawTaskEnvelope(value) {
  if (!isRecord(value)) throw new Error("task API response must be a JSON object");
  if (!isRecord(value.data)) throw new Error("task API response is missing data");
  if (!isRecord(value.data.issue)) throw new Error("task API response is missing data.issue");
  return value;
}
function validateRawCommentsEnvelope(value) {
  if (!isRecord(value)) throw new Error("comments API response must be a JSON object");
  if (!isRecord(value.data)) throw new Error("comments API response is missing data");
  if (!Array.isArray(value.data.comments)) throw new Error("comments API response is missing data.comments");
  return value;
}
function normalizeTaskRecord(issue) {
  return {
    id: requireText(issue.id, "data.issue.id"),
    title: asText(issue.title, "data.issue.title"),
    description: asText(issue.description, "data.issue.description"),
    type: asText(issue.issue_type, "data.issue.issue_type"),
    priority: asText(issue.priority, "data.issue.priority"),
    acceptanceCriteria: asText(issue.acceptance_criteria, "data.issue.acceptance_criteria"),
    design: asText(issue.design, "data.issue.design"),
    notes: asText(issue.notes, "data.issue.notes")
  };
}
function normalizeTaskComments(values) {
  return values.map((value, index) => {
    if (!isRecord(value)) throw new Error(`data.comments[${index}] must be an object`);
    return {
      createdAt: asText(value.created_at, `data.comments[${index}].created_at`, "unknown"),
      author: asText(value.author, `data.comments[${index}].author`, "unknown"),
      text: asText(value.text, `data.comments[${index}].text`)
    };
  });
}
function buildTaskContext(task, comments) {
  let context = [
    `TASK ID: ${task.id}`,
    `TITLE: ${task.title}`,
    `TYPE: ${task.type}`,
    `PRIORITY: ${task.priority}`,
    "",
    "DESCRIPTION:",
    task.description
  ].join("\n");
  const sections = [
    ["ACCEPTANCE CRITERIA:", task.acceptanceCriteria],
    ["DESIGN NOTES:", task.design],
    ["NOTES:", task.notes]
  ];
  for (const [heading, value] of sections) {
    if (value) context += `

${heading}
${value}`;
  }
  if (comments.length > 0) {
    const formatted = comments.map((comment) => `  [${comment.createdAt} ${comment.author}] ${comment.text}`).join("\n");
    context += `

COMMENTS:
${formatted}`;
  }
  return context;
}
function apiUrl(apiBase, path) {
  let base;
  try {
    base = new URL(apiBase);
  } catch (error) {
    throw new Error(`task API base must be an absolute URL: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new Error(`task API base must use http or https: ${base.protocol}`);
  }
  return new URL(path, base).toString();
}
async function requestJson(url, headers, dependencies) {
  const fetchImpl = dependencies.fetch || globalThis.fetch;
  if (!fetchImpl) throw new Error("task context requires a fetch implementation");
  let response;
  try {
    response = await fetchImpl(url, { headers });
  } catch (error) {
    throw new Error(`task API request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new Error(`task API request returned HTTP ${response.status}`);
  return parseRawTaskJson(await response.text());
}
async function loadTaskContext(options, dependencies = {}) {
  const taskId = requireText(options.taskId, "taskId");
  const headers = {
    Accept: "application/json",
    "x-namespace-id": options.namespaceId || "default",
    "x-org-id": options.orgId || "default"
  };
  if (options.authToken) headers.Authorization = `Bearer ${options.authToken}`;
  const rawTask = validateRawTaskEnvelope(await requestJson(
    apiUrl(options.apiBase, `/api/tasks/${encodeURIComponent(taskId)}`),
    headers,
    dependencies
  ));
  const task = normalizeTaskRecord(rawTask.data.issue);
  let comments = [];
  try {
    const rawComments = validateRawCommentsEnvelope(await requestJson(
      apiUrl(options.apiBase, `/api/tasks/${encodeURIComponent(taskId)}/comments`),
      headers,
      dependencies
    ));
    comments = normalizeTaskComments(rawComments.data.comments);
  } catch {
    comments = [];
  }
  return { task, comments, context: buildTaskContext(task, comments) };
}
function shellQuote(value) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
function taskContextEnvironment(result) {
  return {
    TASK_ID: result.task.id,
    TASK_TITLE: result.task.title,
    TASK_DESCRIPTION: result.task.description,
    TASK_TYPE: result.task.type,
    TASK_PRIORITY: result.task.priority,
    TASK_ACCEPTANCE_CRITERIA: result.task.acceptanceCriteria,
    TASK_DESIGN: result.task.design,
    TASK_NOTES: result.task.notes,
    TASK_COMMENTS: result.comments.map((comment) => `  [${comment.createdAt} ${comment.author}] ${comment.text}`).join("\n"),
    TASK_CONTEXT: result.context
  };
}
function writeTaskContextEnv(path, result) {
  if (!(0, import_node_path.isAbsolute)(path)) throw new Error(`task context env path must be absolute: ${path}`);
  const target = (0, import_node_path.resolve)(path);
  try {
    const stat = (0, import_node_fs.lstatSync)(target);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`task context env path must be a non-symlink regular file: ${target}`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const parent = (0, import_node_path.dirname)(target);
  const parentStat = (0, import_node_fs.lstatSync)(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error(`task context env parent must be a non-symlink directory: ${parent}`);
  }
  const values = taskContextEnvironment(result);
  const body = [
    "# Typed task-context handoff; values are shell-quoted by TypeScript.",
    ...Object.entries(values).map(([key, value]) => `export ${key}=${shellQuote(value)}`),
    ""
  ].join("\n");
  const temporary = `${target}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    (0, import_node_fs.writeFileSync)(temporary, body, { encoding: "utf8", mode: 384, flag: "wx" });
    (0, import_node_fs.chmodSync)(temporary, 384);
    (0, import_node_fs.renameSync)(temporary, target);
    (0, import_node_fs.chmodSync)(target, 384);
  } catch (error) {
    try {
      if ((0, import_node_fs.existsSync)(temporary)) {
        const stat = (0, import_node_fs.lstatSync)(temporary);
        if (stat.isFile() && !stat.isSymbolicLink()) (0, import_node_fs.unlinkSync)(temporary);
      }
    } catch {
    }
    throw error;
  }
}

// lib/runner-v2/task-context-cli.ts
var FLAGS = /* @__PURE__ */ new Set([
  "--task-id",
  "--api-base",
  "--auth-token",
  "--namespace-id",
  "--org-id",
  "--env-file"
]);
function parseArguments(argv) {
  if (argv[0] !== "load") throw new Error(usage());
  const values = /* @__PURE__ */ new Map();
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || !FLAGS.has(flag) || value === void 0 || values.has(flag)) throw new Error(usage());
    values.set(flag, value);
  }
  return { command: "load", values };
}
function required(values, flag) {
  const value = values.get(flag);
  if (!value) throw new Error(`${flag} is required`);
  return value;
}
function optional(values, flag, fallback = "") {
  return values.get(flag) || fallback;
}
async function runRunnerTaskContextCli(argv, write = (line) => console.log(line)) {
  const parsed = parseArguments(argv);
  const result = await loadTaskContext({
    taskId: required(parsed.values, "--task-id"),
    apiBase: required(parsed.values, "--api-base"),
    authToken: optional(parsed.values, "--auth-token") || void 0,
    namespaceId: optional(parsed.values, "--namespace-id", "default"),
    orgId: optional(parsed.values, "--org-id", "default")
  });
  writeTaskContextEnv(required(parsed.values, "--env-file"), result);
  write(JSON.stringify({ taskId: result.task.id, commentCount: result.comments.length }));
}
function usage() {
  return "usage: runner-task-context load --task-id <id> --api-base <url> --env-file <absolute-path> [--auth-token <token>] [--namespace-id <id>] [--org-id <id>]";
}
if (require.main === module) {
  runRunnerTaskContextCli(process.argv.slice(2)).catch((error) => {
    console.error(`runner task context failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runRunnerTaskContextCli
});
