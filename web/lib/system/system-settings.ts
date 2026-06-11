import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import config, { nsPath } from "@/lib/config";

export interface SystemSettings {
  max_concurrent_runs: number;
  auto_run_enabled: boolean;
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
