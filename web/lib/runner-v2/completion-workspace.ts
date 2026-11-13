import type { RunRecord } from "@/lib/runner-v2/run-state";
import { cleanupGitNodeWorkspaceDurably } from "@/lib/runner-v2/workspace-cleanup";
import {
  currentGitRunIntegrationCommit,
  finalizeGitNodeWorkspace,
  initializeGitRunWorkspaceIsolation,
  integrateGitNodeWorkspaceResult,
  mergeGitNodeIntegration,
  publishGitRunWorkspaceResult,
  readGitNodeIntegrationResult,
  readGitNodeWorkspace,
  WorkspaceMergeBackDriftError,
  type GitNodeIntegrationResult,
  type GitRunWorkspacePublicationResult,
} from "@/lib/runner-v2/workspace-isolation";

export type CompletionWorkspaceIntegrationResult =
  | GitNodeIntegrationResult
  | (Omit<GitNodeIntegrationResult, "status"> & {
    status: "merge-back-refused";
    conflictArtifactPath: string;
  });

export function isWorkspaceIntegrationRefused(
  integration: CompletionWorkspaceIntegrationResult | undefined,
): integration is CompletionWorkspaceIntegrationResult & { status: "conflict" | "merge-back-refused" } {
  return integration?.status === "conflict" || integration?.status === "merge-back-refused";
}

const WORKSPACE_ACCEPTED_COMPLETION_ACTIONS = new Set([
  "fan-group-member",
  "route",
  "loop-complete",
  "max-rounds-stop",
  "terminal",
  "generation-terminal",
]);

export function completionActionAcceptsWorkspaceResult(action: string): boolean {
  return WORKSPACE_ACCEPTED_COMPLETION_ACTIONS.has(action);
}

function mergeBackNodeIntegration(
  runWorkspace: ReturnType<typeof initializeGitRunWorkspaceIsolation>,
  integration: GitNodeIntegrationResult,
  now?: Date,
): CompletionWorkspaceIntegrationResult {
  if (integration.status === "conflict") return integration;
  try {
    mergeGitNodeIntegration({ runWorkspace, integration, now });
    return integration;
  } catch (error) {
    if (!(error instanceof WorkspaceMergeBackDriftError)) throw error;
    return {
      ...integration,
      status: "merge-back-refused",
      conflictPaths: error.driftPaths,
      artifactPath: error.conflictArtifactPath,
      conflictArtifactPath: error.conflictArtifactPath,
    };
  }
}

export function integrateCompletedNodeWorkspace(input: {
  run: RunRecord;
  runId: string;
  runDir: string;
  agentId: string;
  attemptId: string;
  now?: Date;
}): CompletionWorkspaceIntegrationResult | undefined {
  const workspaceExecution = input.run.workspaceExecution;
  if (
    !workspaceExecution
    || workspaceExecution.tracking !== "git"
    || workspaceExecution.isolation !== "git-worktree"
  ) {
    return undefined;
  }

  const runWorkspace = initializeGitRunWorkspaceIsolation({
    runId: input.runId,
    runDir: input.runDir,
    baseline: workspaceExecution.baseline,
    now: input.now,
  });
  const persisted = readGitNodeIntegrationResult({
    runWorkspace,
    agentId: input.agentId,
    attemptId: input.attemptId,
  });
  if (persisted) return mergeBackNodeIntegration(runWorkspace, persisted, input.now);
  const node = readGitNodeWorkspace({
    runWorkspace,
    agentId: input.agentId,
    attemptId: input.attemptId,
  });
  const result = finalizeGitNodeWorkspace({ runWorkspace, node, now: input.now });
  const integration = integrateGitNodeWorkspaceResult({ runWorkspace, result, now: input.now });
  // Merge-back: land the chain delta on the main worktree now, so builders'
  // work is visible mid-run and the run-completion publication CAS degrades
  // to its already-published path. Source drift refuses the merge-back with a
  // durable receipt and is returned as an explicit blocked-completion result.
  // Publication remains the correctness backstop. Apply or verification
  // failures still crash loudly.
  return mergeBackNodeIntegration(runWorkspace, integration, input.now);
}

export function cleanupIntegratedNodeWorkspace(input: {
  run: RunRecord;
  runId: string;
  runDir: string;
  agentId: string;
  attemptId: string;
  now?: Date;
}): "removed" | "already-removed" | "preserved-conflict" | undefined {
  const workspaceExecution = input.run.workspaceExecution;
  if (
    !workspaceExecution
    || workspaceExecution.tracking !== "git"
    || workspaceExecution.isolation !== "git-worktree"
  ) {
    return undefined;
  }
  const runWorkspace = initializeGitRunWorkspaceIsolation({
    runId: input.runId,
    runDir: input.runDir,
    baseline: workspaceExecution.baseline,
    now: input.now,
  });
  return cleanupGitNodeWorkspaceDurably({
    runWorkspace,
    agentId: input.agentId,
    attemptId: input.attemptId,
    mode: "integrated",
    now: input.now,
  }).outcome;
}

export function integrateAcceptedCompletionWorkspace(input: {
  run: RunRecord;
  runId: string;
  runDir: string;
  agentId: string;
  attemptId: string;
  completionAction: string;
  dryRun?: boolean;
  now?: Date;
}): CompletionWorkspaceIntegrationResult | undefined {
  if (input.dryRun || !completionActionAcceptsWorkspaceResult(input.completionAction)) {
    return undefined;
  }
  return integrateCompletedNodeWorkspace(input);
}

export function publishCompletedRunWorkspace(input: {
  run: RunRecord;
  runId: string;
  runDir: string;
  now?: Date;
}): GitRunWorkspacePublicationResult | undefined {
  const workspaceExecution = input.run.workspaceExecution;
  if (
    !workspaceExecution
    || workspaceExecution.tracking !== "git"
    || workspaceExecution.isolation !== "git-worktree"
  ) {
    return undefined;
  }
  const runWorkspace = initializeGitRunWorkspaceIsolation({
    runId: input.runId,
    runDir: input.runDir,
    baseline: workspaceExecution.baseline,
    now: input.now,
  });
  return publishGitRunWorkspaceResult({
    runWorkspace,
    baseline: workspaceExecution.baseline,
    now: input.now,
  });
}

export function currentRunWorkspaceCommit(input: {
  run: RunRecord;
  runId: string;
  runDir: string;
  now?: Date;
}): string | undefined {
  const workspaceExecution = input.run.workspaceExecution;
  if (
    !workspaceExecution
    || workspaceExecution.tracking !== "git"
    || workspaceExecution.isolation !== "git-worktree"
  ) {
    return undefined;
  }
  const runWorkspace = initializeGitRunWorkspaceIsolation({
    runId: input.runId,
    runDir: input.runDir,
    baseline: workspaceExecution.baseline,
    now: input.now,
  });
  return currentGitRunIntegrationCommit(runWorkspace);
}
