import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { ApprovalRequest, ApprovalStatus } from "@/lib/system/approval-types";

const APPROVAL_STATUSES = new Set<ApprovalStatus>(["pending", "approved", "rejected", "cancelled"]);
const APPROVAL_METHODS = new Set(["web", "slack", "email", "api"]);

export interface ApprovalGateInput {
  approvalsDir: string;
  chainId: string;
  runId: string;
  agentName: string;
  stepName: string;
  action: string;
  description: string;
  timeoutMinutes?: number;
  requestId?: string;
  now?: Date;
  pollIntervalMs?: number;
}

export interface ApprovalGateResult {
  code: 0 | 1 | 2 | 3;
  request: ApprovalRequest;
}

export interface ApprovalRawValidation {
  valid: boolean;
  value?: Record<string, unknown>;
  issues: Array<{ code: "empty-file" | "invalid-json" | "invalid-root"; message: string }>;
}

export interface ApprovalValidation {
  valid: boolean;
  issues: Array<{ field: string; message: string }>;
}

export function approvalRequestPath(approvalsDir: string, requestId: string): string {
  const root = requireApprovalDirectory(approvalsDir);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(requestId)) {
    throw new Error("Approval request id must contain only letters, numbers, underscores, or hyphens.");
  }
  const path = resolve(root, `${requestId}.json`);
  if (dirname(path) !== root) throw new Error("Approval request path escapes the approvals directory.");
  return path;
}

export function validateRawApprovalRequest(content: string): ApprovalRawValidation {
  if (!content.trim()) return { valid: false, issues: [{ code: "empty-file", message: "Approval request file is empty." }] };
  try {
    const value: unknown = JSON.parse(content);
    if (!isRecord(value)) return { valid: false, issues: [{ code: "invalid-root", message: "Approval request root must be an object." }] };
    return { valid: true, value, issues: [] };
  } catch (error) {
    return {
      valid: false,
      issues: [{ code: "invalid-json", message: `Approval request JSON is invalid: ${error instanceof Error ? error.message : String(error)}` }],
    };
  }
}

export function validateApprovalRequest(value: unknown): ApprovalValidation {
  const issues: Array<{ field: string; message: string }> = [];
  if (!isRecord(value)) return { valid: false, issues: [{ field: "root", message: "Approval request must be an object." }] };
  for (const field of ["id", "chainId", "runId", "agentName", "stepName", "requestedBy", "requestedAt", "action", "description"] as const) {
    if (typeof value[field] !== "string" || !value[field].trim() || value[field].includes("\n")) {
      issues.push({ field, message: `${field} must be a non-empty one-line string.` });
    }
  }
  if (!APPROVAL_STATUSES.has(value.status as ApprovalStatus)) issues.push({ field: "status", message: "status is not a supported approval status." });
  if (typeof value.method !== "string" || !APPROVAL_METHODS.has(value.method)) issues.push({ field: "method", message: "method is not a supported approval method." });
  if (!isRecord(value.metadata)) issues.push({ field: "metadata", message: "metadata must be an object." });
  if (value.expiresAt !== undefined && (typeof value.expiresAt !== "string" || !Number.isFinite(Date.parse(value.expiresAt)))) {
    issues.push({ field: "expiresAt", message: "expiresAt must be an ISO timestamp when present." });
  }
  if (value.approvedAt !== undefined && (typeof value.approvedAt !== "string" || !Number.isFinite(Date.parse(value.approvedAt)))) {
    issues.push({ field: "approvedAt", message: "approvedAt must be an ISO timestamp when present." });
  }
  if (value.status === "approved" && typeof value.approvedBy !== "string") issues.push({ field: "approvedBy", message: "approved approvals require approvedBy." });
  if (value.status === "rejected" && value.rejectionReason !== undefined && typeof value.rejectionReason !== "string") {
    issues.push({ field: "rejectionReason", message: "rejectionReason must be a string when present." });
  }
  return { valid: issues.length === 0, issues };
}

export function createApprovalRequest(input: ApprovalGateInput): ApprovalRequest {
  const timeoutMinutes = input.timeoutMinutes ?? 60;
  assertNonNegativeFinite(timeoutMinutes, "timeoutMinutes");
  const now = input.now ?? new Date();
  const request: ApprovalRequest = {
    id: input.requestId ?? randomUUID(),
    chainId: input.chainId,
    runId: input.runId,
    agentName: input.agentName,
    stepName: input.stepName,
    status: "pending",
    requestedBy: "system",
    requestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + timeoutMinutes * 60_000).toISOString(),
    method: "web",
    action: input.action,
    description: input.description,
    metadata: {},
  };
  const validation = validateApprovalRequest(request);
  if (!validation.valid) throw new Error(`Invalid approval request: ${validation.issues.map((issue) => `${issue.field} ${issue.message}`).join(" ")}`);
  return request;
}

