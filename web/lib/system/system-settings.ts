import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import config, { nsPath } from "@/lib/config";

export type SemanticPolicyMode = "enforce" | "warn";

/**
 * Namespace-scoped circuit breaker for SEMANTIC or experimental policy gates
 * (chain-contract-plan-of-record.md A6). If a future semantic acceptance rule
 * regresses the way the v0.3.48 prose classifier did, an admin can demote it
 * to warn-only here instead of shipping an emergency release.
 *
 * HARD BOUNDARY: structural integrity, schema, materialization, security,
 * authorization, and digest checks are NEVER demotable -- they must not
 * consult this override. Only rules registered as semantic may call
 * resolveSemanticPolicyMode. (As of v0.3.49 no such rule exists: the prose
 * lifecycle checks were removed outright, not parked behind this override.)
 */
export interface SemanticPolicyOverride {
  mode: SemanticPolicyMode;
  /** Rule IDs the override applies to; empty/absent = every semantic rule. */
  rule_ids?: string[];
  reason?: string;
  actor?: string;
  changed_at?: string;
  /** ISO timestamp; past expiry the override is inert and mode is enforce. */
  expires_at?: string;
}

export interface SystemSettings {
  max_concurrent_runs: number;
  auto_run_enabled: boolean;
  semantic_policy?: SemanticPolicyOverride;
}

const DEFAULTS: SystemSettings = {
  max_concurrent_runs: 5,
  auto_run_enabled: true,
};

function getSettingsPath(namespaceId?: string): string {
  const nsId = namespaceId || config.namespaceId;
  return join(nsPath(nsId), "system-settings.json");
}

export function readSystemSettings(namespaceId?: string): SystemSettings {
  const p = getSettingsPath(namespaceId);
  if (!existsSync(p)) return { ...DEFAULTS };
  try {
    const data = JSON.parse(readFileSync(p, "utf-8"));
    return { ...DEFAULTS, ...data };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeSystemSettings(settings: SystemSettings, namespaceId?: string): void {
  const p = getSettingsPath(namespaceId);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(settings, null, 2));
}

/**
 * Single source of truth for the max-concurrent-CHAINS ceiling, shared by the web run
 * starter and the task auto-runner so the two never diverge (phase-2 step 2).
 *
 * Resolution order:
 *   1. MENTIKO_MAX_CONCURRENT_CHAINS env — what the control plane sets PER HOSTING TIER
 *      at provisioning (2GB shared = 4, 8GB dedicated ~= 12-16). This is ALSO the var
 *      the bash engine (lib/concurrency-cap.sh / lib/config.sh) reads, so the web guard
 *      and the engine queue enforce the SAME number — one knob, both paths.
 *   2. the max_concurrent_runs system setting (admin-tunable at /settings/system).
 *   3. the system-settings default.
 *
 * Returns a non-negative integer. 0 means "unlimited" (matches the engine convention).
 */
export function resolveMaxConcurrentChains(namespaceId?: string): number {
  const envRaw = process.env.MENTIKO_MAX_CONCURRENT_CHAINS;
  if (envRaw != null && envRaw !== "") {
    const n = Number(envRaw);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return readSystemSettings(namespaceId).max_concurrent_runs;
}

/**
 * Effective mode for one SEMANTIC rule. Defaults to enforce; "warn" only while
 * an unexpired admin override covers the rule. Callers demoted to "warn" must
 * surface the violation as a typed warning in their result/diagnostics -- a
 * demoted rule is visible, never silent. Structural/security/authorization/
 * digest checks must not call this (see SemanticPolicyOverride).
 */
export function resolveSemanticPolicyMode(namespaceId?: string, ruleId?: string): SemanticPolicyMode {
  const override = readSystemSettings(namespaceId).semantic_policy;
  if (!override || override.mode !== "warn") return "enforce";
  if (override.expires_at) {
    const expires = Date.parse(override.expires_at);
    if (!Number.isNaN(expires) && expires <= Date.now()) return "enforce";
  }
  if (Array.isArray(override.rule_ids) && override.rule_ids.length > 0) {
    if (!ruleId || !override.rule_ids.includes(ruleId)) return "enforce";
  }
  return "warn";
}
