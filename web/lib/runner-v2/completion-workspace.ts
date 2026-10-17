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

export function integrateCompletedNodeWorkspace(input: {
  run: RunRecord;
  runId: string;
  runDir: string;
  agentId: string;
  attemptId: string;
  now?: Date;
}): GitNodeIntegrationResult | undefined {
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
  if (persisted) return persisted;
  const node = readGitNodeWorkspace({
    runWorkspace,
    agentId: input.agentId,
    attemptId: input.attemptId,
  });
  const result = finalizeGitNodeWorkspace({ runWorkspace, node, now: input.now });
  const integration = integrateGitNodeWorkspaceResult({ runWorkspace, result, now: input.now });
  if (integration.status === "conflict") return integration;
  // Merge-back: land the chain delta on the main worktree now, so builders'
  // work is visible mid-run and the run-completion publication CAS degrades
  // to its already-published path. Source drift refuses the merge-back with a
  // durable receipt here, then blocks loudly through the existing publication
  // CAS conflict path — publication stays the correctness backstop. Apply or
  // verification failures still crash loudly.
  try {
    mergeGitNodeIntegration({ runWorkspace, integration, now: input.now });
  } catch (error) {
    if (!(error instanceof WorkspaceMergeBackDriftError)) throw error;
  }
  return integration;
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
}): GitNodeIntegrationResult | undefined {
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
