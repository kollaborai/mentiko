import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { resolveLinkRunsDir } from "@/lib/links/link-run-runtime";
import { isNonExecutionRun } from "@/lib/runs/run-provenance";

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

export function currentRunTerminalFingerprint(
  namespaceId: string,
  orgId: string,
  runId: string,
): string {
  const run = metadataRecord(readJsonFile(join(runDirPath(namespaceId, orgId, runId), "run.json")));
  const status = typeof run.status === "string" ? run.status : "unknown";
  const completed = typeof run.completed === "string" ? run.completed : "";
  const updatedAt = typeof run.updatedAt === "string" ? run.updatedAt : "";
  return [status, completed || updatedAt || "no-terminal-time"].join(":");
}

export function currentRunStatus(
  namespaceId: string,
  orgId: string,
  runId: string,
): string {
  const run = metadataRecord(readJsonFile(join(runDirPath(namespaceId, orgId, runId), "run.json")));
  return typeof run.status === "string" ? run.status : "unknown";
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
): boolean {
  const run = metadataRecord(readJsonFile(join(runDirPath(namespaceId, orgId, runId), "run.json")));
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
): unknown {
  const p = join(runDirPath(namespaceId, orgId, runId), "artifacts", "run-summary.json");
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
): unknown {
  const runDir = runDirPath(namespaceId, orgId, runId);
  const run = metadataRecord(readJsonFile(join(runDir, "run.json")));
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
