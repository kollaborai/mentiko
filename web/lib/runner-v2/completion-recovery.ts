import { findCompletionEvent } from "@/lib/runner-v2/completion";
import { readRunJson, updateRunAgent, updateRunStatus, type RunRecord } from "@/lib/runner-v2/run-state";
import {
  adoptAgentAttemptForCompletion,
  markAgentAttemptCompletedFromEvent,
  readRunnerV2AttemptState,
  type AgentAttemptRecord,
} from "@/lib/runner-v2/agent-attempt";
import { decideNextRoute, type RoutingChain, type RoutingDecision } from "@/lib/runner-v2/routing";
import type { RunnerEventRecord } from "@/lib/runner-v2/events";

export interface RecoverLateCompletionInput {
  runJsonPath: string;
  runId: string;
  chain: RoutingChain;
  events: Array<RunnerEventRecord | string>;
  now?: Date;
}

export interface LateCompletionRecovery {
  agentId: string;
  event: RunnerEventRecord;
  route: RoutingDecision;
}

export interface RecoverLateCompletionResult {
  recovered: LateCompletionRecovery[];
  run: RunRecord;
}

/**
 * Recover agents that were falsely terminalized `completion_failed /
 * retries_exhausted` while their valid completion event landed
 * `processed: false` shortly after the no-event retry budget exhausted (the
 * verified TASK-093 failure — the event arrived ~4.5 min after the exhaustion
 * verdict). This is the bash parity of `monitor-agent-died`'s "process gone but
 * completion event exists ... completing normally": before treating a
 * completion_failed / stopped run as final, adopt any unprocessed valid event
 * matching a completion_failed attempt, complete that agent, and return the
 * downstream route so the caller (reconcile / a runner-v2 sweep) can resume.
 *
 * Idempotent: it keys off agents whose LATEST attempt is `completion_failed`.
 * Once recovered, the latest attempt is `completed`, so a repeat pass adopts
 * nothing. Event matching reuses `findCompletionEvent` (same guards as the live
 * completion path: processed / run_id mismatch / diagnostic-source / event-name
 * / source-match) — this function never reimplements typed event matching.
 */
export function recoverLateCompletionEvents(input: RecoverLateCompletionInput): RecoverLateCompletionResult {
  const attempts = readRunnerV2AttemptState(input.runJsonPath).attempts
    .filter((attempt) => attempt.runId === input.runId);
  const stuckAgentIds = latestFailedAgentIds(attempts);

  const recovered: LateCompletionRecovery[] = [];
  for (const agentId of stuckAgentIds) {
    const agent = input.chain.agents.find((candidate) => candidate.id === agentId);
    if (!agent?.emits) continue;

    const match = findCompletionEvent({ agent, runId: input.runId, events: input.events });
    if (!match.matched || !match.event) continue;

    // the completion_failed attempt is terminal and cannot transition to
    // completed; adoption creates a fresh attempt at instructions_submitted for
    // exactly this "real completion evidence arrived after a false failure" case.
    adoptAgentAttemptForCompletion({
      runJsonPath: input.runJsonPath,
      runId: input.runId,
      agentId,
      now: input.now,
    });
    markAgentAttemptCompletedFromEvent({
      runJsonPath: input.runJsonPath,
      runId: input.runId,
      agentId,
      detail: `late completion event ${match.event.event} recovered after premature exhaustion`,
      now: input.now,
    });
    updateRunAgent(input.runJsonPath, agentId, "complete", input.now);

    recovered.push({ agentId, event: match.event, route: decideNextRoute(input.chain, match.event.event) });
  }

  if (recovered.length > 0) {
    // the run was falsely terminalized (stopped/failed). Reopen it when
    // downstream work will launch (or is still pending); otherwise the recovered
    // agent was the terminal agent and the run is genuinely completed. Terminal
    // side effects / launches stay the caller's job — this only un-sticks state.
    const hasDownstream = recovered.some((item) =>
      item.route.action === "launch"
      || (item.route.action === "wait" && item.route.pending === true));
    updateRunStatus(input.runJsonPath, hasDownstream ? "running" : "completed", undefined, input.now);
  }

  return { recovered, run: readRunJson(input.runJsonPath) };
}

/**
 * Agents whose most recent attempt ended `completion_failed`. Attempts are
 * stored in append order, so the last entry per agent is authoritative — the
 * same latest-wins rule `findLatestAttempt` uses. An agent later recovered to
 * `completed` drops out here, which is what makes repeat passes no-ops.
 */
function latestFailedAgentIds(attempts: AgentAttemptRecord[]): string[] {
  const latestByAgent = new Map<string, AgentAttemptRecord>();
  for (const attempt of attempts) {
    latestByAgent.set(attempt.agentId, attempt);
  }
  return [...latestByAgent.entries()]
    .filter(([, attempt]) => attempt.phase === "completion_failed")
    .map(([agentId]) => agentId);
}
