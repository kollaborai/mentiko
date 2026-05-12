import { join } from "node:path";
import config, { nsPath, orgPath } from "@/lib/config";
import { resolveAppSecret } from "@/lib/dev-secret";

const SAFE_LINK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_PEER_SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const SAFE_LINK_RUN_ID_RE = /^run-\d+$/;

export interface LinkRunEnvOptions {
  namespaceId: string;
  orgId: string;
  runId: string;
  runsDir: string;
  workspacePath?: string;
  authSecret: string;
}

export function normalizeLinkId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!SAFE_LINK_ID_RE.test(trimmed)) return null;
  if (trimmed === "." || trimmed === "..") return null;
  return trimmed;
}

export function validateLinkRunId(value: unknown): value is string {
  return typeof value === "string" && SAFE_LINK_RUN_ID_RE.test(value);
}

export function normalizePeerSessionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!SAFE_PEER_SESSION_ID_RE.test(trimmed)) return null;
  return trimmed;
}

export function resolveLinkRunsDir(namespaceId: string, orgId: string): string {
  if (namespaceId === config.namespaceId && orgId === config.orgId) {
    return config.runsDir;
  }
  return orgPath(namespaceId, orgId, "runs");
}

export function resolveLinkRunPaths(namespaceId: string, orgId: string, runId: string) {
  const runsDir = resolveLinkRunsDir(namespaceId, orgId);
  const runDir = join(runsDir, runId);
  return {
    runsDir,
    runDir,
    runJsonPath: join(runDir, "run.json"),
    escalationsDir: join(runDir, "escalations"),
  };
}

export function resolvePeerEscalationDir(namespaceId: string, managerSession: string): string {
  return join(nsPath(namespaceId), "peer-escalations", managerSession);
}

export function resolvePeerOutputDir(namespaceId: string): string {
  return join(nsPath(namespaceId), "peer-output");
}

export function resolvePeerReplyPath(namespaceId: string, managerSession: string): string {
  return join(resolvePeerEscalationDir(namespaceId, managerSession), "reply.txt");
}

export function resolveLinkRunSecret(): string {
  return resolveAppSecret("link-run");
}

export function buildLinkRunEnv({
  namespaceId,
  orgId,
  runId,
  runsDir,
  workspacePath,
  authSecret,
}: LinkRunEnvOptions): Record<string, string> {
  const orgRoot = orgPath(namespaceId, orgId);
  const env: Record<string, string> = {
    BETTER_AUTH_SECRET: authSecret,
    LINK_RUN_ID: runId,
    MENTIKO_CODE_ROOT: config.codeRoot,
    MENTIKO_GLOBAL_ROOT: config.globalRoot,
    MENTIKO_NAMESPACE_ROOT: nsPath(namespaceId),
    MENTIKO_ORG_ROOT: orgRoot,
    MENTIKO_PROJECT_ROOT: orgRoot,
    NAMESPACE_ID: namespaceId,
    ORG_ID: orgId,
    RUNS_DIR: runsDir,
  };

  if (workspacePath) {
    env.PEER_WORK_DIR = workspacePath;
  }

  return env;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildShellSetup(env: Record<string, string | undefined>, cwd?: string): string {
  const parts = ["unset CLAUDECODE"];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    parts.push(`export ${key}=${shellQuote(value)}`);
  }
  if (cwd) {
    parts.push(`cd ${shellQuote(cwd)}`);
  }
  return parts.join(" && ");
}
