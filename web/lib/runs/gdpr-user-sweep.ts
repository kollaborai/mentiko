import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { deleteRunsOwnedByUser } from "@/lib/runner-v2/run-record-queries";

function parseRecord(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function listEntries(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir) : [];
}

export function chainOwnedByUser(chainFile: string, userId: string): boolean {
  if (!existsSync(chainFile)) return false;
  return parseRecord(readFileSync(chainFile, "utf8"))?.created_by === userId;
}

export function conversationOwnedByUser(conversationFile: string, userId: string): boolean {
  if (!existsSync(conversationFile)) return false;
  return readFileSync(conversationFile, "utf8").split("\n").some((line) => (
    line.trim() !== "" && parseRecord(line)?.user_id === userId
  ));
}

export function decisionOwnedByUser(decisionFile: string, userId: string): boolean {
  if (!existsSync(decisionFile)) return false;
  return parseRecord(readFileSync(decisionFile, "utf8"))?.userId === userId;
}

export interface GdprUserSweepResult {
  artifactPaths: string[];
  runPaths: string[];
}

/**
 * Typed GDPR cleanup owner. It preserves the former sweep's ownership rules:
 * chain.json.created_by, any JSONL conversation user_id, decision.userId, and
 * RunRecord.user_id. Malformed artifacts are retained rather than guessed.
 */
export function sweepGdprUserData(namespaceRoot: string, userId: string): GdprUserSweepResult {
  if (!userId) throw new Error("user id must not be empty");
  const artifactPaths: string[] = [];

  const chainsDir = join(namespaceRoot, "chains");
  for (const name of listEntries(chainsDir)) {
    const chainDir = join(chainsDir, name);
    if (!statSync(chainDir).isDirectory() || !chainOwnedByUser(join(chainDir, "chain.json"), userId)) continue;
    rmSync(chainDir, { recursive: true, force: true });
    artifactPaths.push(chainDir);
  }

  const conversationsDir = join(namespaceRoot, "conversations");
  for (const name of listEntries(conversationsDir)) {
    const conversationFile = join(conversationsDir, name);
    if (!name.endsWith(".jsonl") || !conversationOwnedByUser(conversationFile, userId)) continue;
    rmSync(conversationFile, { force: true });
    artifactPaths.push(conversationFile);
  }

  const decisionsDir = join(namespaceRoot, "decisions");
  for (const name of listEntries(decisionsDir)) {
    const decisionFile = join(decisionsDir, name);
    if (!name.endsWith(".json") || !decisionOwnedByUser(decisionFile, userId)) continue;
    rmSync(decisionFile, { force: true });
    artifactPaths.push(decisionFile);
  }

  return { artifactPaths, runPaths: deleteRunsOwnedByUser(join(namespaceRoot, "runs"), userId) };
}

/** Queue cleanup after the response path without a shell child process. */
export function scheduleGdprUserSweep(namespaceRoot: string, userId: string): void {
  setImmediate(() => {
    try {
      const result = sweepGdprUserData(namespaceRoot, userId);
      for (const path of result.artifactPaths) console.info("[gdpr-sweep] removed artifact:", path);
      for (const path of result.runPaths) console.info("[gdpr-sweep] removed run:", path);
    } catch (error) {
      console.error("[gdpr] filesystem sweep failed:", error);
    }
  });
}
