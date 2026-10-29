function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Unknown ownership remains protected; reconciliation is not an owner recovery protocol. */
export function hasReconcilerProtectedWork(run: Record<string, unknown>): boolean {
  const state = object(run.runnerV2);
  if (run.relaunchAuthorization) return true;
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
      return phase !== "completed" && phase !== "released";
    })) return true;
  }
  return false;
}
