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

// lib/runner-v2/approval-gate-cli.ts
var approval_gate_cli_exports = {};
__export(approval_gate_cli_exports, {
  runApprovalGateCli: () => runApprovalGateCli
});
module.exports = __toCommonJS(approval_gate_cli_exports);

// lib/runner-v2/approval-gate.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var import_node_crypto = require("node:crypto");
var APPROVAL_STATUSES = /* @__PURE__ */ new Set(["pending", "approved", "rejected", "cancelled"]);
var APPROVAL_METHODS = /* @__PURE__ */ new Set(["web", "slack", "email", "api"]);
function approvalRequestPath(approvalsDir, requestId) {
  const root = requireApprovalDirectory(approvalsDir);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(requestId)) {
    throw new Error("Approval request id must contain only letters, numbers, underscores, or hyphens.");
  }
  const path = (0, import_node_path.resolve)(root, `${requestId}.json`);
  if ((0, import_node_path.dirname)(path) !== root) throw new Error("Approval request path escapes the approvals directory.");
  return path;
}
function validateRawApprovalRequest(content) {
  if (!content.trim()) return { valid: false, issues: [{ code: "empty-file", message: "Approval request file is empty." }] };
  try {
    const value = JSON.parse(content);
    if (!isRecord(value)) return { valid: false, issues: [{ code: "invalid-root", message: "Approval request root must be an object." }] };
    return { valid: true, value, issues: [] };
  } catch (error) {
    return {
      valid: false,
      issues: [{ code: "invalid-json", message: `Approval request JSON is invalid: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }
}
function validateApprovalRequest(value) {
  const issues = [];
  if (!isRecord(value)) return { valid: false, issues: [{ field: "root", message: "Approval request must be an object." }] };
  for (const field of ["id", "chainId", "runId", "agentName", "stepName", "requestedBy", "requestedAt", "action", "description"]) {
    if (typeof value[field] !== "string" || !value[field].trim() || value[field].includes("\n")) {
      issues.push({ field, message: `${field} must be a non-empty one-line string.` });
    }
  }
  if (!APPROVAL_STATUSES.has(value.status)) issues.push({ field: "status", message: "status is not a supported approval status." });
  if (typeof value.method !== "string" || !APPROVAL_METHODS.has(value.method)) issues.push({ field: "method", message: "method is not a supported approval method." });
  if (!isRecord(value.metadata)) issues.push({ field: "metadata", message: "metadata must be an object." });
  if (value.expiresAt !== void 0 && (typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt)))) {
    issues.push({ field: "expiresAt", message: "expiresAt must be an ISO timestamp when present." });
  }
  if (value.approvedAt !== void 0 && (typeof value.approvedAt !== "string" || !Number.isFinite(Date.parse(value.approvedAt)))) {
    issues.push({ field: "approvedAt", message: "approvedAt must be an ISO timestamp when present." });
  }
  if (value.status === "approved" && typeof value.approvedBy !== "string") issues.push({ field: "approvedBy", message: "approved approvals require approvedBy." });
  if (value.status === "rejected" && value.rejectionReason !== void 0 && typeof value.rejectionReason !== "string") {
    issues.push({ field: "rejectionReason", message: "rejectionReason must be a string when present." });
  }
  return { valid: issues.length === 0, issues };
}
function createApprovalRequest(input) {
  const timeoutMinutes = input.timeoutMinutes ?? 60;
  assertNonNegativeFinite(timeoutMinutes, "timeoutMinutes");
  const now = input.now ?? /* @__PURE__ */ new Date();
  const request = {
    id: input.requestId ?? (0, import_node_crypto.randomUUID)(),
    chainId: input.chainId,
    runId: input.runId,
    agentName: input.agentName,
    stepName: input.stepName,
    status: "pending",
    requestedBy: "system",
    requestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + timeoutMinutes * 6e4).toISOString(),
    method: "web",
    action: input.action,
    description: input.description,
    metadata: {}
  };
  const validation = validateApprovalRequest(request);
  if (!validation.valid) throw new Error(`Invalid approval request: ${validation.issues.map((issue) => `${issue.field} ${issue.message}`).join(" ")}`);
  return request;
}
function writeApprovalRequest(approvalsDir, request) {
  const validation = validateApprovalRequest(request);
  if (!validation.valid) throw new Error(`Invalid approval request: ${validation.issues.map((issue) => `${issue.field} ${issue.message}`).join(" ")}`);
  const path = approvalRequestPath(approvalsDir, request.id);
  writeAtomicJson(path, request);
  (0, import_node_fs.appendFileSync)((0, import_node_path.join)(requireApprovalDirectory(approvalsDir), "requests.jsonl"), `${JSON.stringify(request)}
`, { mode: 384 });
}
function readApprovalRequest(approvalsDir, requestId) {
  const path = approvalRequestPath(approvalsDir, requestId);
  if (!(0, import_node_fs.existsSync)(path)) throw new Error(`Approval request file does not exist: ${path}`);
  assertRegularFile(path, "Approval request");
  const raw = validateRawApprovalRequest((0, import_node_fs.readFileSync)(path, "utf8"));
  if (!raw.valid || !raw.value) throw new Error(`Invalid raw approval request at ${path}: ${raw.issues.map((issue) => issue.message).join(" ")}`);
  const normalized = validateApprovalRequest(raw.value);
  if (!normalized.valid) throw new Error(`Invalid normalized approval request at ${path}: ${normalized.issues.map((issue) => issue.field).join(", ")}`);
  return raw.value;
}
async function waitForApproval(input, write = console.log, sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds))) {
  const request = createApprovalRequest(input);
  const timeoutMinutes = input.timeoutMinutes ?? 60;
  const pollIntervalMs = input.pollIntervalMs ?? 1e4;
  assertNonNegativeFinite(pollIntervalMs, "pollIntervalMs");
  writeApprovalRequest(input.approvalsDir, request);
  printApprovalRequest(request, timeoutMinutes, write);
  const maxPolls = pollIntervalMs === 0 ? 0 : Math.floor(timeoutMinutes * 6e4 / pollIntervalMs);
  for (let poll = 0; poll < maxPolls; poll += 1) {
    await sleep(pollIntervalMs);
    const current = readApprovalRequest(input.approvalsDir, request.id);
    if (current.status === "approved") {
      write(`  \u2714 approved by: ${current.approvedBy || "unknown"}`);
      return { code: 0, request: current };
    }
    if (current.status === "rejected") {
      write(`  \u2716 rejected: ${current.rejectionReason || "no reason given"}`);
      return { code: 1, request: current };
    }
    if (current.status === "cancelled") {
      write("  \u2716 cancelled");
      return { code: 2, request: current };
    }
    if ((poll + 1) % 5 === 0) write(`  ... still waiting (${poll + 1} checks)`);
  }
  const timedOut = {
    ...readApprovalRequest(input.approvalsDir, request.id),
    status: "cancelled",
    rejectionReason: "timed out"
  };
  writeAtomicJson(approvalRequestPath(input.approvalsDir, request.id), timedOut);
  write(`  \u2716 approval timed out after ${timeoutMinutes}m`);
  return { code: 2, request: timedOut };
}
function printApprovalRequest(request, timeoutMinutes, write) {
  const baseUrl = process.env.BETTER_AUTH_URL || process.env.MENTIKO_WEB_URL || `http://localhost:${process.env.WEB_PORT || process.env.PORT || "3000"}`;
  write("");
  write("  \u23F8 APPROVAL GATE \u2014 waiting for human approval");
  write("  \u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501");
  write(`  chain:   ${request.chainId}`);
  write(`  agent:   ${request.agentName}`);
  write(`  action:  ${request.action}`);
  write(`  desc:    ${request.description}`);
  write(`  timeout: ${timeoutMinutes}m`);
  write(`  id:      ${request.id}`);
  write("");
  write(`  approve at: ${baseUrl}/approvals`);
  write(`  (or via API: POST ${baseUrl}/api/approvals/${request.id} )`);
  write("");
  write("  polling for decision...");
}
function writeAtomicJson(path, value) {
  const directory = (0, import_node_path.dirname)(path);
  ensureDirectory(directory);
  assertDirectory(directory, "Approval directory");
  assertNotSymbolicLink(path, "Approval request");
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    (0, import_node_fs.writeFileSync)(temporary, `${JSON.stringify(value, null, 2)}
`, { mode: 384, flag: "wx" });
    (0, import_node_fs.renameSync)(temporary, path);
  } finally {
    if ((0, import_node_fs.existsSync)(temporary)) (0, import_node_fs.rmSync)(temporary, { force: true });
  }
}
function requireApprovalDirectory(path) {
  if (!path || !path.startsWith("/")) throw new Error("Approval directory must be an absolute path.");
  const root = (0, import_node_path.resolve)(path);
  ensureDirectory(root);
  assertDirectory(root, "Approval directory");
  return root;
}
function ensureDirectory(path) {
  if ((0, import_node_fs.existsSync)(path)) {
    assertNotSymbolicLink(path, "Approval directory");
    return;
  }
  (0, import_node_fs.mkdirSync)(path, { recursive: true, mode: 448 });
  assertNotSymbolicLink(path, "Approval directory");
}
function assertDirectory(path, label) {
  const stat = (0, import_node_fs.lstatSync)(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${label} must be a real directory: ${path}`);
}
function assertRegularFile(path, label) {
  const stat = (0, import_node_fs.lstatSync)(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a regular file: ${path}`);
}
function assertNotSymbolicLink(path, label) {
  if ((0, import_node_fs.existsSync)(path) && (0, import_node_fs.lstatSync)(path).isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${path}`);
}
function assertNonNegativeFinite(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a finite non-negative number.`);
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// lib/runner-v2/approval-gate-cli.ts
async function runApprovalGateCli(argv, write = console.log) {
  const command = argv[0];
  if (command !== "wait") throw new Error("usage: runner-approval-gate wait --approvals-dir <absolute-dir> --chain-id <id> --run-id <id> --agent-name <name> --step-name <name> --action <text> --description <text> [--timeout-minutes <number>]");
  const values = parseValues(argv.slice(1));
  rejectUnexpected(values, /* @__PURE__ */ new Set(["--approvals-dir", "--chain-id", "--run-id", "--agent-name", "--step-name", "--action", "--description", "--timeout-minutes", "--poll-interval-ms"]));
  const result = await waitForApproval({
    approvalsDir: required(values, "--approvals-dir"),
    chainId: required(values, "--chain-id"),
    runId: required(values, "--run-id"),
    agentName: required(values, "--agent-name"),
    stepName: required(values, "--step-name"),
    action: required(values, "--action"),
    description: required(values, "--description"),
    timeoutMinutes: optionalNumber(values, "--timeout-minutes"),
    pollIntervalMs: optionalNumber(values, "--poll-interval-ms")
  }, write);
  return result.code;
}
function parseValues(argv) {
  const values = /* @__PURE__ */ new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === void 0 || values.has(flag)) throw new Error("Invalid runner approval argument list.");
    values.set(flag, value);
  }
  return values;
}
function rejectUnexpected(values, allowed) {
  for (const flag of values.keys()) if (!allowed.has(flag)) throw new Error(`${flag} is not valid for runner-approval-gate.`);
}
function required(values, flag) {
  const value = values.get(flag);
  if (!value?.trim()) throw new Error(`${flag} is required.`);
  return value;
}
function optionalNumber(values, flag) {
  const value = values.get(flag);
  if (value === void 0) return void 0;
  if (!/^(?:\d+|\d*\.\d+)$/.test(value)) throw new Error(`${flag} must be a non-negative number.`);
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${flag} must be finite.`);
  return number;
}
if (require.main === module) {
  runApprovalGateCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`runner approval gate failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 3;
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runApprovalGateCli
});
