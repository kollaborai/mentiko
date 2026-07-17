import {
  chmodSync,
  existsSync,
  lstatSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

/**
 * The task API response is deliberately split into two gates:
 *
 * 1. raw-envelope validation proves that the decoded JSON has the expected
 *    transport envelope without pretending that optional fields are valid;
 * 2. normalized-record validation converts the issue into the exact strings
 *    consumed by the chain prompt and rejects malformed field values.
 *
 * This keeps a shell caller from becoming a second, subtly different JSON
 * parser. The shell only sources the env handoff written by this module.
 */

export interface RawTaskEnvelope {
  data: {
    issue: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface RawCommentsEnvelope {
  data: {
    comments: unknown[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface TaskContextRecord {
  id: string;
  title: string;
  description: string;
  type: string;
  priority: string;
  acceptanceCriteria: string;
  design: string;
  notes: string;
}

export interface TaskContextComment {
  createdAt: string;
  author: string;
  text: string;
}

export interface TaskContextResult {
  task: TaskContextRecord;
  comments: TaskContextComment[];
  context: string;
}

export interface TaskContextOptions {
  taskId: string;
  apiBase: string;
  authToken?: string;
  namespaceId: string;
  orgId: string;
}

export interface TaskContextDependencies {
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asText(value: unknown, field: string, fallback = ""): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  throw new Error(`${field} must be a string, number, boolean, or null`);
}

function requireText(value: unknown, field: string): string {
  const normalized = asText(value, field).trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

/** Decode the raw HTTP body before applying any record-level defaults. */
export function parseRawTaskJson(body: string): unknown {
  if (!body.trim()) throw new Error("task API returned an empty response");
  try {
    return JSON.parse(body) as unknown;
  } catch (error) {
    throw new Error(`task API returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Validate only the transport envelope; field normalization is separate. */
export function validateRawTaskEnvelope(value: unknown): RawTaskEnvelope {
  if (!isRecord(value)) throw new Error("task API response must be a JSON object");
  if (!isRecord(value.data)) throw new Error("task API response is missing data");
  if (!isRecord(value.data.issue)) throw new Error("task API response is missing data.issue");
  return value as RawTaskEnvelope;
}

/** Validate only the transport envelope for the optional comments request. */
export function validateRawCommentsEnvelope(value: unknown): RawCommentsEnvelope {
  if (!isRecord(value)) throw new Error("comments API response must be a JSON object");
  if (!isRecord(value.data)) throw new Error("comments API response is missing data");
  if (!Array.isArray(value.data.comments)) throw new Error("comments API response is missing data.comments");
  return value as RawCommentsEnvelope;
}

/** Normalize the task record consumed by prompt substitution. */
export function normalizeTaskRecord(issue: Record<string, unknown>): TaskContextRecord {
  return {
    id: requireText(issue.id, "data.issue.id"),
    title: asText(issue.title, "data.issue.title"),
    description: asText(issue.description, "data.issue.description"),
    type: asText(issue.issue_type, "data.issue.issue_type"),
    priority: asText(issue.priority, "data.issue.priority"),
    acceptanceCriteria: asText(issue.acceptance_criteria, "data.issue.acceptance_criteria"),
    design: asText(issue.design, "data.issue.design"),
    notes: asText(issue.notes, "data.issue.notes"),
  };
}

/** Normalize comment records after the raw comments envelope has been checked. */
export function normalizeTaskComments(values: unknown[]): TaskContextComment[] {
  return values.map((value, index) => {
    if (!isRecord(value)) throw new Error(`data.comments[${index}] must be an object`);
    return {
      createdAt: asText(value.created_at, `data.comments[${index}].created_at`, "unknown"),
      author: asText(value.author, `data.comments[${index}].author`, "unknown"),
      text: asText(value.text, `data.comments[${index}].text`),
    };
  });
}

export function buildTaskContext(task: TaskContextRecord, comments: TaskContextComment[]): string {
  let context = [
    `TASK ID: ${task.id}`,
    `TITLE: ${task.title}`,
    `TYPE: ${task.type}`,
    `PRIORITY: ${task.priority}`,
    "",
    "DESCRIPTION:",
    task.description,
  ].join("\n");

  const sections: Array<[string, string]> = [
    ["ACCEPTANCE CRITERIA:", task.acceptanceCriteria],
    ["DESIGN NOTES:", task.design],
    ["NOTES:", task.notes],
  ];
  for (const [heading, value] of sections) {
    if (value) context += `\n\n${heading}\n${value}`;
  }

  if (comments.length > 0) {
    const formatted = comments
      .map((comment) => `  [${comment.createdAt} ${comment.author}] ${comment.text}`)
      .join("\n");
    context += `\n\nCOMMENTS:\n${formatted}`;
  }

  return context;
}

function apiUrl(apiBase: string, path: string): string {
  let base: URL;
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

async function requestJson(
  url: string,
  headers: Record<string, string>,
  dependencies: TaskContextDependencies,
): Promise<unknown> {
  const fetchImpl = dependencies.fetch || globalThis.fetch;
  if (!fetchImpl) throw new Error("task context requires a fetch implementation");

  let response: Response;
  try {
    response = await fetchImpl(url, { headers });
  } catch (error) {
    throw new Error(`task API request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new Error(`task API request returned HTTP ${response.status}`);
  return parseRawTaskJson(await response.text());
}

export async function loadTaskContext(
  options: TaskContextOptions,
  dependencies: TaskContextDependencies = {},
): Promise<TaskContextResult> {
  const taskId = requireText(options.taskId, "taskId");
  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-namespace-id": options.namespaceId || "default",
    "x-org-id": options.orgId || "default",
  };
  if (options.authToken) headers.Authorization = `Bearer ${options.authToken}`;

  const rawTask = validateRawTaskEnvelope(await requestJson(
    apiUrl(options.apiBase, `/api/tasks/${encodeURIComponent(taskId)}`),
    headers,
    dependencies,
  ));
  const task = normalizeTaskRecord(rawTask.data.issue);

  let comments: TaskContextComment[] = [];
  try {
    const rawComments = validateRawCommentsEnvelope(await requestJson(
      apiUrl(options.apiBase, `/api/tasks/${encodeURIComponent(taskId)}/comments`),
      headers,
      dependencies,
    ));
    comments = normalizeTaskComments(rawComments.data.comments);
  } catch {
    // Comments are an optional enrichment. The task record remains usable when
    // this endpoint is unavailable, matching the task runner's prior behavior.
    comments = [];
  }

  return { task, comments, context: buildTaskContext(task, comments) };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/** Canonical typed task values for direct runner environment and shell handoff. */
export function taskContextEnvironment(result: TaskContextResult): Record<string, string> {
  return {
    TASK_ID: result.task.id,
    TASK_TITLE: result.task.title,
    TASK_DESCRIPTION: result.task.description,
    TASK_TYPE: result.task.type,
    TASK_PRIORITY: result.task.priority,
    TASK_ACCEPTANCE_CRITERIA: result.task.acceptanceCriteria,
    TASK_DESIGN: result.task.design,
    TASK_NOTES: result.task.notes,
    TASK_COMMENTS: result.comments
      .map((comment) => `  [${comment.createdAt} ${comment.author}] ${comment.text}`)
      .join("\n"),
    TASK_CONTEXT: result.context,
  };
}

/** Write a shell-safe, 0600, atomically replaced handoff for the invocation boundary. */
export function writeTaskContextEnv(path: string, result: TaskContextResult): void {
  if (!isAbsolute(path)) throw new Error(`task context env path must be absolute: ${path}`);
  const target = resolve(path);
  try {
    const stat = lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`task context env path must be a non-symlink regular file: ${target}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const parent = dirname(target);
  const parentStat = lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error(`task context env parent must be a non-symlink directory: ${parent}`);
  }

  const values = taskContextEnvironment(result);
  const body = [
    "# Typed task-context handoff; values are shell-quoted by TypeScript.",
    ...Object.entries(values).map(([key, value]) => `export ${key}=${shellQuote(value)}`),
    "",
  ].join("\n");

  const temporary = `${target}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    writeFileSync(temporary, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
    chmodSync(temporary, 0o600);
    renameSync(temporary, target);
    chmodSync(target, 0o600);
  } catch (error) {
    try {
      // Best-effort cleanup of the private temporary file only.
      if (existsSync(temporary)) {
        const stat = lstatSync(temporary);
        if (stat.isFile() && !stat.isSymbolicLink()) unlinkSync(temporary);
      }
    } catch {
      // Preserve the original failure; no fallback writer is permitted.
    }
    throw error;
  }
}
