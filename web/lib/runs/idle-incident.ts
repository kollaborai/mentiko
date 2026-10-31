import type { RunRecord } from "@/lib/runs/run-record";

/** Clear only the same open occurrence when execution state changed. */
export function clearIdleIncidentOnActivity(current: RunRecord | undefined, next: RunRecord): RunRecord {
  const previousState = current?.runnerV2 as Record<string, unknown> | undefined;
  const nextState = next.runnerV2 as Record<string, unknown> | undefined;
  const incident = previousState?.idleIncident as Record<string, unknown> | undefined;
  if (current && incident?.status === "open" && JSON.stringify(incident) === JSON.stringify(nextState?.idleIncident)
    && JSON.stringify(activity(current)) !== JSON.stringify(activity(next))) {
    return { ...next, runnerV2: { ...nextState, idleIncident: {
      ...incident, status: "cleared", clearedAt: new Date().toISOString(), clearReason: "run state changed",
    } } };
  }
  return next;
}

function activity(run: RunRecord): unknown {
  const state = (run.runnerV2 || {}) as Record<string, unknown>;
  const agents = (Array.isArray(run.agents) ? run.agents : []).map(({ id, status, session, started, completed, lastHeartbeat }) => ({ id, status, session, started, completed, lastHeartbeat }));
  return [run.status, run.resumedAt, run.relaunchAuthorization, run.relaunchAuthorizations, run.sessions, agents, run.escalations,
    state.pendingHandoffs, state.launchJobs, state.attempts];
}