export function writeApprovalRequest(approvalsDir: string, request: ApprovalRequest): void {
  const validation = validateApprovalRequest(request);
  if (!validation.valid) throw new Error(`Invalid approval request: ${validation.issues.map((issue) => `${issue.field} ${issue.message}`).join(" ")}`);
  const path = approvalRequestPath(approvalsDir, request.id);
  writeAtomicJson(path, request);
  appendFileSync(join(requireApprovalDirectory(approvalsDir), "requests.jsonl"), `${JSON.stringify(request)}\n`, { mode: 0o600 });
}

export function readApprovalRequest(approvalsDir: string, requestId: string): ApprovalRequest {
  const path = approvalRequestPath(approvalsDir, requestId);
  if (!existsSync(path)) throw new Error(`Approval request file does not exist: ${path}`);
  assertRegularFile(path, "Approval request");
  const raw = validateRawApprovalRequest(readFileSync(path, "utf8"));
  if (!raw.valid || !raw.value) throw new Error(`Invalid raw approval request at ${path}: ${raw.issues.map((issue) => issue.message).join(" ")}`);
  const normalized = validateApprovalRequest(raw.value);
  if (!normalized.valid) throw new Error(`Invalid normalized approval request at ${path}: ${normalized.issues.map((issue) => issue.field).join(", ")}`);
  return raw.value as unknown as ApprovalRequest;
}

export function updateApprovalRequest(approvalsDir: string, request: ApprovalRequest): ApprovalRequest {
  const current = readApprovalRequest(approvalsDir, request.id);
  if (current.status !== "pending") throw new Error(`Approval request is already ${current.status}.`);
  const validation = validateApprovalRequest(request);
  if (!validation.valid) throw new Error(`Invalid approval request update: ${validation.issues.map((issue) => `${issue.field} ${issue.message}`).join(" ")}`);
  writeAtomicJson(approvalRequestPath(approvalsDir, request.id), request);
  return request;
}

export async function waitForApproval(
  input: ApprovalGateInput,
  write: (line: string) => void = console.log,
  sleep: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
): Promise<ApprovalGateResult> {
  const request = createApprovalRequest(input);
  const timeoutMinutes = input.timeoutMinutes ?? 60;
  const pollIntervalMs = input.pollIntervalMs ?? 10_000;
  assertNonNegativeFinite(pollIntervalMs, "pollIntervalMs");
  writeApprovalRequest(input.approvalsDir, request);
  printApprovalRequest(request, timeoutMinutes, write);

  const maxPolls = pollIntervalMs === 0 ? 0 : Math.floor((timeoutMinutes * 60_000) / pollIntervalMs);
  for (let poll = 0; poll < maxPolls; poll += 1) {
    await sleep(pollIntervalMs);
    const current = readApprovalRequest(input.approvalsDir, request.id);
    if (current.status === "approved") {
      write(`  ✔ approved by: ${current.approvedBy || "unknown"}`);
      return { code: 0, request: current };
    }
    if (current.status === "rejected") {
      write(`  ✖ rejected: ${current.rejectionReason || "no reason given"}`);
      return { code: 1, request: current };
    }
    if (current.status === "cancelled") {
      write("  ✖ cancelled");
      return { code: 2, request: current };
    }
    if ((poll + 1) % 5 === 0) write(`  ... still waiting (${poll + 1} checks)`);
  }

  const timedOut: ApprovalRequest = {
    ...readApprovalRequest(input.approvalsDir, request.id),
    status: "cancelled",
    rejectionReason: "timed out",
  };
  writeAtomicJson(approvalRequestPath(input.approvalsDir, request.id), timedOut);
  write(`  ✖ approval timed out after ${timeoutMinutes}m`);
  return { code: 2, request: timedOut };
}

function printApprovalRequest(request: ApprovalRequest, timeoutMinutes: number, write: (line: string) => void): void {
  const baseUrl = process.env.BETTER_AUTH_URL || process.env.MENTIKO_WEB_URL || `http://localhost:${process.env.WEB_PORT || process.env.PORT || "3000"}`;
  write("");
  write("  ⏸ APPROVAL GATE — waiting for human approval");
  write("  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
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

function writeAtomicJson(path: string, value: unknown): void {
  const directory = dirname(path);
  ensureDirectory(directory);
  assertDirectory(directory, "Approval directory");
  assertNotSymbolicLink(path, "Approval request");
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

function requireApprovalDirectory(path: string): string {
  if (!path || !path.startsWith("/")) throw new Error("Approval directory must be an absolute path.");
  const root = resolve(path);
  ensureDirectory(root);
  assertDirectory(root, "Approval directory");
  return root;
}

function ensureDirectory(path: string): void {
  if (existsSync(path)) {
    assertNotSymbolicLink(path, "Approval directory");
    return;
  }
  mkdirSync(path, { recursive: true, mode: 0o700 });
  assertNotSymbolicLink(path, "Approval directory");
}

function assertDirectory(path: string, label: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${label} must be a real directory: ${path}`);
}

function assertRegularFile(path: string, label: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a regular file: ${path}`);
}

function assertNotSymbolicLink(path: string, label: string): void {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${path}`);
}

function assertNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a finite non-negative number.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
