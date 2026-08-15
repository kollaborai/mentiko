import { spawnSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { isDeepStrictEqual } from "util";
import { runQualityGateEventArtifact } from "@/lib/event-artifacts/event-artifact-runner";
import { applyTypedExecutorPlan, GenerationImportError, killAgentSessions, readTypedRetryAttempt, type AdapterResult } from "@/lib/runner-v2/adapters";
import { adoptAgentAttemptForCompletion, isTerminalAgentAttemptPhase, markAgentAttemptCompletedFromGeneration, readRunnerV2AttemptState, releaseAgentCapacitySlot, resolveAgentAttemptForCompletion, transitionAgentAttempt, type AgentAttemptRecord } from "@/lib/runner-v2/agent-attempt";
import { agentOwnsEvent } from "@/lib/runner-v2/completion";
import { runCompletionPipeline, type CompletionPipelineResult } from "@/lib/runner-v2/completion-pipeline";
import type { AgentLivenessInput, CompletionRecoveryEvidence } from "@/lib/runner-v2/completion-runner";
import { scanRunnerEventFiles } from "@/lib/runner-v2/event-lifecycle";
import { eventMatchesRunId, type RunnerEventRecord } from "@/lib/runner-v2/events";
import { buildTypedExecutorPlan, type TypedExecutorPlan } from "@/lib/runner-v2/executor";
import { captureHash, monitorStatePaths } from "@/lib/runner-v2/monitor-io";
import {
  assertRunAgentAttemptCurrent,
  readRunJson,
  StaleRunAgentAttemptError,
  updateRunAgent,
  updateRunJson,
  updateRunStatus,
  type RunAgentAttemptGuard,
  type RunAgentRecord,
  type RunJsonMutation,
  type RunMutationObserver,
  type RunRecord,
} from "@/lib/runner-v2/run-state";
import { livePendingHandoffAgentIds } from "@/lib/runner-v2/handoff-liveness";
import { evaluateQualityGate, type AgentSummary } from "@/lib/runner-v2/quality-gate";
import { readLoopState, restoreLoopMutations, type LoopFileMutation, type LoopMutationObserver } from "@/lib/runner-v2/loop-state";
import { listFanGroups, readFanGroup } from "@/lib/runner-v2/fan-group-store";
import type { RoutingChain } from "@/lib/runner-v2/routing";
import { runnerV2PtyEnv } from "@/lib/runner-v2/pty-scope";
import { isPayloadCompatibleWithKind } from "@/lib/generation/payload-contract";
import { shouldRecordTaskExecutionMetadata } from "@/lib/runs/run-provenance";
import { triggerDecisionImportReplay } from "@/lib/decisions/decision-auto-advance";
import type { OnCompletePolicy, TerminalCompletionInput } from "@/lib/runner-v2/terminal-plan";
import config from "@/lib/config";
import {
  cleanupIntegratedNodeWorkspace,
  currentRunWorkspaceCommit,
  integrateAcceptedCompletionWorkspace,
  integrateCompletedNodeWorkspace,
  publishCompletedRunWorkspace,
} from "@/lib/runner-v2/completion-workspace";
import type {
  GitNodeIntegrationResult,
  GitRunWorkspacePublicationResult,
} from "@/lib/runner-v2/workspace-isolation";
import { waitForProcessSessionQuiescence } from "@/lib/runner-v2/process-session";
import { pickRunnerControlEnv } from "@/lib/runner-control-env";

export interface RunnerV2CompletionEntrypointInput {
  sessionName: string;
  chainPath: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  dryRun?: boolean;
  now?: Date;
  onRunMutation?: RunMutationObserver;
}

export interface RunnerV2CompletionEntrypointResult {
  status: "handled";
  runId: string;
  agentId: string;
  decision: string;
  plan: TypedExecutorPlan;
  adapter: AdapterResult;
  runJsonPath: string;
  eventsDir: string;
}

export function runRunnerV2CompletionEntrypoint(
  input: RunnerV2CompletionEntrypointInput,
): RunnerV2CompletionEntrypointResult {
  const env = input.env || process.env;
  const chainDefinition = readChain(input.chainPath);
  const runId = env.MENTIKO_RUN_ID || env.RUN_ID;
  if (!runId) {
    throw unsupported("missing MENTIKO_RUN_ID/RUN_ID");
  }

  const runDir = resolveRunDir(env, runId);
  const runJsonPath = join(runDir, "run.json");
  if (!existsSync(runJsonPath)) {
    throw unsupported(`run.json not found: ${runJsonPath}`);
  }

  const run = readRunJson(runJsonPath);
  const chain = hydrateChainRuntimeState(chainDefinition, run);
  const executionTaskId = shouldRecordTaskExecutionMetadata(run.metadata) ? run.taskId : undefined;
  const agent = resolveAgent(input.sessionName, chain, run);
  const stateDir = resolveStateDir(env, runDir);

  // Fan-out members must suppress normal routing: their completion is an input
  // to the durable fan-group counter, and only the claim winner launches fan-in.
  const fanGroupId = findLiveFanGroupMembership(stateDir, agent.id, runId);
  const fanGroup = fanGroupId ? readFanGroup(stateDir, fanGroupId) || undefined : undefined;

  const eventsDir = resolveEventsDir(env);
  const events = readEvents(eventsDir);
  // Archived processed events are replay evidence only. Keep them out of the
  // completion pipeline so an old handoff can never become a new trigger, but
  // let an already-completed agent prove that this exact event was consumed.
  const archivedEvents = readEvents(join(eventsDir, "archive"));
  const generationDuplicate = alreadyCompletedGeneration(run, runJsonPath, stateDir, agent.id);
  const duplicate = alreadyCompletedVerdict({
    run,
    agent,
    sessionName: input.sessionName,
    events: [...events, ...archivedEvents],
    runId,
  })
    || generationDuplicate;
  if (duplicate) {
    let completionAttempt: ReturnType<typeof resolveAgentAttemptForCompletion>;
    let completionAttemptCurrent = true;
    let integration: GitNodeIntegrationResult | undefined;
    if (!input.dryRun) {
      completionAttempt = resolveAgentAttemptForCompletion({
        runJsonPath,
        runId,
        agentId: agent.id,
        attemptId: env.MENTIKO_AGENT_ATTEMPT_ID,
        sessionName: input.sessionName,
      });
      completionAttemptCurrent = completionAttempt ? completionAttemptIsCurrent({
        runJsonPath,
        runId,
        agentId: agent.id,
        attemptId: completionAttempt.id,
      }) : true;
      integration = completionAttempt
        ? integrateCompletedNodeWorkspace({
          run,
          runId,
          runDir,
          agentId: agent.id,
          attemptId: completionAttempt.id,
          now: input.now,
        })
        : undefined;
      if (integration?.status === "conflict") {
        return blockWorkspaceIntegrationConflict({
          runJsonPath,
          runId,
          eventsDir,
          stateDir,
          sessionName: input.sessionName,
          agentId: agent.id,
          attemptId: completionAttempt!.id,
          integration,
          env,
          now: input.now,
        });
      }
      const publication = run.status === "completed" || generationDuplicate
        ? publishCompletedRunWorkspace({ run, runId, runDir, now: input.now })
        : undefined;
      if (publication?.status === "source-changed") {
        return blockSourceWorkspaceChanged({
          runJsonPath,
          runId,
          eventsDir,
          stateDir,
          sessionName: input.sessionName,
          agentId: agent.id,
          attemptId: completionAttempt!.id,
          publication,
          env,
          now: input.now,
        });
      }
    }
    if (!input.dryRun && generationDuplicate) {
      if (completionAttempt) {
        removeAgentSessionsAndReleaseCapacity({
          sessionName: input.sessionName,
          stateDir,
          runId,
          runJsonPath,
          attemptId: completionAttempt.id,
          env,
          now: input.now,
        });
      } else {
        killAgentSessions(input.sessionName, { stateDir, runId, env });
      }
      const attemptGuard = completionAttempt && completionAttemptCurrent
        ? completionAttemptGuard(runId, agent.id, completionAttempt.id)
        : undefined;
      if (!completionAttempt || completionAttemptCurrent) {
        const completedReason = { actor: "system" as const, reason: "completion entrypoint accepted the agent's completion handoff" };
        updateRunAgent(runJsonPath, agent.id, "complete", input.now, undefined, attemptGuard, completedReason);
        updateRunStatus(runJsonPath, "completed", undefined, input.now, undefined, attemptGuard, completedReason);
      }
    }
    if (!input.dryRun && completionAttempt && integration && integration.status !== "conflict") {
      cleanupNodeWorkspaceAfterCompletion({
        run,
        runId,
        runDir,
        agentId: agent.id,
        attemptId: completionAttempt.id,
        now: input.now,
      });
    }
    return {
      status: "handled",
      runId,
      agentId: agent.id,
      decision: "already-completed",
      plan: {
        action: "already-completed",
        launches: [],
        effects: [],
      },
      adapter: {
        effectsApplied: [],
        operations: [],
        launchesStarted: [],
      },
      runJsonPath,
      eventsDir,
    };
  }
  const runMutationJournal: RunJsonMutation[] = [];
  const loopMutationJournal: LoopFileMutation[] = [];
  const onRunMutation: RunMutationObserver = (mutation) => {
    runMutationJournal.push(mutation);
    input.onRunMutation?.(mutation);
  };
  const onLoopMutation: LoopMutationObserver = (mutation) => { loopMutationJournal.push(mutation); };

  try {
  // Pre-cutover routed/relaunched agents can have no AgentAttempt record —
  // only the typed bootstrap creates them. Adopt one now so this completion
  // produces the same typed lifecycle evidence as bootstrap-launched agents.
  // Placed after the snapshot: a dry run or an unsupported/failed pipeline
  // restores the snapshot, so no caller sees a half-typed record.
  const completionAttempt = adoptAgentAttemptForCompletion({
    runJsonPath,
    runId,
    agentId: agent.id,
    attemptId: env.MENTIKO_AGENT_ATTEMPT_ID,
    sessionName: input.sessionName,
    now: input.now,
    onMutation: onRunMutation,
  });
  const attemptGuard = completionAttemptGuard(runId, agent.id, completionAttempt.id);
  assertRunAgentAttemptCurrent(readRunJson(runJsonPath), attemptGuard);

  const workspacePath = run.workspacePath || stringValue(chain.config?.project_root);
  const completionChainId = resolveCompletionChainId(run, chain);
  const completionChainName = chain.name || completionChainId || "unknown";
  const maxRounds = numberValue(chain.config?.max_rounds);
  const liveness = resolveCompletionLiveness({
    sessionName: input.sessionName,
    env,
    run,
    agentId: agent.id,
  });
  const retryOccurrenceId = completionAttemptOccurrenceId({
    runId,
    agentId: agent.id,
    attemptId: completionAttempt.id,
    loopRound: readLoopState(runDir).round,
  });
  const qualityGate = maybeHandleQualityGateFailure({
    run,
    runDir,
    runJsonPath,
    agent,
    chain,
    namespaceId: env.NAMESPACE_ID || "default",
    orgId: env.ORG_ID || "default",
    now: input.now,
    dryRun: input.dryRun,
    onRunMutation,
    attemptGuard,
    });
  if (qualityGate) {
    if (input.dryRun) {
      restoreSnapshots(runJsonPath, runMutationJournal, loopMutationJournal);
    } else {
      // shell phase-4 parity: the fallback handler never runs after a typed
      // verdict, so the bridge tears down the agent + monitor sessions itself
      removeAgentSessionsAndReleaseCapacity({
        sessionName: input.sessionName, stateDir, runId, runJsonPath,
        attemptId: completionAttempt.id, env, now: input.now,
      });
    }
    return {
      status: "handled",
      runId,
      agentId: agent.id,
      decision: "quality-gate-failed",
      plan: {
        action: "fail",
        launches: [],
        effects: [],
      },
      adapter: {
        effectsApplied: ["event-artifact", "run-terminal"],
        operations: [{
          type: "event-artifact",
          runId,
          status: qualityGate.status,
          executionId: qualityGate.executionId,
          artifactPath: qualityGate.artifactPath,
        }],
        launchesStarted: [],
      },
      runJsonPath,
      eventsDir,
    };
  }

    const terminal: TerminalCompletionInput = {
      runId,
      chainId: completionChainId,
      chainName: completionChainName,
      chainPath: input.chainPath,
      taskId: executionTaskId,
      lastAgentId: agent.id,
      sessions: run.sessions,
      schedule: configuredSchedule(chain.config?.schedule),
      onComplete: terminalOnComplete(chain.config?.on_complete),
      webhookUrl: stringValue(chain.config?.webhook_url),
    };

    const pipeline = runCompletionPipeline({
      runDir,
      runJsonPath,
      runId,
      attemptId: completionAttempt.id,
      agent,
      chain,
      events,
      maxRounds,
      now: input.now,
      terminal,
      generation: generationImportPlan(run, runDir, agent.id, env),
      decision: decisionCompletionPlan(run, runDir, agent.id),
      completionRecoveryEvidence: monitorCompletionRecoveryEvidence(env),
      fanGroup,
      liveness,
      onRunMutation,
      onLoopMutation,
      retry: {
        policy: objectValue(agent.retry) || objectValue(chain.config?.retry),
        currentAttempt: resolveRetryAttempt({
          env,
          runJsonPath,
          stateDir,
          agentId: agent.id,
        }),
        chainId: completionChainId,
        chainPath: input.chainPath,
        workspacePath,
        taskId: executionTaskId,
        startSha: stringValue(run.startSha),
        debug: env.DEBUG === "1" || env.MENTIKO_DEBUG === "1",
        occurrenceId: retryOccurrenceId,
      },
    });
    if (pipeline.decision.action !== "stale-attempt") {
      assertRunAgentAttemptCurrent(readRunJson(runJsonPath), attemptGuard);
    }
    const workspaceIntegration = integrateAcceptedCompletionWorkspace({
      run,
      runId,
      runDir,
      agentId: agent.id,
      attemptId: completionAttempt.id,
      completionAction: pipeline.decision.action,
      dryRun: input.dryRun,
      now: input.now,
    });
    if (workspaceIntegration?.status === "conflict") {
      restoreSnapshots(runJsonPath, runMutationJournal, loopMutationJournal);
      return blockWorkspaceIntegrationConflict({
        runJsonPath,
        runId,
        eventsDir,
        stateDir,
        sessionName: input.sessionName,
        agentId: agent.id,
        attemptId: completionAttempt.id,
        integration: workspaceIntegration,
        env,
        now: input.now,
      });
    }
    if (pipeline.decision.action === "await-liveness") {
      if (!input.dryRun) {
        recordCompletionLivenessExtension({
          runJsonPath,
          agentId: agent.id,
          decision: pipeline.decision.liveness,
          now: input.now,
          onMutation: onRunMutation,
        });
      }
    } else if (liveness && !input.dryRun) {
      clearCompletionLivenessExtension(runJsonPath, agent.id, onRunMutation);
    }

    const occurrenceId = completionOccurrenceId({
      runId,
      agentId: agent.id,
      attemptId: completionAttempt.id,
      pipeline,
    });
    const routedWorkspaceBaseCommit = workspaceIntegration?.integrationCommit
      || (!input.dryRun
        ? currentRunWorkspaceCommit({ run, runId, runDir, now: input.now })
        : undefined);
    const plan = buildTypedExecutorPlan({
      pipeline,
      allEvents: events,
      allAgentIds: chain.agents.map((candidate) => candidate.id),
      terminal,
      agentCompletion: {
        runId,
        chainName: completionChainName,
        agentId: agent.id,
        occurrenceId,
        agentName: agent.name,
        sessionName: input.sessionName,
        chainWebhooks: parseChainWebhooks(chain.config?.webhooks),
      },
      routeContext: {
        chainPath: input.chainPath,
        workspacePath,
        taskId: run.taskId,
        runDir,
        env: {
          // Routed launch jobs are detached from this monitor. Persist the same
          // tenant policy that admitted the current agent, including the nano
          // one-agent cap, before any downstream process can be accepted.
          ...pickRunnerControlEnv(env, process.env),
          MENTIKO_RUN_ID: runId,
          RUN_ID: runId,
          NAMESPACE_ID: env.NAMESPACE_ID,
          ORG_ID: env.ORG_ID,
          WORKSPACE_TYPE: env.WORKSPACE_TYPE,
          MENTIKO_SESSION_ID: env.MENTIKO_SESSION_ID,
          MENTIKO_SESSION_TOKEN: env.MENTIKO_SESSION_TOKEN,
          MENTIKO_WEB_URL: env.MENTIKO_WEB_URL,
          MENTIKO_RUNNER_V2: env.MENTIKO_RUNNER_V2,
          MENTIKO_RUNNER_V2_COMPLETION: env.MENTIKO_RUNNER_V2_COMPLETION,
          TASK_ID: env.TASK_ID,
          TASK_TITLE: env.TASK_TITLE,
          TASK_DESCRIPTION: env.TASK_DESCRIPTION,
          TASK_TYPE: env.TASK_TYPE,
          TASK_PRIORITY: env.TASK_PRIORITY,
          TASK_ACCEPTANCE_CRITERIA: env.TASK_ACCEPTANCE_CRITERIA,
          TASK_DESIGN: env.TASK_DESIGN,
          TASK_NOTES: env.TASK_NOTES,
          TASK_COMMENTS: env.TASK_COMMENTS,
          TASK_CONTEXT: env.TASK_CONTEXT,
          TASK_CONTEXT_JSON: env.TASK_CONTEXT_JSON,
          MENTIKO_COMPLETION_OCCURRENCE_ID: occurrenceId,
          MENTIKO_WORKSPACE_BASE_COMMIT: routedWorkspaceBaseCommit,
        },
      },
    });

    const publication = !input.dryRun && runBecameCompletedInPlan(plan)
      ? publishCompletedRunWorkspace({ run, runId, runDir, now: input.now })
      : undefined;
    if (publication?.status === "source-changed") {
      restoreSnapshots(runJsonPath, runMutationJournal, loopMutationJournal);
      return blockSourceWorkspaceChanged({
        runJsonPath,
        runId,
        eventsDir,
        stateDir,
        sessionName: input.sessionName,
        agentId: agent.id,
        attemptId: completionAttempt.id,
        publication,
        env,
        now: input.now,
      });
    }

    if (pipeline.decision.action !== "stale-attempt") {
      assertRunAgentAttemptCurrent(readRunJson(runJsonPath), attemptGuard);
    }

    const adapter = applyTypedExecutorPlan(plan, {
      runJsonPath,
      stateDir,
      namespaceId: env.NAMESPACE_ID || "default",
      orgId: env.ORG_ID || "default",
      eventsDir,
      eventsArchiveDir: join(eventsDir, "archive"),
      schedulesDir: env.SCHEDULES_DIR,
      dryRun: input.dryRun,
      onRunMutation,
      ...(pipeline.decision.action !== "stale-attempt" ? { attemptGuard } : {}),
    });

    if (!input.dryRun && runBecameCompletedInPlan(plan)) {
      // Delivery must not depend on the agent correctly composing the CLI import
      // call (it can crash right after writing the artifact, or never get the
      // chance). Trigger the import as soon as this run's own completion marks it
      // done; the guided-route/GET self-heal in decision-auto-advance.ts is the
      // backstop for whatever slips through this (e.g. the process dying before
      // the fire-and-forget POST lands).
      maybeTriggerDecisionImportOnCompletion({
        namespaceId: env.NAMESPACE_ID || "default",
        orgId: env.ORG_ID || "default",
        metadata: run.metadata,
        runId,
        runDir,
        webUrl: env.MENTIKO_WEB_URL,
      });
    }

    if (input.dryRun) {
      restoreSnapshots(runJsonPath, runMutationJournal, loopMutationJournal);
    } else if (pipeline.decision.action !== "await-liveness") {
      // shell phase-4 parity: the fallback handler never runs after a typed
      // verdict, so the bridge tears down the agent + monitor sessions itself.
      // Runs for every handled verdict — v1 kills sessions unconditionally in
      // phase 4 before its routing decisions; relaunches use fresh sessions.
      removeAgentSessionsAndReleaseCapacity({
        sessionName: input.sessionName, stateDir, runId, runJsonPath,
        attemptId: completionAttempt.id, env, now: input.now,
      });
      if (workspaceIntegration) {
        cleanupNodeWorkspaceAfterCompletion({
          run,
          runId,
          runDir,
          agentId: agent.id,
          attemptId: completionAttempt.id,
          now: input.now,
        });
      }
    }

    return {
      status: "handled",
      runId,
      agentId: agent.id,
      decision: pipeline.decision.action,
      plan,
      adapter,
      runJsonPath,
      eventsDir,
    };
  } catch (error) {
    restoreSnapshots(runJsonPath, runMutationJournal, loopMutationJournal);
    if (error instanceof StaleRunAgentAttemptError) {
      const staleAttempt = resolveAgentAttemptForCompletion({
        runJsonPath,
        runId,
        agentId: agent.id,
        attemptId: env.MENTIKO_AGENT_ATTEMPT_ID,
        sessionName: input.sessionName,
      });
      if (!input.dryRun && staleAttempt) {
        removeAgentSessionsAndReleaseCapacity({
          sessionName: input.sessionName,
          stateDir,
          runId,
          runJsonPath,
          attemptId: staleAttempt.id,
          env,
          now: input.now,
        });
      }
      return staleCompletionEntrypointResult({ runId, agentId: agent.id, runJsonPath, eventsDir });
    }
    if (!input.dryRun && error instanceof GenerationImportError) {
      // The generation agent did finish and produced an accepted artifact; the
      // system failed while importing that artifact. Do not restore the run to
      // a live-looking state: terminalize it as an orchestration failure and
      // tear down the PTYs so the watchdog cannot mistake a zombie session for
      // active work. A later completion replay can still retry the idempotent
      // job import and move the run from failed to completed.
      const recoveredAttempt = adoptAgentAttemptForCompletion({
        runJsonPath,
        runId,
        agentId: agent.id,
        attemptId: env.MENTIKO_AGENT_ATTEMPT_ID,
        sessionName: input.sessionName,
        now: input.now,
      });
      markAgentAttemptCompletedFromGeneration({
        runJsonPath,
        runId,
        agentId: agent.id,
        attemptId: recoveredAttempt.id,
        detail: "generation artifact accepted; import failed after agent completion",
        now: input.now,
      });
      const recoveredGuard = completionAttemptGuard(runId, agent.id, recoveredAttempt.id);
      if (completionAttemptIsCurrent({
        runJsonPath,
        ...recoveredGuard,
      })) {
        updateRunAgent(runJsonPath, agent.id, "complete", input.now, undefined, recoveredGuard,
          { actor: "system", reason: "generation artifact accepted; agent work completed" });
        updateRunStatus(runJsonPath, "failed", error.message, input.now, undefined, recoveredGuard,
          { actor: "system", reason: `generation import failed after agent completion: ${error.message}` });
      }
      removeAgentSessionsAndReleaseCapacity({
        sessionName: input.sessionName, stateDir, runId, runJsonPath,
        attemptId: recoveredAttempt.id, env, now: input.now,
      });
    }
    throw error;
  }
}

function removeAgentSessionsAndReleaseCapacity(input: {
  sessionName: string;
  stateDir: string;
  runId: string;
  runJsonPath: string;
  attemptId: string;
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  now?: Date;
}): void {
  const attempts = readRunnerV2AttemptState(input.runJsonPath).attempts;
  const completedAttempt = attempts.find((attempt) => attempt.id === input.attemptId);
  const processSessionId = completedAttempt?.processEvidence?.processPid;
  const competingAttempt = attempts.find((attempt) => (
    attempt.id !== input.attemptId
    && attempt.runId === input.runId
    && !isTerminalAgentAttemptPhase(attempt.phase)
    && (
      attempt.leaseId === input.sessionName
      || attempt.processEvidence?.ptySessionId === input.sessionName
    )
  ));
  if (competingAttempt) {
    // A stale completion may replay after a retry or loop occurrence reused the
    // same deterministic PTY name. Release only the exact completed attempt's
    // capacity; the newer occurrence owns the live session. The old process
    // session must still be quiescent before its slot can be released.
    if (processSessionId === undefined || waitForProcessSessionQuiescence({ sessionId: processSessionId })) {
      releaseAgentCapacitySlot({
        runJsonPath: input.runJsonPath,
        attemptId: input.attemptId,
        now: input.now,
      });
    }
    return;
  }
  const cleanup = killAgentSessions(input.sessionName, {
    stateDir: input.stateDir,
    runId: input.runId,
    env: input.env,
    processSessionId,
  });
  // The monitor does not consume an active-agent slot. Release only after the
  // agent PTY itself is proven absent; a failed removal stays durably counted
  // and the watchdog cleanup pass retries it.
  if (!cleanup.failed.includes(input.sessionName)) {
    releaseAgentCapacitySlot({
      runJsonPath: input.runJsonPath,
      attemptId: input.attemptId,
      now: input.now,
    });
  }
}

function completionAttemptGuard(
  runId: string,
  agentId: string,
  attemptId: string,
): RunAgentAttemptGuard {
  return { runId, agentId, attemptId };
}

/**
 * A completion replay can arrive after the original completion already
 * released the attempt's PTY/capacity lease. The replay still needs to
 * surface the workspace conflict at run level, but it must not try to move a
 * historical released attempt back into a live terminal phase.
 */
function transitionAttemptToHumanActionRequired(input: {
  runJsonPath: string;
  attemptId: string;
  reason: Parameters<typeof transitionAgentAttempt>[0]["reason"];
  detail: string;
  now?: Date;
}): AgentAttemptRecord | undefined {
  const attempt = readRunnerV2AttemptState(input.runJsonPath).attempts.find(
    (candidate) => candidate.id === input.attemptId,
  );
  if (!attempt) return undefined;
  if (attempt.phase === "human_action_required") return attempt;
  // `completed` is explicitly allowed to transition to a human-resolution
  // state. Every other terminal phase is historical evidence and cannot be
  // reopened; leave it intact and let the guarded run-level status carry the
  // replayed conflict.
  if (isTerminalAgentAttemptPhase(attempt.phase) && attempt.phase !== "completed") return attempt;
  return transitionAgentAttempt({
    runJsonPath: input.runJsonPath,
    attemptId: input.attemptId,
    to: "human_action_required",
    reason: input.reason,
    detail: input.detail,
    now: input.now,
  });
}

function completionAttemptIsCurrent(
  input: RunAgentAttemptGuard & { runJsonPath: string },
): boolean {
  try {
    assertRunAgentAttemptCurrent(readRunJson(input.runJsonPath), input);
    return true;
  } catch (error) {
    if (error instanceof StaleRunAgentAttemptError) return false;
    throw error;
  }
}

function staleCompletionEntrypointResult(input: {
  runId: string;
  agentId: string;
  runJsonPath: string;
  eventsDir: string;
}): RunnerV2CompletionEntrypointResult {
  return {
    status: "handled",
    runId: input.runId,
    agentId: input.agentId,
    decision: "stale-attempt",
    plan: {
      action: "stale-attempt",
      launches: [],
      effects: [],
    },
    adapter: {
      effectsApplied: [],
      operations: [],
      launchesStarted: [],
    },
    runJsonPath: input.runJsonPath,
    eventsDir: input.eventsDir,
  };
}

function blockWorkspaceIntegrationConflict(input: {
  runJsonPath: string;
  runId: string;
  eventsDir: string;
  stateDir: string;
  sessionName: string;
  agentId: string;
  attemptId: string;
  integration: GitNodeIntegrationResult;
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  now?: Date;
}): RunnerV2CompletionEntrypointResult {
  const paths = input.integration.conflictPaths.length > 0
    ? input.integration.conflictPaths.join(", ")
    : "unknown paths";
  const detail = [
    `workspace integration conflict after agent ${input.agentId}`,
    `paths: ${paths}`,
    `artifact: ${input.integration.artifactPath}`,
  ].join("; ");

  transitionAttemptToHumanActionRequired({
    runJsonPath: input.runJsonPath,
    attemptId: input.attemptId,
    reason: "workspace_integration_conflict",
    detail,
    now: input.now,
  });
  const attemptGuard = completionAttemptGuard(input.runId, input.agentId, input.attemptId);
  const blockedReason = { actor: "system" as const, reason: detail };
  updateRunAgent(input.runJsonPath, input.agentId, "blocked", input.now, undefined, attemptGuard, blockedReason);
  updateRunStatus(input.runJsonPath, "blocked", detail, input.now, undefined, attemptGuard, blockedReason);
  removeAgentSessionsAndReleaseCapacity({
    sessionName: input.sessionName,
    stateDir: input.stateDir,
    runId: input.runId,
    runJsonPath: input.runJsonPath,
    attemptId: input.attemptId,
    env: input.env,
    now: input.now,
  });

  return {
    status: "handled",
    runId: input.runId,
    agentId: input.agentId,
    decision: "workspace-conflict",
    plan: {
      action: "workspace-conflict",
      launches: [],
      effects: [],
    },
    adapter: {
      effectsApplied: [],
      operations: [],
      launchesStarted: [],
    },
    runJsonPath: input.runJsonPath,
    eventsDir: input.eventsDir,
  };
}

function blockSourceWorkspaceChanged(input: {
  runJsonPath: string;
  runId: string;
  eventsDir: string;
  stateDir: string;
  sessionName: string;
  agentId: string;
  attemptId: string;
  publication: GitRunWorkspacePublicationResult;
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  now?: Date;
}): RunnerV2CompletionEntrypointResult {
  const changedPaths = input.publication.sourceChanges.files.map((file) => file.path);
  const detail = [
    `source workspace changed before publishing run ${input.runId}`,
    `changes: ${changedPaths.length > 0 ? changedPaths.join(", ") : "HEAD or branch identity"}`,
    ...(input.publication.rollback?.status === "reverted"
      ? ["post-apply race detected; Mentiko result patch was reverted"]
      : input.publication.rollback?.status === "not-needed"
        ? ["post-apply race detected; source returned to the task-start snapshot before rollback"]
        : input.publication.rollback?.status === "failed"
          ? [
            "post-apply race detected; unaffected Mentiko result paths were reverted",
            `externally changed paths preserved: ${input.publication.rollback.preservedPaths?.join(", ") || "unknown"}`,
            "those preserved paths may contain Mentiko result changes",
          ]
          : []),
    `artifact: ${input.publication.artifactPath}`,
  ].join("; ");

  transitionAttemptToHumanActionRequired({
    runJsonPath: input.runJsonPath,
    attemptId: input.attemptId,
    reason: "source_workspace_changed",
    detail,
    now: input.now,
  });
  const attemptGuard = completionAttemptGuard(input.runId, input.agentId, input.attemptId);
  const blockedReason = { actor: "system" as const, reason: detail };
  updateRunAgent(input.runJsonPath, input.agentId, "blocked", input.now, undefined, attemptGuard, blockedReason);
  updateRunStatus(input.runJsonPath, "blocked", detail, input.now, undefined, attemptGuard, blockedReason);
  removeAgentSessionsAndReleaseCapacity({
    sessionName: input.sessionName,
    stateDir: input.stateDir,
    runId: input.runId,
    runJsonPath: input.runJsonPath,
    attemptId: input.attemptId,
    env: input.env,
    now: input.now,
  });

  return {
    status: "handled",
    runId: input.runId,
    agentId: input.agentId,
    decision: "workspace-source-changed",
    plan: {
      action: "workspace-source-changed",
      launches: [],
      effects: [],
    },
    adapter: {
      effectsApplied: [],
      operations: [],
      launchesStarted: [],
    },
    runJsonPath: input.runJsonPath,
    eventsDir: input.eventsDir,
  };
}

function cleanupNodeWorkspaceAfterCompletion(input: {
  run: RunRecord;
  runId: string;
  runDir: string;
  agentId: string;
  attemptId: string;
  now?: Date;
}): void {
  try {
    cleanupIntegratedNodeWorkspace(input);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(
      `[runner-v2] could not remove integrated node worktree ${input.attemptId}: ${detail}`,
    );
  }
}

/** True exactly when this completion's plan carries the run to terminal "completed". */
function runBecameCompletedInPlan(plan: TypedExecutorPlan): boolean {
  return plan.effects.some((effect) =>
    effect.type === "terminal" || (effect.type === "run-terminal" && effect.status === "completed"));
}

/**
 * Decision guided-round chains (Decision Guided Questions/Options/Plan) complete
 * like any other run, but the human-visible progress depends on the agent's own
 * `mentiko decision import` call landing afterward. That call can be skipped or
 * mistyped. Fire it ourselves as soon as this run's completion is durable so
 * delivery never depends solely on the agent's last shell command succeeding.
 * completion-entrypoint.ts runs out-of-process (spawned by `mentiko complete`,
 * not necessarily inside the Next.js server), so prefer the durable per-run
 * token chain-run-service.ts already wrote for the CLI over recomputing one
 * from this process's own env.
 */
function maybeTriggerDecisionImportOnCompletion(input: {
  namespaceId: string;
  orgId: string;
  metadata: RunRecord["metadata"];
  runId: string;
  runDir: string;
  webUrl?: string;
}): void {
  const decisionId = typeof input.metadata?.decisionId === "string" ? input.metadata.decisionId : undefined;
  const phase = typeof input.metadata?.decisionPhase === "string" ? input.metadata.decisionPhase : undefined;
  if (!decisionId || !phase) return;
  if (!existsSync(join(input.runDir, "artifacts", "decision-result.json"))) return;

  const selectedOptionId = typeof input.metadata?.selectedOptionId === "string"
    ? input.metadata.selectedOptionId
    : undefined;
  const workspacePath = typeof input.metadata?.workspacePath === "string"
    ? input.metadata.workspacePath
    : undefined;

  triggerDecisionImportReplay({
    namespaceId: input.namespaceId,
    orgId: input.orgId,
    decisionId,
    phase,
    runId: input.runId,
    workspacePath,
    selectedOptionId,
    runDir: input.runDir,
    webUrl: input.webUrl,
  });
}

function alreadyCompletedGeneration(
  run: RunRecord,
  runJsonPath: string,
  stateDir: string,
  agentId: string,
): boolean {
  if (run.status !== "completed") return false;
  const attempt = [...readRunnerV2AttemptState(runJsonPath).attempts]
    .reverse()
    .find((candidate) => candidate.agentId === agentId);
  if (attempt?.phase !== "completed" || attempt.terminalReason !== "completed_from_generation_artifact") return false;
  const ledgerPath = join(stateDir, "generation-import.jsonl");
  if (!existsSync(ledgerPath)) return false;
  try {
    return readFileSync(ledgerPath, "utf8").split("\n").some((line) => {
      if (!line.trim()) return false;
      const entry = JSON.parse(line) as { runId?: unknown; status?: unknown };
      return entry.runId === run.id && entry.status === "complete";
    });
  } catch {
    return false;
  }
}

function alreadyCompletedVerdict(input: {
  run: RunRecord;
  agent: ChainAgent;
  sessionName: string;
  events: RunnerEventRecord[];
  runId: string;
}): boolean {
  const runAgent = (input.run.agents || []).find((candidate) => candidate.id === input.agent.id);
  if (!runAgent || !["complete", "completed"].includes(runAgent.status || "")) return false;
  const emitted = input.agent.emits;
  if (!emitted) return false;
  const matchingEvent = (event: RunnerEventRecord) => (
    event.event === emitted
    && eventMatchesRunId(event, input.runId)
    && agentOwnsEvent(event, input.agent, input.sessionName)
  );
  // A fresh active occurrence always wins over an older processed archive
  // receipt. Loop visits commonly reuse the same agent/event identity; treating
  // the prior receipt as the current occurrence strands iteration two.
  if (input.events.some((event) => !event.processed && matchingEvent(event))) return false;
  return input.events.some((event) => (
    event.processed
    && matchingEvent(event)
    // canonical event source is the AGENT ID, not the session name -- a bare
    // (!event.source || event.source === sessionName) guard missed the common
    // "source: <agent id>" shape and let an already-completed agent be
    // re-routed/retried/failed. agentOwnsEvent checks exact identity against
    // the agent id, its declared session prefix, and the session name.
  ));
}

function maybeHandleQualityGateFailure(input: {
  run: RunRecord;
  runDir: string;
  runJsonPath: string;
  agent: ChainAgent;
  chain: ChainFile;
  namespaceId: string;
  orgId: string;
  now?: Date;
  dryRun?: boolean;
  onRunMutation?: RunMutationObserver;
  attemptGuard: RunAgentAttemptGuard;
}) {
  const artifactsDir = join(input.runDir, "artifacts");
  const summaryPath = join(artifactsDir, `${input.agent.id}-summary.json`);
  const summaryArtifact = readAgentSummaryArtifact(summaryPath);
  const summary = summaryArtifact.summary as AgentSummary | undefined;
  const result = evaluateQualityGate({
    agent: {
      id: input.agent.id,
      name: input.agent.name,
      role: stringValue((input.agent as unknown as Record<string, unknown>).role),
    },
    summary,
    summaryParseError: summaryArtifact.parseError,
  });
  if (result.passed) return null;

  // "blocked" is a deliberate terminal outcome, not a failed attempt to
  // retry blindly. Preserve that distinction for reconciliation and task UI.
  const summaryStatus = summary?.status?.trim().toLowerCase();
  const terminalRunStatus = summaryStatus === "blocked" ? "blocked" : "failed";

  assertRunAgentAttemptCurrent(readRunJson(input.runJsonPath), input.attemptGuard);

  const artifact: { status: string; executionId?: string; artifactPath?: string } = !input.dryRun ? runQualityGateEventArtifact({
    namespaceId: input.namespaceId,
    orgId: input.orgId,
    runId: input.run.id,
    runArtifactsDir: artifactsDir,
    now: input.now,
    payload: {
      event: {
        name: "quality_gate.failed",
        source: "runner-v2",
        timestamp: (input.now || new Date()).toISOString(),
      },
      namespace: { id: input.namespaceId },
      org: { id: input.orgId },
      run: {
        id: input.run.id,
        chainId: resolveCompletionChainId(input.run, input.chain),
        chainName: input.chain.name,
        status: terminalRunStatus,
        artifactsDir,
      },
      ...(input.run.taskId ? {
        task: {
          id: input.run.taskId,
          title: input.run.taskId,
          status: terminalRunStatus,
        },
      } : {}),
      qualityGate: {
        // The blocked distinction belongs to the run and task lifecycle above.
        // This payload's contract is "partial" | "failed": the gate reports a
        // verdict, not a run state, and a blocked run did not pass it.
        status: summaryStatus === "partial" ? "partial" : "failed",
        agentId: input.agent.id,
        reason: result.reason,
        summaryPath: existsSync(summaryPath) ? summaryPath : undefined,
        findings: boundedStringArray((summary as Record<string, unknown> | undefined)?.findings),
        risks: boundedStringArray((summary as Record<string, unknown> | undefined)?.risks),
        nextActions: boundedStringArray((summary as Record<string, unknown> | undefined)?.nextActions),
      },
      evidence: {
        changedFiles: [],
        liveSessions: [],
        artifacts: existsSync(summaryPath) ? [summaryPath] : [],
      },
    },
  }) : { status: "planned" as const };

  if (!input.dryRun) {
    const failureReason = { actor: "system" as const, reason: result.reason };
    updateRunAgent(
      input.runJsonPath,
      input.agent.id,
      "failed",
      input.now,
      input.onRunMutation,
      input.attemptGuard,
      failureReason,
    );
    updateRunStatus(
      input.runJsonPath,
      terminalRunStatus,
      result.reason,
      input.now,
      input.onRunMutation,
      input.attemptGuard,
      failureReason,
    );
  }
  return artifact;
}

function generationImportPlan(
  run: RunRecord,
  runDir: string,
  agentId: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
) {
  const metadata = objectValue(run.metadata);
  const jobId = stringValue(metadata?.generationJobId) || stringValue(metadata?.jobId);
  const generationKind = stringValue(metadata?.generationKind);
  if (!jobId || !generationKind) return undefined;
  const artifactsDir = join(runDir, "artifacts");
  return {
    jobId,
    generationKind,
    runId: run.id,
    artifactsDir,
    namespaceId: env.NAMESPACE_ID,
    orgId: env.ORG_ID,
    webUrl: env.MENTIKO_WEB_URL,
    importablePayload: hasImportableGenerationPayload({
      artifactsDir,
      generationKind,
      notBeforeMs: generationArtifactNotBeforeMs(run, agentId),
    }),
  };
}

function hasImportableGenerationPayload(input: {
  artifactsDir: string;
  generationKind: string;
  notBeforeMs?: number;
}): boolean {
  if (!existsSync(input.artifactsDir)) return false;
  let aliases: string[];
  try {
    aliases = readdirSync(input.artifactsDir).filter((file) => (
      file !== "generation-result.json"
      && (file.endsWith("-generation-result.json")
        || file.endsWith("-output.json")
        || file.endsWith("-result.json"))
    ));
  } catch {
    return false;
  }

  const candidates = [
    join(input.artifactsDir, "generation-result.json"),
    ...aliases.map((file) => join(input.artifactsDir, file)),
  ];
  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue;
      const payload = JSON.parse(readFileSync(path, "utf8"));
      if (!isPayloadCompatibleWithKind(payload, input.generationKind)) continue;
      // The import CLI selects the first contract-compatible candidate in this
      // same order. If that candidate predates this attempt, fail closed rather
      // than letting a later alias make the plan import the stale earlier file.
      if (input.notBeforeMs !== undefined && statSync(path).mtimeMs < input.notBeforeMs) return false;
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

/**
 * Decision-phase counterpart to generationImportPlan (C3).
 *
 * A decision core-chain run's real deliverable is `artifacts/decision-result.json`.
 * The `mentiko decision import` CLI call that applies it is the LAST thing the
 * agent does, and four runs died exactly there: valid artifact on disk, valid
 * run-scoped import token, and a failed run because the model flubbed the final
 * command. Completion must own that, with the CLI as an accelerant.
 *
 * Same identity discipline as the generation side — decision id, phase, the
 * run-scoped token chain-run-service wrote, and an artifact written after this
 * attempt started. A filename alone is never authoritative.
 */
function decisionCompletionPlan(
  run: RunRecord,
  runDir: string,
  agentId: string,
): { decisionId: string; phase: string; artifactPath: string } | undefined {
  const metadata = objectValue(run.metadata);
  const decisionId = stringValue(metadata?.decisionId);
  const phase = stringValue(metadata?.decisionPhase);
  if (!decisionId || !phase) return undefined;
  if (!existsSync(join(runDir, ".internal", "decision-import-token"))) return undefined;

  const artifactPath = join(runDir, "artifacts", "decision-result.json");
  if (!existsSync(artifactPath)) return undefined;

  const notBefore = generationArtifactNotBeforeMs(run, agentId);
  try {
    if (notBefore !== undefined && statSync(artifactPath).mtimeMs < notBefore) return undefined;
    const payload = JSON.parse(readFileSync(artifactPath, "utf8")) as unknown;
    // An empty object or an array is not a phase result; anything else is the
    // decision route's business to validate, not ours to second-guess.
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
    if (Object.keys(payload as Record<string, unknown>).length === 0) return undefined;
  } catch {
    return undefined;
  }

  return { decisionId, phase, artifactPath };
}

function generationArtifactNotBeforeMs(run: RunRecord, agentId: string): number | undefined {
  const runnerV2 = objectValue(run.runnerV2);
  const attempts = Array.isArray(runnerV2?.attempts) ? runnerV2.attempts : [];
  const attemptStarts = attempts.flatMap((value) => {
    const attempt = objectValue(value);
    if (attempt?.runId !== run.id || attempt.agentId !== agentId) return [];
    const started = timestampValue(attempt.createdAt);
    return started === undefined ? [] : [started];
  });
  if (attemptStarts.length > 0) return Math.max(...attemptStarts);

  const agent = (run.agents || []).find((candidate) => candidate.id === agentId);
  return timestampValue(agent?.started) ?? timestampValue(run.started);
}

function timestampValue(value: unknown): number | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Identity of one accepted completion handoff. The matched event path and raw
 * field content anchor replay to the same durable artifact, while attempt and
 * loop round distinguish legitimate later visits with the same agent payload.
 */
export function completionOccurrenceId(input: {
  runId: string;
  agentId: string;
  attemptId: string;
  pipeline: CompletionPipelineResult;
}): string {
  const event = "event" in input.pipeline.decision ? input.pipeline.decision.event : undefined;
  return completionAttemptOccurrenceId({
    runId: input.runId,
    agentId: input.agentId,
    attemptId: input.attemptId,
    loopRound: input.pipeline.loopStateBefore.round,
    ...(event ? { event: {
      path: event.path || "",
      fields: event.fields,
    } } : {}),
  });
}

function completionAttemptOccurrenceId(input: {
  runId: string;
  agentId: string;
  attemptId: string;
  loopRound: number;
  event?: { path: string; fields: Record<string, string> };
}): string {
  const digest = createHash("sha256").update(stableSerialize(input)).digest("hex").slice(0, 32);
  return `runner-v2-completion:${digest}:v1`;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => (
      `${JSON.stringify(key)}:${stableSerialize(record[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export class RunnerV2CompletionUnsupportedError extends Error {
  readonly code = "RUNNER_V2_COMPLETION_UNSUPPORTED";
}

function unsupported(message: string): RunnerV2CompletionUnsupportedError {
  return new RunnerV2CompletionUnsupportedError(message);
}

interface ChainAgent {
  id: string;
  name?: string;
  emits?: string;
  triggers?: string[];
  wait_for_events?: {
    events: string[];
    wait_for?: "all" | "any" | "quorum";
    quorum?: number;
  };
  status?: string;
  lastAttemptCreatedAt?: string;
  session_prefix?: string;
  retry?: unknown;
}

interface ChainConfig {
  project_root?: unknown;
  max_rounds?: unknown;
  retry?: unknown;
  session_prefix?: unknown;
  on_complete?: unknown;
  webhook_url?: unknown;
  schedule?: unknown;
  webhooks?: unknown;
}

interface ChainFile extends RoutingChain {
  id?: string;
  name?: string;
  config?: ChainConfig;
  agents: ChainAgent[];
}

function readChain(path: string): ChainFile {
  if (!existsSync(path)) throw unsupported(`chain not found: ${path}`);
  const chain = JSON.parse(readFileSync(path, "utf8")) as ChainFile;
  if (!Array.isArray(chain.agents)) throw unsupported("chain agents missing");
  return chain;
}

function hydrateChainRuntimeState(chain: ChainFile, run: RunRecord): ChainFile {
  const persistedStatus = new Map(
    (run.agents || []).map((agent) => [agent.id, agent.status]),
  );
  const liveHandoffTargets = livePendingHandoffAgentIds(run);
  const attempts = readRunnerV2AttemptStateFromRun(run);
  return {
    ...chain,
    agents: chain.agents.map((agent) => {
      const status = liveHandoffTargets.has(agent.id)
        ? "running"
        : persistedStatus.get(agent.id);
      const latestAttempt = [...attempts].reverse().find((attempt) => attempt.agentId === agent.id && attempt.runId === run.id);
      return status || latestAttempt
        ? {
            ...agent,
            ...(status ? { status } : {}),
            ...(latestAttempt?.createdAt ? { lastAttemptCreatedAt: latestAttempt.createdAt } : {}),
          }
        : agent;
    }),
  };
}

function readRunnerV2AttemptStateFromRun(run: RunRecord): AgentAttemptRecord[] {
  const runnerV2 = objectValue(run.runnerV2);
  return Array.isArray(runnerV2?.attempts) ? runnerV2.attempts as AgentAttemptRecord[] : [];
}

function resolveRunDir(env: NodeJS.ProcessEnv | Record<string, string | undefined>, runId: string): string {
  if (env.MENTIKO_RUN_DIR) return env.MENTIKO_RUN_DIR;
  if (env.RUN_DIR) return env.RUN_DIR;
  if (env.RUNS_DIR) return join(env.RUNS_DIR, runId);
  throw unsupported("missing MENTIKO_RUN_DIR/RUN_DIR/RUNS_DIR");
}

function resolveEventsDir(env: NodeJS.ProcessEnv | Record<string, string | undefined>): string {
  return env.EVENTS_DIR || config.eventsDir;
}

function resolveCompletionLiveness(input: {
  sessionName: string;
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  run: RunRecord;
  agentId: string;
}): AgentLivenessInput | undefined {
  const sessionAlive = ptySessionAlive(input.sessionName, input.env);
  if (sessionAlive === undefined) return undefined;

  const maxExtensions = positiveIntValue(input.env.MENTIKO_RUNNER_V2_COMPLETION_MAX_EXTENSIONS, 6);
  const extensionCount = completionLivenessExtensionCount(input.run, input.agentId);
  if (!sessionAlive) {
    return { sessionAlive: false, extensionCount, maxExtensions };
  }

  const info = ptySessionInfo(input.sessionName, input.env);
  const processAlive = processIdAlive(numberValue(info?.childPid) || numberValue(info?.pid));
  const outputChanged = ptyOutputChangedSinceMonitorCheck(input.sessionName, input.env);

  return {
    sessionAlive: true,
    processAlive,
    outputChanged,
    extensionCount,
    maxExtensions,
  };
}

function ptySessionAlive(
  sessionName: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): boolean | undefined {
  const result = runPtyMgr(env, ["alive", sessionName]);
  if (!result) return undefined;
  if (result.status !== 0) return undefined;
  const out = result.stdout.trim().toLowerCase();
  if (out === "alive") return true;
  if (out === "dead") return false;
  return undefined;
}

function ptySessionInfo(
  sessionName: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Record<string, unknown> | undefined {
  const result = runPtyMgr(env, ["info", sessionName]);
  if (!result || result.status !== 0) return undefined;
  try {
    const parsed = JSON.parse(result.stdout) as unknown;
    return objectValue(parsed);
  } catch {
    return undefined;
  }
}

function ptyOutputChangedSinceMonitorCheck(
  sessionName: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): boolean {
  const stateDir = env.MENTIKO_MONITOR_STATE_DIR;
  const statePath = monitorStatePaths(sessionName, stateDir).state;
  if (!existsSync(statePath)) return false;

  const previous = readFileSync(statePath, "utf8").trim();
  if (!previous) return false;

  const result = runPtyMgr(env, ["capture", sessionName, "20"]);
  if (!result || result.status !== 0) return false;
  return captureHash(result.stdout, 20) !== previous;
}

function runPtyMgr(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  args: string[],
): { status: number | null; stdout: string; stderr: string } | undefined {
  const scopedEnv = runnerV2PtyEnv(env);
  const result = spawnSync(resolvePtyMgrBin(env), args, {
    encoding: "utf8",
    timeout: positiveIntValue(env.MENTIKO_RUNNER_V2_PTY_PROBE_TIMEOUT_MS, 2_000),
    env: stringEnv(scopedEnv),
  });
  if (result.error) return undefined;
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function resolvePtyMgrBin(env: NodeJS.ProcessEnv | Record<string, string | undefined>): string {
  const explicit = env.PTY_MGR_BIN || env.MENTIKO_PTY_MGR_BIN;
  if (explicit) return explicit;
  const codeRoot = env.MENTIKO_CODE_ROOT || process.env.MENTIKO_CODE_ROOT;
  return codeRoot ? join(codeRoot, "bin", "pty-mgr") : "pty-mgr";
}

function positiveIntValue(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function stringEnv(env: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV || "test" };
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function processIdAlive(pid: number | undefined): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function completionLivenessExtensionCount(run: RunRecord, agentId: string): number {
  const runnerV2 = objectValue(run.runnerV2);
  const liveness = objectValue(runnerV2?.completionLiveness);
  const agent = objectValue(liveness?.[agentId]);
  return numberValue(agent?.extensions) || 0;
}

function recordCompletionLivenessExtension(input: {
  runJsonPath: string;
  agentId: string;
  decision: { disposition: string; reason: string };
  now?: Date;
  onMutation?: RunMutationObserver;
}): RunRecord {
  return updateRunJson(input.runJsonPath, (current) => {
    if (!current) throw new Error(`run.json not found: ${input.runJsonPath}`);
    const runnerV2 = objectValue(current.runnerV2) || {};
    const liveness = objectValue(runnerV2.completionLiveness) || {};
    const previous = objectValue(liveness[input.agentId]);
    return {
      ...current,
      runnerV2: {
        ...runnerV2,
        completionLiveness: {
          ...liveness,
          [input.agentId]: {
            extensions: (numberValue(previous?.extensions) || 0) + 1,
            disposition: input.decision.disposition,
            reason: input.decision.reason,
            checkedAt: (input.now || new Date()).toISOString(),
          },
        },
      },
    };
  }, undefined, input.onMutation);
}

function clearCompletionLivenessExtension(
  runJsonPath: string,
  agentId: string,
  onMutation?: RunMutationObserver,
): RunRecord {
  return updateRunJson(runJsonPath, (current) => {
    if (!current) throw new Error(`run.json not found: ${runJsonPath}`);
    const runnerV2 = objectValue(current.runnerV2);
    const liveness = objectValue(runnerV2?.completionLiveness);
    if (!runnerV2 || !liveness || !(agentId in liveness)) return current;

    const nextLiveness = { ...liveness };
    delete nextLiveness[agentId];
    return {
      ...current,
      runnerV2: {
        ...runnerV2,
        completionLiveness: nextLiveness,
      },
    };
  }, undefined, onMutation);
}

function monitorCompletionRecoveryEvidence(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): CompletionRecoveryEvidence | undefined {
  const value = (env.MENTIKO_MONITOR_COMPLETION_LATCH || "").trim().toLowerCase();
  if (value === "durable-marker") return "durable-marker";
  if (value === "accepted-cross-run-event") return "accepted-cross-run-event";
  return undefined;
}

function readAgentSummaryArtifact(path: string): {
  summary?: Record<string, unknown>;
  parseError?: string;
} {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const summary = objectValue(parsed);
    return summary ? { summary } : { parseError: "summary must be a JSON object" };
  } catch (error) {
    return {
      parseError: error instanceof Error ? `summary JSON parse failed: ${error.message}` : "summary JSON parse failed",
    };
  }
}

function boundedStringArray(value: unknown, limit = 10): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map((item) => item.trim())
    .slice(0, limit);
}

function resolveStateDir(env: NodeJS.ProcessEnv | Record<string, string | undefined>, runDir: string): string {
  return env.STATE_DIR || join(runDir, "state");
}

function parseChainWebhooks(value: unknown): { enabled?: boolean; urls?: string[]; events?: string[] } | undefined {
  const raw = objectValue(value);
  if (!raw) return undefined;
  return {
    enabled: raw.enabled === true || raw.enabled === "true",
    urls: boundedStringArray(raw.urls, 20),
    events: boundedStringArray(raw.events, 20),
  };
}

/** Find a live canonical JSON fan group for this agent and run. */
function findLiveFanGroupMembership(stateDir: string, agentId: string, runId: string): string | undefined {
  for (const group of listFanGroups(stateDir)) {
    if (group.status !== "running") continue;
    if (runId && group.runId && group.runId !== runId) continue;
    if (group.fanOutAgents.includes(agentId)) return group.id;
  }
  return undefined;
}

function readEvents(eventsDir: string): RunnerEventRecord[] {
  if (!existsSync(eventsDir)) return [];
  return scanRunnerEventFiles(eventsDir).valid.map((file) => file.event);
}

function resolveAgent(sessionName: string, chain: ChainFile, run: RunRecord): ChainAgent {
  const runAgent = (run.agents || []).find((agent) => agent.session === sessionName);
  const agent = runAgent ? chain.agents.find((candidate) => candidate.id === runAgent.id) : undefined;
  if (agent) return normalizeAgent(agent, runAgent);

  const prefix = sessionPrefix(sessionName, chain);
  const byPrefix = chain.agents.find((candidate) => candidate.session_prefix === prefix)
    || chain.agents.find((candidate) => candidate.id === prefix)
    || chain.agents.find((candidate) => prefix.endsWith(candidate.id));
  if (byPrefix) return normalizeAgent(byPrefix);

  throw unsupported(`could not resolve agent for session: ${sessionName}`);
}

function normalizeAgent(agent: ChainAgent, runAgent?: RunAgentRecord): ChainAgent {
  return {
    ...agent,
    name: agent.name || runAgent?.name || agent.id,
  };
}

function sessionPrefix(sessionName: string, chain: ChainFile): string {
  let prefix = sessionName
    .replace(/-run-[0-9]+(-[0-9a-zA-Z]+)?$/, "")
    .replace(/-[0-9]{8}-[0-9]{4}$/, "");
  const chainPrefix = stringValue(chain.config?.session_prefix);
  if (chainPrefix && prefix.startsWith(`${chainPrefix}-`)) {
    prefix = prefix.slice(chainPrefix.length + 1);
  }
  return prefix;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function configuredSchedule(value: unknown): string | undefined {
  const direct = stringValue(value);
  if (direct) return direct;
  return stringValue(objectValue(value)?.cron);
}

function terminalOnComplete(value: unknown): OnCompletePolicy | undefined {
  const policy = stringValue(value);
  if (!policy) return undefined;
  if (policy === "stop" || policy === "keep" || policy === "archive" || policy === "webhook" || policy.startsWith("chain:")) {
    return policy as OnCompletePolicy;
  }
  return undefined;
}

function resolveCompletionChainId(run: RunRecord, chain: Pick<ChainFile, "id" | "name">): string | undefined {
  return stringValue(run.chainId)
    || stringValue(chain.id)
    || stringValue(chain.name)?.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function resolveRetryAttempt(input: {
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  runJsonPath: string;
  stateDir: string;
  agentId: string;
}): number {
  const rawValues = [input.env.MENTIKO_RETRY_ATTEMPT, input.env.RETRY_ATTEMPT]
    .filter((value): value is string => typeof value === "string" && value.trim() !== "");
  const parsedValues = rawValues.map((value) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`invalid retry attempt for agent ${input.agentId}: ${value}`);
    }
    return parsed;
  });
  if (new Set(parsedValues).size > 1) {
    throw new Error(`ambiguous retry attempt environment for agent ${input.agentId}: ${rawValues.join(",")}`);
  }
  const persisted = readTypedRetryAttempt(input.agentId, {
    runJsonPath: input.runJsonPath,
    stateDir: input.stateDir,
  });
  const fromEnv = parsedValues[0];
  if (fromEnv !== undefined && persisted !== undefined && fromEnv !== persisted) {
    throw new Error(`retry attempt disagreement for agent ${input.agentId}: env=${fromEnv} persisted=${persisted}`);
  }
  return persisted ?? fromEnv ?? 0;
}

function objectValue<T extends object = Record<string, unknown>>(value: unknown): T | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as T : undefined;
}

function restoreSnapshots(
  runJsonPath: string,
  runMutations: RunJsonMutation[],
  loopMutations: LoopFileMutation[],
): void {
  restoreRunMutationsLocked(runJsonPath, runMutations);
  restoreLoopMutations(loopMutations);
}

function restoreRunMutationsLocked(
  runJsonPath: string,
  mutations: RunJsonMutation[],
): void {
  if (mutations.length === 0) return;
  updateRunJson(runJsonPath, (current) => {
    if (!current) throw new Error(`run.json not found: ${runJsonPath}`);
    return [...mutations].reverse().reduce((run, mutation) => (
      mutation.before
        ? rollbackCompletionOwnedRun(mutation.before, mutation.after, run)
        : run
    ), current);
  });
}

const RUN_LIFECYCLE_KEYS = new Set(["status", "completed", "status_message"]);

interface PropertyState {
  present: boolean;
  value?: unknown;
}

function rollbackCompletionOwnedRun(
  baseline: RunRecord,
  completionOwned: RunRecord,
  current: RunRecord,
): RunRecord {
  const merged = rollbackOwnedRecord(
    baseline as unknown as Record<string, unknown>,
    completionOwned as unknown as Record<string, unknown>,
    current as unknown as Record<string, unknown>,
    new Set([...RUN_LIFECYCLE_KEYS, "agents", "runnerV2"]),
  );

  const lifecycle = rollbackProperty(
    present(pickProperties(baseline as unknown as Record<string, unknown>, RUN_LIFECYCLE_KEYS)),
    present(pickProperties(completionOwned as unknown as Record<string, unknown>, RUN_LIFECYCLE_KEYS)),
    present(pickProperties(current as unknown as Record<string, unknown>, RUN_LIFECYCLE_KEYS)),
    "lifecycle",
  ).value as Record<string, unknown>;
  for (const key of RUN_LIFECYCLE_KEYS) delete merged[key];
  Object.assign(merged, lifecycle);

  merged.agents = rollbackKeyedArray(
    baseline.agents || [],
    completionOwned.agents || [],
    current.agents || [],
  );

  const runnerV2 = rollbackProperty(
    property(baseline as unknown as Record<string, unknown>, "runnerV2"),
    property(completionOwned as unknown as Record<string, unknown>, "runnerV2"),
    property(current as unknown as Record<string, unknown>, "runnerV2"),
    "runnerV2",
  );
  if (runnerV2.present) merged.runnerV2 = runnerV2.value;
  else delete merged.runnerV2;

  return merged as unknown as RunRecord;
}

function rollbackOwnedRecord(
  baseline: Record<string, unknown> | undefined,
  completionOwned: Record<string, unknown> | undefined,
  current: Record<string, unknown> | undefined,
  skip = new Set<string>(),
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const keys = new Set([
    ...Object.keys(baseline || {}),
    ...Object.keys(completionOwned || {}),
    ...Object.keys(current || {}),
  ]);
  for (const key of keys) {
    if (skip.has(key)) continue;
    const rolledBack = rollbackProperty(
      property(baseline, key),
      property(completionOwned, key),
      property(current, key),
      key,
    );
    if (rolledBack.present) result[key] = rolledBack.value;
  }
  return result;
}

function rollbackProperty(
  baseline: PropertyState,
  completionOwned: PropertyState,
  current: PropertyState,
  key: string,
): PropertyState {
  if (propertyEqual(completionOwned, baseline)) return current;
  if (propertyEqual(current, completionOwned)) return baseline;

  if (
    completionOwned.present && current.present
    && Array.isArray(completionOwned.value) && Array.isArray(current.value)
    && (key === "agents" || key === "attempts")
    && (!baseline.present || Array.isArray(baseline.value))
  ) {
    return present(rollbackKeyedArray(
      baseline.present ? baseline.value as unknown[] : [],
      completionOwned.value,
      current.value,
    ));
  }

  const baselineRecord = recordValue(baseline);
  const completionOwnedRecord = recordValue(completionOwned);
  const currentRecord = recordValue(current);
  if (completionOwnedRecord && currentRecord && (baselineRecord || !baseline.present)) {
    const value = rollbackOwnedRecord(baselineRecord, completionOwnedRecord, currentRecord);
    if (!baseline.present && Object.keys(value).length === 0) return absent();
    return present(value);
  }

  // The current value differs from both baseline and the completion-owned
  // snapshot. Another writer won this field; preserve it rather than guessing.
  return current;
}

function rollbackKeyedArray(
  baseline: unknown[],
  completionOwned: unknown[],
  current: unknown[],
): unknown[] {
  const baselineMap = keyedArrayMap(baseline);
  const completionOwnedMap = keyedArrayMap(completionOwned);
  const currentMap = keyedArrayMap(current);
  if (!baselineMap || !completionOwnedMap || !currentMap) return current;

  const ids = [
    ...currentMap.keys(),
    ...[...baselineMap.keys()].filter((id) => !currentMap.has(id)),
  ];
  const result: unknown[] = [];
  for (const id of ids) {
    const baselineProperty = mapProperty(baselineMap, id);
    const completionOwnedProperty = mapProperty(completionOwnedMap, id);
    const currentProperty = mapProperty(currentMap, id);
    const baselineRecord = recordValue(baselineProperty);
    const completionOwnedRecord = recordValue(completionOwnedProperty);
    const currentRecord = recordValue(currentProperty);
    const rolledBack = baselineRecord && completionOwnedRecord && currentRecord
      ? present(rollbackOwnedRecord(baselineRecord, completionOwnedRecord, currentRecord))
      : rollbackAtomicProperty(
        baselineProperty,
        completionOwnedProperty,
        currentProperty,
      );
    if (rolledBack.present) result.push(rolledBack.value);
  }
  return result;
}

function rollbackAtomicProperty(
  baseline: PropertyState,
  completionOwned: PropertyState,
  current: PropertyState,
): PropertyState {
  if (propertyEqual(completionOwned, baseline)) return current;
  if (propertyEqual(current, completionOwned)) return baseline;
  return current;
}

function keyedArrayMap(values: unknown[]): Map<string, unknown> | undefined {
  const result = new Map<string, unknown>();
  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const id = (value as { id?: unknown }).id;
    if (typeof id !== "string" || result.has(id)) return undefined;
    result.set(id, value);
  }
  return result;
}

function pickProperties(source: Record<string, unknown>, keys: Set<string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) result[key] = source[key];
  }
  return result;
}

function property(source: Record<string, unknown> | undefined, key: string): PropertyState {
  return source && Object.prototype.hasOwnProperty.call(source, key)
    ? present(source[key])
    : absent();
}

function mapProperty(source: Map<string, unknown>, key: string): PropertyState {
  return source.has(key) ? present(source.get(key)) : absent();
}

function present(value: unknown): PropertyState {
  return { present: true, value };
}

function absent(): PropertyState {
  return { present: false };
}

function propertyEqual(left: PropertyState, right: PropertyState): boolean {
  return left.present === right.present
    && (!left.present || isDeepStrictEqual(left.value, right.value));
}

function recordValue(state: PropertyState): Record<string, unknown> | undefined {
  return state.present && state.value && typeof state.value === "object" && !Array.isArray(state.value)
    ? state.value as Record<string, unknown>
    : undefined;
}
