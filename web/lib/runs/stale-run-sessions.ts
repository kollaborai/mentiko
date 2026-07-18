export interface RunSessionSource {
  id?: string;
  sessions?: string[];
  agents?: Array<{ session?: string }>;
  runnerV2?: {
    attempts?: Array<{
      runId?: string;
      leaseId?: string;
      processEvidence?: { ptySessionId?: string };
    }>;
  };
}

/**
 * A failed typed bootstrap can persist its PTY lease only in runnerV2.attempts
 * before the legacy run-agent session field is populated. Cleanup must include
 * both representations, the validated legacy sessions registry, and each
 * derived monitor identity or a dead lease reserves the next resume's name.
 */
export function collectStaleRunSessionNames(run: RunSessionSource): string[] {
  const names = new Set<string>();
  const addSessionAndMonitor = (value: unknown): void => {
    // Empty/non-string session fields are valid for pending agents and cannot
    // identify a PTY. Preserve the persisted value exactly; the monitor name
    // is derived only after a usable agent session identity is present.
    if (typeof value !== "string" || value.trim() === "") return;
    names.add(value);
    names.add(`monitor-${value}`);
  };
  for (const agent of Array.isArray(run.agents) ? run.agents : []) {
    addSessionAndMonitor(agent.session);
  }
  for (const session of Array.isArray(run.sessions) ? run.sessions : []) {
    addSessionAndMonitor(session);
  }
  const attempts = Array.isArray(run.runnerV2?.attempts) ? run.runnerV2.attempts : [];
  for (const attempt of attempts) {
    if (!attempt || typeof attempt !== "object" || Array.isArray(attempt)) continue;
    const candidate = attempt as {
      runId?: unknown;
      leaseId?: unknown;
      processEvidence?: { ptySessionId?: unknown };
    };
    if (typeof run.id !== "string" || candidate.runId !== run.id) continue;
    addSessionAndMonitor(candidate.leaseId);
    addSessionAndMonitor(candidate.processEvidence?.ptySessionId);
  }
  return [...names];
}
