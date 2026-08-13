import type {
  GitWorkspaceChangeSet,
  GitWorkspaceSnapshot,
} from "@/lib/runner-v2/workspace-snapshot";

export const WORKSPACE_EVIDENCE_VERSION = 1 as const;

export interface WorkspaceHandoffRecord {
  attemptId: string;
  agentId: string;
  capturedAt: string;
  artifactPath: string;
  tracking: "git" | "unavailable";
  nodeWorkspaceRecordPath?: string;
}

interface WorkspaceExecutionBase {
  version: typeof WORKSPACE_EVIDENCE_VERSION;
  sourceWorkspacePath?: string;
  baselineArtifactPath: string;
  isolation: "shared" | "git-worktree";
  concurrentWritesIsolated: boolean;
  handoffs: WorkspaceHandoffRecord[];
}

export interface GitWorkspaceExecutionRecord extends WorkspaceExecutionBase {
  tracking: "git";
  sourceWorkspacePath: string;
  baseline: GitWorkspaceSnapshot;
  isolationStatePath?: string;
  baselineRef?: string;
  integrationRef?: string;
}

export interface UnavailableWorkspaceExecutionRecord extends WorkspaceExecutionBase {
  tracking: "unavailable";
  reason: string;
  recordedAt: string;
}

export type WorkspaceExecutionRecord =
  | GitWorkspaceExecutionRecord
  | UnavailableWorkspaceExecutionRecord;

interface WorkspaceHandoffArtifactBase {
  version: typeof WORKSPACE_EVIDENCE_VERSION;
  kind: "workspace-handoff";
  runId: string;
  agentId: string;
  attemptId: string;
  capturedAt: string;
  artifactPath: string;
  baselineArtifactPath: string;
  isolation: "shared" | "git-worktree";
  concurrentWritesIsolated: boolean;
}

export interface GitWorkspaceHandoffArtifact extends WorkspaceHandoffArtifactBase {
  tracking: "git";
  workspacePath: string;
  nodeBaseCommit?: string;
  nodeWorkspaceRecordPath?: string;
  baseline: GitWorkspaceSnapshot;
  observed: GitWorkspaceSnapshot;
  changeSet: GitWorkspaceChangeSet;
}

export interface UnavailableWorkspaceHandoffArtifact extends WorkspaceHandoffArtifactBase {
  tracking: "unavailable";
  reason: string;
}

export type WorkspaceHandoffArtifact =
  | GitWorkspaceHandoffArtifact
  | UnavailableWorkspaceHandoffArtifact;
