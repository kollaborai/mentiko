export const RUNNER_CONTROL_ENV_KEYS = [
  // Startup readiness and bounded recovery.
  "MENTIKO_READINESS_FAIL_CLOSED",
  "MENTIKO_STARTUP_RECOVERY",
  "MENTIKO_STARTUP_RECOVERY_MAX",
  "MENTIKO_CLI_READY_TIMEOUT",
  "MENTIKO_CLI_READY_POLL",

  // Monitor liveness and instruction-submission policy.
  "MENTIKO_MONITOR_INTERVAL",
  "MENTIKO_MONITOR_MAX_STALE",
  "MENTIKO_ADVISOR_STALE_COUNT",
  "MENTIKO_MONITOR_MAX_NUDGES",
  "MENTIKO_MONITOR_NEVER_ARMED_GRACE",
  "MENTIKO_RUNNER_V2_SUBMISSION_POLL_MS",
  "MENTIKO_RUNNER_V2_SUBMISSION_DEADLINE_MS",

  // Tenant execution capacity. These values are assigned by hosting tier and
  // must survive supervisor, detached runner, monitor, and routed handoffs.
  "MENTIKO_CAP_DISABLED",
  "MENTIKO_MAX_CONCURRENT_CHAINS",
  "MENTIKO_CAP_MAX_WAIT_SECS",
  "MENTIKO_CAP_POLL_SECS",
  "MENTIKO_CAP_POLL_MAX_SECS",
  "MENTIKO_MAX_ACTIVE_AGENTS",
  "MAX_CONCURRENT_AGENTS",
  "MENTIKO_AGENT_CAP_MAX_WAIT_SECS",
  "MENTIKO_AGENT_CAP_POLL_SECS",
  "MENTIKO_AGENT_CAP_POLL_MAX_SECS",

  // Typed-runner migration switches.
  "MENTIKO_RUNNER_V2",
  "MENTIKO_RUNNER_V2_COMPLETION",
] as const;

type EnvSource = Record<string, string | undefined> | undefined;

/** Pick only safe runner controls, preferring the first non-empty source. */
export function pickRunnerControlEnv(...sources: EnvSource[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of RUNNER_CONTROL_ENV_KEYS) {
    for (const source of sources) {
      const value = source?.[key];
      if (typeof value !== "string" || value.length === 0) continue;
      result[key] = value;
      break;
    }
  }
  return result;
}
