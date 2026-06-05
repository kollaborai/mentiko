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
