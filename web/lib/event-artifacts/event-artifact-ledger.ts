import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { basename, dirname, join, resolve } from "path";

export type EventArtifactExecutionStatus =
  | "artifact_pending"
  | "artifact_generated"
  | "actions_planned"
  | "awaiting_review"
  | "actions_applied"
  | "blocked_on_children"
  | "deduped"
  | "failed";

export interface EventArtifactExecutionRecord {
  id: string;
  mappingId: string;
  event: string;
  evaluatedDedupeKey: string;
  status: EventArtifactExecutionStatus;
  artifactPath?: string;
  draftTaskPath?: string;
  actionResults?: unknown[];
  error?: string;
  retryOf?: string;
  createdAt: string;
  updatedAt: string;
}

export function ledgerPathForArtifactsDir(artifactsDir: string): string {
  return join(artifactsDir, "event-artifact-executions.jsonl");
}

export function readExecutionRecords(artifactsDir: string): EventArtifactExecutionRecord[] {
  const path = ledgerPathForArtifactsDir(artifactsDir);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EventArtifactExecutionRecord);
}

export function findExecutionByDedupeKey(
  artifactsDir: string,
  dedupeKey: string,
): EventArtifactExecutionRecord | null {
  const records = readExecutionRecords(artifactsDir)
    .filter((record) => record.evaluatedDedupeKey === dedupeKey);
  return records[records.length - 1] || null;
}

export function appendExecutionRecord(
  artifactsDir: string,
  record: EventArtifactExecutionRecord,
): void {
  mkdirSync(artifactsDir, { recursive: true });
  const path = ledgerPathForArtifactsDir(artifactsDir);
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  writeFileAtomic(path, `${existing}${JSON.stringify(record)}\n`);
}

export function resolveArtifactOutputPath(artifactsDir: string, outputArtifact: string): string {
  if (outputArtifact !== basename(outputArtifact)) {
    throw new Error("artifact output must be a file name");
  }
  const root = resolve(artifactsDir);
  const out = resolve(root, outputArtifact);
  if (!out.startsWith(`${root}/`) && out !== root) {
    throw new Error("artifact output escapes artifacts dir");
  }
  return out;
}

export function writeJsonArtifact(path: string, value: unknown): void {
  writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFileAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}
