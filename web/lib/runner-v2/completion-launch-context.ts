import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { basename, dirname, isAbsolute, join, resolve } from "path";
import { tmpdir } from "os";

const CONTEXT_DIR_PREFIX = "mentiko-completion-context-";
const CONTEXT_FILE_NAME = "context.json";
const REAL_TMP_DIR = realpathSync(tmpdir());

export const COMPLETION_CONTEXT_ENV_KEYS = [
  "DEBUG", "MENTIKO_DEBUG", "NODE_ENV",
  "MENTIKO_RUN_ID", "RUN_ID", "NAMESPACE_ID", "ORG_ID", "WORKSPACE_TYPE",
  "MENTIKO_RUN_DIR", "RUN_DIR", "RUNS_DIR", "MENTIKO_GLOBAL_ROOT", "MENTIKO_CODE_ROOT",
  "MENTIKO_PROJECT_ROOT", "MENTIKO_ORG_ROOT", "MENTIKO_NAMESPACE_ROOT",
  "EVENTS_DIR", "STATE_DIR", "SCHEDULES_DIR", "AGENT_PROFILES_DIR", "MENTIKO_WEB_URL",
  // Routed agents can require authenticated Mentiko MCP operations. Keep this
  // run-scoped capability in the private one-shot context, never in argv or
  // durable run state.
  "MENTIKO_SESSION_ID", "MENTIKO_SESSION_TOKEN",
  "KOLLABOR_ENGINE_URL", "MENTIKO_RUNNER_V2", "MENTIKO_RUNNER_V2_COMPLETION",
  "MENTIKO_RUNNER_V2_COMPLETION_DRY_RUN", "MENTIKO_RUNNER_V2_COMPLETION_MAX_EXTENSIONS",
  "MENTIKO_RUNNER_V2_PTY_PROBE_TIMEOUT_MS", "MENTIKO_LAUNCH_ACCEPT_TIMEOUT_MS",
  "MENTIKO_NEXT_CHAIN_ACCEPT_TIMEOUT_MS", "MENTIKO_COMPLETION_OCCURRENCE_ID",
  "MENTIKO_AGENT_ATTEMPT_ID",
  "MENTIKO_MONITOR_COMPLETION_LATCH", "MENTIKO_AI_GATEWAY_LOCAL_PROXY_ENABLED",
  "MENTIKO_AI_GATEWAY_LOCAL_BASE_URL", "MENTIKO_AI_GATEWAY_LOCAL_TOKEN",
  "MENTIKO_GENERATION_JOB_ID", "MENTIKO_GENERATION_KIND", "MENTIKO_JOB_IMPORT_TOKEN",
  "MENTIKO_TASK_ID", "MENTIKO_PARENT_RUN_ID", "MENTIKO_MONITOR_STATE_DIR",
  "MENTIKO_AGENT_PROFILE_PATH", "MENTIKO_WORKSPACE_PATH",
  "MENTIKO_PTY_MGR_BIN", "PTY_MGR_BIN", "MENTIKO_RETRY_ATTEMPT", "RETRY_ATTEMPT",
  "PTY_DAEMON",
] as const;
const ALLOWED_KEYS = new Set<string>(COMPLETION_CONTEXT_ENV_KEYS);
const REQUIRED_KEYS = [
  "MENTIKO_RUN_ID", "MENTIKO_RUN_DIR", "MENTIKO_CODE_ROOT", "EVENTS_DIR", "STATE_DIR",
] as const;

interface CompletionLaunchContextFile {
  version: 1;
  env: Record<string, string>;
}

export interface CompletionLaunchContextReceipt {
  dir: string;
  path: string;
}

export function createCompletionLaunchContext(
  input: NodeJS.ProcessEnv | Record<string, string | undefined>,
): CompletionLaunchContextReceipt {
  const env: Record<string, string> = {};
  for (const key of COMPLETION_CONTEXT_ENV_KEYS) {
    const value = input[key];
    if (typeof value === "string") env[key] = value;
  }
  validateContextEnv(env);

  const dir = mkdtempSync(join(REAL_TMP_DIR, CONTEXT_DIR_PREFIX));
  chmodSync(dir, 0o700);
  const path = join(dir, CONTEXT_FILE_NAME);
  writeFileSync(path, `${JSON.stringify({ version: 1, env } satisfies CompletionLaunchContextFile)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  chmodSync(path, 0o600);
  return { dir, path };
}

export function consumeCompletionLaunchContext(
  path: string,
  target: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Record<string, string> {
  assertCompletionLaunchContextPath(path);
  const parent = dirname(path);
  const dirStat = lstatSync(parent);
  const fileStat = lstatSync(path);
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink() || (dirStat.mode & 0o777) !== 0o700) {
    throw new Error("completion launch context directory must be private mode 0700");
  }
  if (!fileStat.isFile() || fileStat.isSymbolicLink() || (fileStat.mode & 0o777) !== 0o600) {
    throw new Error("completion launch context file must be regular mode 0600");
  }
  if (fileStat.size > 64 * 1024) {
    throw new Error("completion launch context exceeds 64 KiB");
  }

  const raw = readFileSync(path, "utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("completion launch context is malformed JSON");
  }
  if (!parsed || typeof parsed !== "object" || (parsed as { version?: unknown }).version !== 1) {
    throw new Error("completion launch context has unsupported version");
  }
  const env = (parsed as { env?: unknown }).env;
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    throw new Error("completion launch context env must be an object");
  }
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!ALLOWED_KEYS.has(key)) throw new Error(`completion launch context contains unsupported key: ${key}`);
    if (typeof value !== "string") throw new Error(`completion launch context value must be a string: ${key}`);
    normalized[key] = value;
  }
  validateContextEnv(normalized);
  Object.assign(target, normalized);
  // Deletion is the child-acceptance receipt. It occurs only after the full
  // payload has validated and merged, so malformed input cannot look accepted.
  unlinkSync(path);
  return normalized;
}

export function cleanupCompletionLaunchContext(path: string): void {
  if (!isCompletionLaunchContextPath(path)) return;
  try {
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    rmdirSync(dirname(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function assertCompletionLaunchContextPath(path: string): void {
  if (!isCompletionLaunchContextPath(path)) {
    throw new Error(
      `completion launch context path must match ${REAL_TMP_DIR}/${CONTEXT_DIR_PREFIX}*/${CONTEXT_FILE_NAME}`,
    );
  }
}

function isCompletionLaunchContextPath(path: string): boolean {
  if (!path || !isAbsolute(path) || resolve(path) !== path || basename(path) !== CONTEXT_FILE_NAME) {
    return false;
  }
  const parent = dirname(path);
  const dirName = basename(parent);
  return dirname(parent) === REAL_TMP_DIR
    && /^mentiko-completion-context-[A-Za-z0-9_-]+$/.test(dirName);
}

function validateContextEnv(env: Record<string, string>): void {
  for (const key of REQUIRED_KEYS) {
    if (!env[key]?.trim()) throw new Error(`completion launch context missing required key: ${key}`);
  }
}
