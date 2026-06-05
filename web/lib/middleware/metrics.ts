/**
 * metrics: performance monitoring for guest enforcement middleware.
 * non-blocking, graceful degradation if metrics service unavailable.
 */

import type { OrgRole } from "../orgs/org-types";

export type GuestEnforcementMetricType =
  | "guest_block_total"
  | "guest_allow_total"
  | "enforcement_latency_ms"
  | "audit_emit_failure_total"
  | "session_resolution_failure_total";

export interface GuestEnforcementMetric {
  type: GuestEnforcementMetricType;
  value: number;
  labels: {
    role: OrgRole;
    method: string;
    route?: string;
    decision?: "allowed" | "blocked";
  };
  timestamp: string;
}

export interface MetricsRecorderOptions {
  enabled?: boolean;
  sampleRate?: number;
  throwOnError?: boolean;
}

const DEFAULT_METRICS_OPTIONS: Required<MetricsRecorderOptions> = {
  enabled: true,
  sampleRate: 1.0,
  throwOnError: false,
};

let metricsRecorderFn: ((metric: GuestEnforcementMetric) => Promise<void>) | null = null;

export function setMetricsRecorder(fn: (metric: GuestEnforcementMetric) => Promise<void>) {
  metricsRecorderFn = fn;
}

async function recordMetricInternal(metric: GuestEnforcementMetric): Promise<void> {
  if (!metricsRecorderFn) {
    return;
  }

  try {
    await metricsRecorderFn(metric);
  } catch (error) {
    console.error("[guest-enforcement] metrics record failed:", error);
    throw error;
  }
}

export async function recordGuestEnforcementMetric(
  metric: GuestEnforcementMetric,
  options: MetricsRecorderOptions = {}
): Promise<void> {
  const opts = { ...DEFAULT_METRICS_OPTIONS, ...options };

  if (!opts.enabled) {
    return;
  }

  if (Math.random() > opts.sampleRate) {
    return;
  }

  try {
    await recordMetricInternal(metric);
  } catch (error) {
    if (opts.throwOnError) {
      throw error;
    }
  }
}

export async function incrementCounter(
  type: GuestEnforcementMetricType,
  labels: GuestEnforcementMetric["labels"],
  options: MetricsRecorderOptions = {}
): Promise<void> {
  await recordGuestEnforcementMetric(
    {
      type,
      value: 1,
      labels,
      timestamp: new Date().toISOString(),
    },
    options
  );
}

export async function recordLatency(
  durationMs: number,
  labels: { role: OrgRole; method: string; route?: string },
  options: MetricsRecorderOptions = {}
): Promise<void> {
  await recordGuestEnforcementMetric(
    {
      type: "enforcement_latency_ms",
      value: durationMs,
      labels,
      timestamp: new Date().toISOString(),
    },
    options
  );
}
