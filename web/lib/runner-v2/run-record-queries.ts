import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  canonicalizeRunsDir,
  isRunId,
  readRunRecordAt,
  type RunRecord,
} from "@/lib/runs/run-record";

export function runGoal(runJsonPath: string): string {
  return readExpectedRun(runJsonPath).goal;
}

export function runStatus(runJsonPath: string): string {
  return readExpectedRun(runJsonPath).status;
}

export function runWorkspacePath(runJsonPath: string): string {
  return readExpectedRun(runJsonPath).workspacePath || "";
}

export function runStartedAt(runJsonPath: string): string {
  return readExpectedRun(runJsonPath).started;
}

export function runCompletedAt(runJsonPath: string): string {
  return readExpectedRun(runJsonPath).completed || "";
}

export function completedAgentLines(runJsonPath: string): string {
  return readExpectedRun(runJsonPath).agents
    .filter((agent) => agent.status === "complete")
    .map((agent) => `- ${agent.name || agent.id} (${agent.id || "unknown"})`)
    .join("\n");
}

/**
 * Count canonical running records for admission. Any present but unreadable or
 * invalid run.json throws: admission must stop rather than treating corruption
 * as a free slot and exceeding the configured cap.
 */
export function countRunningRuns(runsDir: string, excludeRunId?: string): number {
  const canonicalRunsDir = canonicalizeRunsDir(runsDir);
  if (!existsSync(canonicalRunsDir)) return 0;
  return readdirSync(canonicalRunsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isRunId(entry.name) && entry.name !== excludeRunId)
    .map((entry) => readRunRecordAt(canonicalRunsDir, entry.name))
    .filter((run) => run.status === "running")
    .length;
}

export function githubErrorTitle(runJsonPath: string, agentId: string): string {
  const run = readExpectedRun(runJsonPath);
  return `Agent Error: ${agentId} failed in ${run.chain || "unknown"}`;
}

export function githubErrorBody(input: {
  runJsonPath: string;
  agentId: string;
  errorMessage: string;
  outputFile?: string;
  now?: Date;
}): string {
  const run = readExpectedRun(input.runJsonPath);
  const output = input.outputFile && existsSync(input.outputFile)
    ? tailLines(readFileSync(input.outputFile, "utf8"), 100)
    : "";
  const outputSection = output
    ? `\n\n## Agent Output (last 100 lines)\n${escapeMarkdownCode(output)}`
    : "";
  return [
    "## Agent Error Report",
    "",
    `**Run ID:** \`${run.id}\``,
    `**Agent:** \`${input.agentId}\``,
    `**Chain:** ${run.chain || "unknown"}`,
    `**Status:** ${run.status || "unknown"}`,
    `**Started:** ${run.started || "unknown"}`,
    "",
    "## Goal",
    run.goal || "no goal",
    "",
    "## Error",
    `${escapeMarkdownCode(input.errorMessage)}${outputSection}`,
    "",
    "## Run Info",
    Object.entries(run).map(([key, value]) => `- **${key}:** ${displayValue(value)}`).join("\n"),
    "",
    "---",
    "Created by mentiko github integration",
    `Timestamp: ${(input.now || new Date()).toISOString()}`,
  ].join("\n");
}

export function deleteRunsOwnedByUser(runsDir: string, userId: string): string[] {
  if (!userId) throw new Error("user id must not be empty");
  const canonicalRunsDir = canonicalizeRunsDir(runsDir);
  if (!existsSync(canonicalRunsDir)) return [];
  const deleted: string[] = [];
  for (const entry of readdirSync(canonicalRunsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !isRunId(entry.name)) continue;
    const run = readRunRecordAt(canonicalRunsDir, entry.name);
    if (run.user_id !== userId) continue;
    const runDir = join(canonicalRunsDir, entry.name);
    rmSync(runDir, { recursive: true });
    deleted.push(runDir);
  }
  return deleted;
}

/**
 * Delete canonical run directories whose directory mtime is at least `days`
 * old. Every candidate record is parsed and identity-validated before deletion;
 * corruption aborts the sweep instead of turning a path glob into authority.
 */
export function deleteRunsOlderThan(
  runsDir: string,
  days: number,
  now = new Date(),
): string[] {
  if (!Number.isSafeInteger(days) || days < 0) {
    throw new Error("run retention days must be a non-negative integer");
  }
  const canonicalRunsDir = canonicalizeRunsDir(runsDir);
  if (!existsSync(canonicalRunsDir)) return [];
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1_000;
  const deleted: string[] = [];
  for (const entry of readdirSync(canonicalRunsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !isRunId(entry.name)) continue;
    const runDir = join(canonicalRunsDir, entry.name);
    if (statSync(runDir).mtimeMs > cutoff) continue;
    readRunRecordAt(canonicalRunsDir, entry.name);
    rmSync(runDir, { recursive: true });
    deleted.push(runDir);
  }
  return deleted;
}

function readExpectedRun(runJsonPath: string): RunRecord {
  const runId = basename(dirname(runJsonPath));
  return readRunRecordAt(dirname(dirname(runJsonPath)), runId);
}

function tailLines(value: string, count: number): string {
  return value.split("\n").slice(-count).join("\n");
}

function escapeMarkdownCode(value: string): string {
  return value.replace(/`/g, "\\`").replace(/\\/g, "\\\\");
}

function displayValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
