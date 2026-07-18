import {
  existsSync,
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
import {
  isTerminalAgentAttemptPhase,
  type AgentAttemptPhase,
} from "@/lib/runner-v2/agent-attempt";

const invalidActiveSessionSelections = new WeakSet<Set<string>>();
const TERMINAL_RUN_STATUSES = new Set(["failed", "stopped", "completed", "cancelled"]);

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

/**
 * Select PTY identities owned by persisted runner records. Interactive project
 * terminals share the daemon, but they are not agent leases and must not
 * consume the execution cap.
 *
 * Terminal and pending records remain relevant: their persisted PTY may still
 * be alive while cleanup or admission recovery is in progress. Corrupt records
 * fail the selection closed through activeRunAgentSessionNamesScanInvalid.
 */
export function activeRunAgentSessionNames(runsDir: string): Set<string> {
  const canonicalRunsDir = canonicalizeRunsDir(runsDir);
  if (!existsSync(canonicalRunsDir)) return new Set();
  const names = new Set<string>();
  for (const entry of readdirSync(canonicalRunsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !isRunId(entry.name)) continue;
    let run: RunRecord;
    try {
      run = readRunRecordAt(canonicalRunsDir, entry.name);
    } catch {
      invalidActiveSessionSelections.add(names);
      break;
    }

    const terminalRun = TERMINAL_RUN_STATUSES.has(run.status);
    for (const agent of run.agents) {
      if (agent.session) names.add(agent.session);
    }

    const runnerV2 = run.runnerV2;
    if (!runnerV2 || typeof runnerV2 !== "object" || Array.isArray(runnerV2)) continue;
    const attempts = (runnerV2 as Record<string, unknown>).attempts;
    if (!Array.isArray(attempts)) continue;
    for (const candidate of attempts) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
      const attempt = candidate as Record<string, unknown>;
      if (attempt.runId !== run.id) continue;
      if (typeof attempt.phase !== "string") continue;
      if (!terminalRun && isTerminalAgentAttemptPhase(attempt.phase as AgentAttemptPhase)) continue;
      if (typeof attempt.leaseId === "string" && attempt.leaseId) names.add(attempt.leaseId);
      const evidence = attempt.processEvidence;
      if (evidence && typeof evidence === "object" && !Array.isArray(evidence)) {
        const ptySessionId = (evidence as Record<string, unknown>).ptySessionId;
        if (typeof ptySessionId === "string" && ptySessionId) names.add(ptySessionId);
      }
    }
  }
  return names;
}

export function activeRunAgentSessionNamesScanInvalid(names: Set<string>): boolean {
  return invalidActiveSessionSelections.has(names);
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
