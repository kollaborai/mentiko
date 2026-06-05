import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { orgPath } from "../config";
import type { RawExecRequest } from "./schedule-dispatcher";

export interface ScheduledApplication {
  id: string;
  name: string;
  executable: string;
  args?: string[];
  workingDirectory?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  successExitCodes?: number[];
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

export function getScheduledApplicationsFile(namespaceId: string, orgId: string): string {
  return orgPath(namespaceId, orgId, "applications.json");
}

export function listScheduledApplications(namespaceId: string, orgId: string): ScheduledApplication[] {
  return listScheduledApplicationsFromFile(getScheduledApplicationsFile(namespaceId, orgId));
}

export function listScheduledApplicationsFromFile(file: string): ScheduledApplication[] {
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getScheduledApplication(
  namespaceId: string,
  orgId: string,
  id: string,
): ScheduledApplication | null {
  return listScheduledApplications(namespaceId, orgId).find((app) => app.id === id) || null;
}

export function addScheduledApplication(file: string, app: ScheduledApplication): ScheduledApplication {
  const now = new Date().toISOString();
  const apps = listScheduledApplicationsFromFile(file);
  if (apps.some((item) => item.id === app.id)) {
    throw new Error(`Application '${app.id}' already exists`);
  }
  const stored = {
    ...app,
    args: app.args || [],
    createdAt: app.createdAt || now,
    updatedAt: now,
  };
  mkdirSync(path.dirname(file), { recursive: true });
  apps.push(stored);
  writeFileSync(file, JSON.stringify(apps, null, 2));
  return stored;
}

export function upsertScheduledApplication(
  namespaceId: string,
  orgId: string,
  app: ScheduledApplication,
): ScheduledApplication {
  const file = getScheduledApplicationsFile(namespaceId, orgId);
  const apps = listScheduledApplicationsFromFile(file);
  const idx = apps.findIndex((item) => item.id === app.id);
  const now = new Date().toISOString();
  const stored = {
    ...app,
    args: app.args || [],
    createdAt: idx >= 0 ? apps[idx].createdAt : (app.createdAt || now),
    updatedAt: now,
  };

  if (idx >= 0) {
    apps[idx] = stored;
  } else {
    apps.push(stored);
  }

  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(apps, null, 2));
  return stored;
}

export function removeScheduledApplication(namespaceId: string, orgId: string, id: string): void {
  const file = getScheduledApplicationsFile(namespaceId, orgId);
  const apps = listScheduledApplicationsFromFile(file);
  const filtered = apps.filter((app) => app.id !== id);
  if (filtered.length === apps.length) {
    throw new Error(`Application '${id}' not found`);
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(filtered, null, 2));
}

export function resolveScheduledApplicationRun(
  file: string,
  appId: string,
  extraArgs: string[] = [],
): RawExecRequest {
  const app = listScheduledApplicationsFromFile(file).find((item) => item.id === appId);
  if (!app) throw new Error(`Application '${appId}' not found`);
  return {
    executable: app.executable,
    args: [...(app.args || []), ...extraArgs],
    workingDirectory: app.workingDirectory,
    env: app.env,
    timeoutMs: app.timeoutMs,
    successExitCodes: app.successExitCodes,
  };
}
