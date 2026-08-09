import { randomBytes } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { RunRecord } from "@/lib/runs/run-record";
import { readRunJson, updateRunJson } from "@/lib/runner-v2/run-state";
import {
  captureGitWorkspaceSnapshot,
  compareGitWorkspaceSnapshots,
  createWorkspaceSnapshotScratchDir,
} from "@/lib/runner-v2/workspace-snapshot";
import {
  WORKSPACE_EVIDENCE_VERSION,
  type WorkspaceExecutionRecord,
  type WorkspaceHandoffArtifact,
} from "@/lib/runner-v2/workspace-evidence-types";

interface EnsureRunWorkspaceBaselineInput {
  runJsonPath: string;
  runDir: string;
  runId: string;
  workspacePath?: string;
  now?: Date;
}

interface CaptureAgentWorkspaceHandoffInput {
  runJsonPath: string;
  runDir: string;
  runId: string;
  agentId: string;
  attemptId: string;
  workspaceExecution: WorkspaceExecutionRecord;
  now?: Date;
}

export class WorkspaceEvidenceError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "WorkspaceEvidenceError";
  }
}

function executionRecord(run: RunRecord): WorkspaceExecutionRecord | undefined {
  return run.workspaceExecution;
}

function priorExecutionEvidence(run: RunRecord): boolean {
  const runnerV2 = run.runnerV2 as { attempts?: unknown[] } | undefined;
  if (Array.isArray(runnerV2?.attempts) && runnerV2.attempts.length > 0) return true;
  if ((run.sessions || []).some((session) => typeof session === "string" && session.length > 0)) return true;
  return run.agents.some((agent) => agent.status !== "pending" || Boolean(agent.session));
}

function unavailableRecord(input: {
  sourceWorkspacePath?: string;
  baselineArtifactPath: string;
  reason: string;
  recordedAt: string;
}): WorkspaceExecutionRecord {
  return {
    version: WORKSPACE_EVIDENCE_VERSION,
    tracking: "unavailable",
    ...(input.sourceWorkspacePath ? { sourceWorkspacePath: input.sourceWorkspacePath } : {}),
    baselineArtifactPath: input.baselineArtifactPath,
    isolation: "shared",
    concurrentWritesIsolated: false,
    reason: input.reason,
    recordedAt: input.recordedAt,
    handoffs: [],
  };
}

function baselineArtifact(runId: string, record: WorkspaceExecutionRecord): Record<string, unknown> {
  const common = {
    version: WORKSPACE_EVIDENCE_VERSION,
    kind: "workspace-baseline",
    runId,
    tracking: record.tracking,
    ...(record.sourceWorkspacePath ? { sourceWorkspacePath: record.sourceWorkspacePath } : {}),
    baselineArtifactPath: record.baselineArtifactPath,
    isolation: record.isolation,
    concurrentWritesIsolated: record.concurrentWritesIsolated,
  };
  return record.tracking === "git"
    ? { ...common, baseline: record.baseline }
    : { ...common, reason: record.reason, recordedAt: record.recordedAt };
}

