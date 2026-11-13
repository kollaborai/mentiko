import type { ReadinessConfig, RestartConfig } from "./pm-types";

type EnvSource = Record<string, string | undefined>;

export function resolveReadinessTimeout(
  readiness: ReadinessConfig | undefined,
  environment: EnvSource = process.env,
): number {
  if (!readiness || readiness.type === "none") return 0;

  const override = readiness.timeoutEnv ? Number(environment[readiness.timeoutEnv]) : Number.NaN;
  if (Number.isSafeInteger(override) && override > 0) return override;

  return readiness.timeout || (readiness.type === "timer" ? 1000 : 10000);
}

export function describeReadinessTarget(
  readiness: ReadinessConfig | undefined,
  expand = (value: string) => value,
): string {
  if (!readiness) return "no probe configured";
  switch (readiness.type) {
    case "socket":
      return `socket ${expand(readiness.path)}`;
    case "port":
      return `port ${readiness.port}`;
    case "http":
      return `HTTP ${expand(readiness.url)}`;
    case "timer":
      return "timer";
    case "none":
      return "disabled probe";
  }
}

export function formatReadinessTimeout(
  processName: string,
  readiness: ReadinessConfig | undefined,
  timeoutMs: number,
  expand?: (value: string) => string,
): string {
  return `${processName} readiness timeout after ${timeoutMs}ms (${describeReadinessTarget(readiness, expand)}), killing`;
}

export function resolveRestartDelay(
  restart: RestartConfig | undefined,
  restarts: number,
  random: () => number = Math.random,
): { delayMs: number; maxRestarts: number } | null {
  const policy = restart ?? {
    enabled: true,
    maxRestarts: 10,
    baseDelay: 1000,
    maxDelay: 30000,
    resetAfter: 60000,
    jitter: true,
  };
  const maxRestarts = policy.maxRestarts ?? 10;
  if (!policy.enabled || restarts >= maxRestarts) return null;

  let delayMs = Math.min(
    (policy.baseDelay ?? 1000) * Math.pow(2, restarts),
    policy.maxDelay ?? 30000,
  );
  if (policy.jitter ?? true) delayMs = Math.round(delayMs * (0.85 + random() * 0.3));
  return { delayMs, maxRestarts };
}
