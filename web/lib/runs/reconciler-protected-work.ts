function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Lifecycle terminality alone does not prove a process has relinquished ownership. */
export function attemptMayOwnWork(phase: unknown): boolean {
  return phase !== "completed" && phase !== "released";
}

/** A timestamp and attempt alone do not prove which occurrence consumed a grant. */
export function hasPendingRelaunchAuthorizations(run: Record<string, unknown>): boolean {
  const singular = run.relaunchAuthorization;
  if (singular != null) return true;
  const value = run.relaunchAuthorizations;
  if (value == null) return false;
  if (typeof value !== "object" || Array.isArray(value)) return true;
  return Object.keys(object(value)).length > 0;
}

/** Unknown ownership remains protected; reconciliation is not an owner recovery protocol. */
export function hasReconcilerProtectedWork(run: Record<string, unknown>): boolean {
  if (run.runnerV2 != null && (typeof run.runnerV2 !== "object" || Array.isArray(run.runnerV2))) return true;
  const state = object(run.runnerV2);
  if (hasPendingRelaunchAuthorizations(run)) return true;
  if (state.pendingHandoffs != null && (!Array.isArray(state.pendingHandoffs) || state.pendingHandoffs.length > 0)) return true;
  if (state.launchJobs != null) {
    if (typeof state.launchJobs !== "object" || Array.isArray(state.launchJobs)) return true;
    if (Object.values(object(state.launchJobs)).some((job) => !["completed", "blocked"].includes(String(object(job).status)))) return true;
  }
  if (state.attempts != null) {
    if (!Array.isArray(state.attempts)) return true;
    if (state.attempts.some((attempt) => {
      const phase = object(attempt).phase;
      // Some terminal attempt phases (such as stuck) can still own a live
      // process. Only completion or explicit release rules out that work here.
      return attemptMayOwnWork(phase);
    })) return true;
  }
  return false;
}
