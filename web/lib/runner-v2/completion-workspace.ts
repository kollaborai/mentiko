import type { RunRecord } from "@/lib/runner-v2/run-state";
import {
  finalizeGitNodeWorkspace,
  initializeGitRunWorkspaceIsolation,
  integrateGitNodeWorkspaceResult,
  publishGitRunWorkspaceResult,
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
  const node = readGitNodeWorkspace({
    runWorkspace,
    agentId: input.agentId,
    attemptId: input.attemptId,
  });
  const result = finalizeGitNodeWorkspace({ runWorkspace, node, now: input.now });
  return integrateGitNodeWorkspaceResult({ runWorkspace, result, now: input.now });
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
