import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  renameSync,
} from "fs";
import path from "path";
import crypto from "crypto";
import config, { encodeProjectPath, orgPath } from "../config";
import type { Decision } from "./decision-types";

// async file-based lock with timeout + retry (no busy-wait)
const LOCK_TIMEOUT_MS = 5000;
const LOCK_STALE_MS = 10000; // 2x timeout for stale detection
const LOCK_RETRY_INTERVAL_MS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireLock(lockPath: string): Promise<boolean> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      // wx flag = exclusive create - fails if file exists (atomic)
      writeFileSync(lockPath, `${process.pid}.${Date.now()}`, { flag: "wx" });
      return true;
    } catch {
      // lock exists - check if stale (use 2x timeout to avoid racing active holders)
      try {
        const content = readFileSync(lockPath, "utf-8");
        const ts = parseInt(content.split(".").pop() || "0", 10);
        if (Date.now() - ts > LOCK_STALE_MS) {
          try { unlinkSync(lockPath); } catch { /* race */ }
          continue;
        }
      } catch { /* lock gone, retry */ }
    }
    const wait = Math.min(LOCK_RETRY_INTERVAL_MS, deadline - Date.now());
    if (wait > 0) await sleep(wait);
  }
  return false;
}

function releaseLock(lockPath: string): void {
  try { unlinkSync(lockPath); } catch { /* already removed */ }
}

/**
 * Get workspace-scoped decisions directory.
 * Uses the same project path resolution as config.ts:
 * - workspace path == codeRoot -> orgRoot/decisions (default project collapses)
 * - workspace path != codeRoot -> orgRoot/projects/<encoded>/decisions
 *
 * @param nsId - namespace ID (from request headers, not config.namespaceId)
 * @param orgId - org ID (from request headers, not config.orgId)
 * @param workspacePath - optional workspace path for project-scoped resolution
 */
function getDecisionsDir(nsId: string, orgId: string, workspacePath?: string): string {
  if (!workspacePath || workspacePath === config.codeRoot) {
    // derive from request-scoped nsId + orgId instead of process-env config.decisionsDir
    return orgPath(nsId, orgId, "decisions");
  }
  const encoded = encodeProjectPath(workspacePath);
  return orgPath(nsId, orgId, "projects", encoded, "decisions");
}

function getDecisionFile(nsId: string, orgId: string, id: string, workspacePath?: string): string {
  return path.join(getDecisionsDir(nsId, orgId, workspacePath), `${id}.json`);
}

interface DecisionLocation {
  decision: Decision;
  filePath: string;
  workspacePath?: string;
}

function readDecisionFile(filePath: string): Decision | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as Decision;
  } catch {
    return null;
  }
}

function findDecisionLocation(
  nsId: string,
  orgId: string,
  id: string,
  workspacePath?: string,
): DecisionLocation | null {
  const candidates: string[] = [];
  const addCandidate = (filePath: string) => {
    if (!candidates.includes(filePath)) candidates.push(filePath);
  };

  addCandidate(getDecisionFile(nsId, orgId, id, workspacePath));

  // Completion-audit decisions are namespace/global records. Task detail views
  // still pass the current workspace, so a workspace-only lookup makes those
  // decision subtasks open to "decision not found".
  if (workspacePath) {
    addCandidate(getDecisionFile(nsId, orgId, id));
  }

  const projectsDir = orgPath(nsId, orgId, "projects");
  if (existsSync(projectsDir)) {
    for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      addCandidate(path.join(projectsDir, entry.name, "decisions", `${id}.json`));
    }
  }

  for (const filePath of candidates) {
    const decision = readDecisionFile(filePath);
    if (decision) {
      return {
        decision,
        filePath,
        workspacePath: decision.workspacePath ?? workspacePath,
      };
    }
  }

  return null;
}

export function listDecisions(nsId: string, orgId: string, workspacePath?: string): Decision[] {
  const dir = getDecisionsDir(nsId, orgId, workspacePath);
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const decisions: Decision[] = [];

  for (const file of files) {
    try {
      const raw = readFileSync(path.join(dir, file), "utf-8");
      decisions.push(JSON.parse(raw) as Decision);
    } catch {
      continue;
    }
  }

  return decisions.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function getDecision(nsId: string, orgId: string, id: string, workspacePath?: string): Decision | null {
  return findDecisionLocation(nsId, orgId, id, workspacePath)?.decision ?? null;
}

export function createDecision(
  nsId: string,
  orgId: string,
  input: { prompt: string; source?: string; id?: string },
  workspacePath?: string
): Decision {
  const dir = getDecisionsDir(nsId, orgId, workspacePath);
  mkdirSync(dir, { recursive: true });

  const id = input.id || crypto.randomUUID();
  const filePath = path.join(dir, `${id}.json`);
  if (input.id && existsSync(filePath)) {
    return JSON.parse(readFileSync(filePath, "utf8")) as Decision;
  }

  const now = new Date().toISOString();
  const decision: Decision = {
    id,
    status: "intake",
    prompt: input.prompt,
    title: input.prompt,
    source: input.source,
    createdAt: now,
    updatedAt: now,
    options: [],
    ...(workspacePath ? { workspacePath } : {}),
  };

  try {
    writeFileSync(filePath, JSON.stringify(decision, null, 2), input.id ? { flag: "wx" } : undefined);
  } catch (error) {
    if (input.id && existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, "utf8")) as Decision;
    }
    throw error;
  }
  return decision;
}

export async function updateDecision(
  nsId: string,
  orgId: string,
  id: string,
  updates: Partial<Decision>,
  workspacePath?: string
): Promise<Decision> {
  const location = findDecisionLocation(nsId, orgId, id, workspacePath);
  const filePath = location?.filePath ?? getDecisionFile(nsId, orgId, id, workspacePath);
  const lockPath = `${filePath}.lock`;

  if (!location) {
    throw new Error(`Decision ${id} not found`);
  }

  if (!(await acquireLock(lockPath))) {
    throw new Error(`Failed to acquire lock for decision ${id}`);
  }

  try {
    // re-read inside lock to avoid lost updates
    const raw = readFileSync(filePath, "utf-8");
    let existing: Decision;
    try {
      existing = JSON.parse(raw) as Decision;
    } catch {
      throw new Error(`Decision ${id} has corrupt JSON`);
    }

    const updated: Decision = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };

    // atomic write: tmp + rename
    const tmpPath = `${filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(updated, null, 2));
    renameSync(tmpPath, filePath);
    return updated;
  } finally {
    releaseLock(lockPath);
  }
}

export function deleteDecision(nsId: string, orgId: string, id: string, workspacePath?: string): void {
  const location = findDecisionLocation(nsId, orgId, id, workspacePath);
  if (location && existsSync(location.filePath)) unlinkSync(location.filePath);
}
