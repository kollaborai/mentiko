import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { resolveLinkRunsDir } from "@/lib/links/link-run-runtime";
import { isNonExecutionRun } from "@/lib/runs/run-provenance";
import {
  locateTaskRun,
  parseTaskRunScope,
  TaskRunScopeError,
} from "./task-run-locator";

export interface RunArtifactEvidence {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
}

export function metadataRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readJsonFile(filePath: string): unknown {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function runDirPath(namespaceId: string, orgId: string, runId: string): string {
  return join(resolveLinkRunsDir(namespaceId, orgId), runId);
}

interface RunEvidenceLocation {
  runDir: string;
  run?: Record<string, unknown>;
}

function persistedTaskRunScope(taskMetadata: unknown) {
  const metadata = metadataRecord(taskMetadata);
  if (!("task_run_scope" in metadata)) return undefined;
  return parseTaskRunScope(metadata.task_run_scope);
}

/**
 * A persisted task-run scope is authoritative evidence. It is resolved directly
 * and validated by the locator; it must never broaden into another root search.
 */
function locateRunEvidence(
  namespaceId: string,
  orgId: string,
  runId: string,
  taskMetadata?: unknown,
): RunEvidenceLocation {
  const scope = persistedTaskRunScope(taskMetadata);
  if (!scope) return { runDir: runDirPath(namespaceId, orgId, runId) };
  if (scope.runId !== runId) {
    throw new TaskRunScopeError(
      "runId",
      "Task run scope runId must match the run evidence request.",
    );
  }
  const located = locateTaskRun(scope);
  return { runDir: located.runDir, run: located.run };
}

function runEvidenceRecord(location: RunEvidenceLocation): Record<string, unknown> {
  return location.run || metadataRecord(readJsonFile(join(location.runDir, "run.json")));
}

export function currentRunTerminalFingerprint(
  namespaceId: string,
  orgId: string,
  runId: string,
  taskMetadata?: unknown,
): string {
  const run = runEvidenceRecord(locateRunEvidence(namespaceId, orgId, runId, taskMetadata));
  const status = typeof run.status === "string" ? run.status : "unknown";
  const completed = typeof run.completed === "string" ? run.completed : "";
  const updatedAt = typeof run.updatedAt === "string" ? run.updatedAt : "";
  return [status, completed || updatedAt || "no-terminal-time"].join(":");
}

export function currentRunStatus(
  namespaceId: string,
  orgId: string,
  runId: string,
  taskMetadata?: unknown,
): string {
  const run = runEvidenceRecord(locateRunEvidence(namespaceId, orgId, runId, taskMetadata));
  return typeof run.status === "string" ? run.status : "unknown";
}

export const OUTCOME_SUMMARY_TERMINAL_STATUSES = new Set([
  "completed",
  "complete",
  // A blocked run is terminal even though its PTY may be deliberately retained
  // for recovery. The outcome auditor must receive the cause; treating it as
  // in-flight leaves the task without its terminal summary indefinitely.
  "blocked",
  "failed",
  "stopped",
  "deleted",
  "unknown",
  "cancelled",
]);

export function isOutcomeSummaryTerminalStatus(status: string): boolean {
  return OUTCOME_SUMMARY_TERMINAL_STATUSES.has(status);
}

export interface OutcomeSummarySourceEligibility {
  eligible: boolean;
  status: string;
  fingerprint: string;
  reason?: string;
}

/** Revalidate the execution source at delivery time; summary jobs may finish after their source changes. */
export function outcomeSummarySourceEligibility(
  namespaceId: string,
  orgId: string,
  runId: string,
  expectedFingerprint?: string,
  taskMetadata?: unknown,
): OutcomeSummarySourceEligibility {
  const status = currentRunStatus(namespaceId, orgId, runId, taskMetadata);
  const fingerprint = currentRunTerminalFingerprint(namespaceId, orgId, runId, taskMetadata);
  if (!isOutcomeSummaryTerminalStatus(status)) {
    return {
      eligible: false,
      status,
      fingerprint,
      reason: `execution run ${runId} is ${status}; outcome summary requires a terminal run`,
    };
  }
  if (expectedFingerprint && expectedFingerprint !== fingerprint) {
    return {
      eligible: false,
      status,
      fingerprint,
      reason: `execution run ${runId} changed from ${expectedFingerprint} to ${fingerprint}`,
    };
  }
  return { eligible: true, status, fingerprint };
}

const NON_EXECUTION_CHAIN_IDS = new Set([
  "run-summary-generation",
  "chain-recommendation",
  "chain-generation",
  "task-generation",
  "decision-research",
]);

export function isOutcomeSummaryExecutionSource(
  namespaceId: string,
  orgId: string,
  runId: string,
  taskMetadata?: unknown,
): boolean {
  const run = runEvidenceRecord(locateRunEvidence(namespaceId, orgId, runId, taskMetadata));
  if (!Object.keys(run).length) return false;
  const chainId = typeof run.chainId === "string" ? run.chainId : "";
  const chain = typeof run.chain === "string" ? run.chain : "";
  if (NON_EXECUTION_CHAIN_IDS.has(chainId) || NON_EXECUTION_CHAIN_IDS.has(chain)) return false;
  return !isNonExecutionRun(run);
}

export function currentRunSummary(
  namespaceId: string,
  orgId: string,
  runId: string,
  fallback: unknown,
  taskMetadata?: unknown,
): unknown {
  const { runDir } = locateRunEvidence(namespaceId, orgId, runId, taskMetadata);
  const p = join(runDir, "artifacts", "run-summary.json");
  return readJsonFile(p) || fallback || null;
}

function listArtifactFiles(root: string, dir: string, out: RunArtifactEvidence[], limit: number) {
  if (out.length >= limit || !existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (out.length >= limit) return;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      listArtifactFiles(root, fullPath, out, limit);
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      const stat = statSync(fullPath);
      const rel = relative(root, fullPath);
      out.push({
        path: rel,
        name: entry.name,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
    } catch {
      // Best effort: artifact evidence should never block the auditor.
    }
  }
}

export function currentRunArtifacts(
  namespaceId: string,
  orgId: string,
  runId: string,
  fallback: unknown,
  taskMetadata?: unknown,
): unknown {
  const location = locateRunEvidence(namespaceId, orgId, runId, taskMetadata);
  const runDir = location.runDir;
  const run = runEvidenceRecord(location);
  const fromRunJson = Array.isArray(run.artifacts) ? run.artifacts : [];
  const fromFallback = Array.isArray(fallback) ? fallback : [];
  const fromDisk: RunArtifactEvidence[] = [];
  listArtifactFiles(runDir, join(runDir, "artifacts"), fromDisk, 200);

  if (fromRunJson.length === 0 && fromFallback.length === 0) return fromDisk;
  return {
    runJson: fromRunJson,
    metadata: fromFallback,
    disk: fromDisk,
  };
}
