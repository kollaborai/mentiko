const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

export function isRunnerV2Enabled(env: Record<string, string | undefined> = process.env): boolean {
  const value = env.MENTIKO_RUNNER_V2;
  return typeof value === "string" && ENABLED_VALUES.has(value.trim().toLowerCase());
}