function writeJsonOnce<T>(path: string, value: T): T {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tempPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
  );
  try {
    writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    try {
      linkSync(tempPath, path);
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return JSON.parse(readFileSync(path, "utf8")) as T;
    }
  } finally {
    try {
      unlinkSync(tempPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function assertRunIdentity(run: RunRecord | undefined, runId: string): RunRecord {
  if (!run) throw new WorkspaceEvidenceError(`run ${runId} is missing while recording workspace evidence`);
  if (run.id !== runId) {
    throw new WorkspaceEvidenceError(`workspace evidence run id ${runId} does not match ${run.id}`);
  }
  return run;
}

/**
 * Establish the immutable run boundary before the first AgentAttempt exists.
 * Existing launch evidence fails closed to an explicit unavailable record: a
 * late snapshot would relabel prior user or agent work as this run's baseline.
 */
export function ensureRunWorkspaceBaseline(
  input: EnsureRunWorkspaceBaselineInput,
): WorkspaceExecutionRecord {
  const initial = assertRunIdentity(readRunJson(input.runJsonPath), input.runId);
  const existing = executionRecord(initial);
  if (existing) {
    writeJsonOnce(existing.baselineArtifactPath, baselineArtifact(input.runId, existing));
    return existing;
  }

  const recordedAt = (input.now || new Date()).toISOString();
  const sourceWorkspacePath = input.workspacePath ? resolve(input.workspacePath) : undefined;
  const baselineArtifactPath = join(input.runDir, "artifacts", "workspace-baseline.json");
  let candidate: WorkspaceExecutionRecord;

  if (priorExecutionEvidence(initial)) {
    candidate = unavailableRecord({
      sourceWorkspacePath,
      baselineArtifactPath,
      recordedAt,
      reason: "run already has durable launch or agent execution evidence; refusing a late workspace baseline",
    });
  } else if (!sourceWorkspacePath) {
    candidate = unavailableRecord({
      baselineArtifactPath,
      recordedAt,
      reason: "run has no registered local workspace path",
    });
  } else {
    try {
      const baseline = captureGitWorkspaceSnapshot({
        workspacePath: sourceWorkspacePath,
        scratchDir: createWorkspaceSnapshotScratchDir(input.runDir),
        label: `${input.runId}-baseline`,
        capturedAt: recordedAt,
      });
      candidate = {
        version: WORKSPACE_EVIDENCE_VERSION,
        tracking: "git",
        sourceWorkspacePath: baseline.sourceWorkspacePath,
        baselineArtifactPath,
        isolation: "shared",
        concurrentWritesIsolated: false,
        baseline,
        handoffs: [],
      };
    } catch (error) {
      candidate = unavailableRecord({
        sourceWorkspacePath,
        baselineArtifactPath,
        recordedAt,
        reason: error instanceof Error ? error.message : "workspace snapshot capture failed",
      });
    }
  }

  const persistedRun = updateRunJson(input.runJsonPath, (current) => {
    const run = assertRunIdentity(current, input.runId);
    if (executionRecord(run)) return run;
    const selected = priorExecutionEvidence(run) && candidate.tracking === "git"
      ? unavailableRecord({
        sourceWorkspacePath,
        baselineArtifactPath,
        recordedAt,
        reason: "launch evidence appeared before the workspace baseline claim; refusing a late capture",
      })
      : candidate;
    return { ...run, workspaceExecution: selected };
  });
  const persisted = executionRecord(persistedRun);
  if (!persisted) throw new WorkspaceEvidenceError(`run ${input.runId} did not persist workspace evidence`);
  writeJsonOnce(persisted.baselineArtifactPath, baselineArtifact(input.runId, persisted));
  return persisted;
}

function safeArtifactSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 180) || "attempt";
}

function readHandoffArtifact(path: string, input: CaptureAgentWorkspaceHandoffInput): WorkspaceHandoffArtifact {
  let artifact: WorkspaceHandoffArtifact;
  try {
    artifact = JSON.parse(readFileSync(path, "utf8")) as WorkspaceHandoffArtifact;
  } catch (error) {
    throw new WorkspaceEvidenceError(`workspace handoff artifact is unreadable: ${path}`, error);
  }
  if (
    artifact.kind !== "workspace-handoff"
    || artifact.runId !== input.runId
    || artifact.agentId !== input.agentId
    || artifact.attemptId !== input.attemptId
  ) {
    throw new WorkspaceEvidenceError(`workspace handoff artifact identity mismatch: ${path}`);
  }
  return artifact;
}

/** Capture the exact shared-workspace state handed to one agent occurrence. */
export function captureAgentWorkspaceHandoff(
  input: CaptureAgentWorkspaceHandoffInput,
): WorkspaceHandoffArtifact {
  const current = assertRunIdentity(readRunJson(input.runJsonPath), input.runId);
  const existingHandoff = executionRecord(current)?.handoffs.find(
    (handoff) => handoff.attemptId === input.attemptId,
  );
  if (existingHandoff) {
    if (!existsSync(existingHandoff.artifactPath)) {
      throw new WorkspaceEvidenceError(`workspace handoff record has no artifact: ${existingHandoff.artifactPath}`);
    }
    return readHandoffArtifact(existingHandoff.artifactPath, input);
  }

  const artifactPath = join(
    input.runDir,
    "artifacts",
    `${safeArtifactSegment(input.agentId)}-workspace-start-${safeArtifactSegment(input.attemptId)}.json`,
  );
  const capturedAt = (input.now || new Date()).toISOString();
  const common = {
    version: WORKSPACE_EVIDENCE_VERSION,
    kind: "workspace-handoff" as const,
    runId: input.runId,
    agentId: input.agentId,
    attemptId: input.attemptId,
    capturedAt,
    artifactPath,
    baselineArtifactPath: input.workspaceExecution.baselineArtifactPath,
    isolation: "shared" as const,
    concurrentWritesIsolated: false as const,
  };

  let candidate: WorkspaceHandoffArtifact;
  if (input.workspaceExecution.tracking === "unavailable") {
    candidate = {
      ...common,
      tracking: "unavailable",
      reason: input.workspaceExecution.reason,
    };
  } else {
    try {
      const observed = captureGitWorkspaceSnapshot({
        workspacePath: input.workspaceExecution.sourceWorkspacePath,
        scratchDir: createWorkspaceSnapshotScratchDir(input.runDir),
        label: input.attemptId,
        capturedAt,
      });
      candidate = {
        ...common,
        tracking: "git",
        baseline: input.workspaceExecution.baseline,
        observed,
        changeSet: compareGitWorkspaceSnapshots(input.workspaceExecution.baseline, observed),
      };
    } catch (error) {
      candidate = {
        ...common,
        tracking: "unavailable",
        reason: error instanceof Error ? error.message : "workspace handoff capture failed",
      };
    }
  }

  const artifact = writeJsonOnce(artifactPath, candidate);
  if (
    artifact.kind !== "workspace-handoff"
    || artifact.runId !== input.runId
    || artifact.agentId !== input.agentId
    || artifact.attemptId !== input.attemptId
  ) {
    throw new WorkspaceEvidenceError(`workspace handoff artifact identity mismatch: ${artifactPath}`);
  }

  updateRunJson(input.runJsonPath, (runValue) => {
    const run = assertRunIdentity(runValue, input.runId);
    const workspaceExecution = executionRecord(run);
    if (!workspaceExecution) {
      throw new WorkspaceEvidenceError(`run ${input.runId} lost its workspace baseline before handoff`);
    }
    if (workspaceExecution.handoffs.some((handoff) => handoff.attemptId === input.attemptId)) return run;
    return {
      ...run,
      workspaceExecution: {
        ...workspaceExecution,
        handoffs: [
          ...workspaceExecution.handoffs,
          {
            attemptId: input.attemptId,
            agentId: input.agentId,
            capturedAt: artifact.capturedAt,
            artifactPath: artifact.artifactPath,
            tracking: artifact.tracking,
          },
        ],
      },
    };
  });
  return artifact;
}
