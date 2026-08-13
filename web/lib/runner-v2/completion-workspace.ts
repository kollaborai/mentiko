import type { RunRecord } from "@/lib/runner-v2/run-state";
import { cleanupGitNodeWorkspaceDurably } from "@/lib/runner-v2/workspace-cleanup";
import {
  currentGitRunIntegrationCommit,
  finalizeGitNodeWorkspace,
  initializeGitRunWorkspaceIsolation,
  integrateGitNodeWorkspaceResult,
  publishGitRunWorkspaceResult,
  readGitNodeIntegrationResult,
  readGitNodeWorkspace,
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
  return integrateGitNodeWorkspaceResult({ runWorkspace, result, now: input.now });
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
