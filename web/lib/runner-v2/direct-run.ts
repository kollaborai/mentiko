import { mkdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import config from "@/lib/config";
import { startRunnerV2Bootstrap } from "@/lib/runner-v2/bootstrap-executor";
import { loadNormalizedChainDefinition, type ChainRecord } from "@/lib/runner-v2/chain-contract";
import { validateChainFile } from "@/lib/runner-v2/chain-validation-cli";
import { createRunRecord, updateRunJson, updateRunStatus } from "@/lib/runner-v2/run-state";
import { loadTaskContext, taskContextEnvironment } from "@/lib/runner-v2/task-context";
import type { RunnerV2LaunchStarted } from "@/lib/runner-v2/types";

/**
 * Typed initial-run creation. `parentRunId` is intentionally an explicit
 * provenance field rather than an inherited environment variable: chained
 * runs must never accidentally attach to the completing run that happened to
 * invoke the launcher.
 */
export interface DirectRunOptions {
  chainPath: string;
  workspacePath?: string;
  agentId?: string;
  debug: boolean;
  /** Internal callers may reserve a typed run identity before bootstrap. */
  runId?: string;
  /** Internal callers may preserve an invocation-specific goal in run provenance. */
  goal?: string;
  parentRunId?: string;
  /** Associate the created run with an existing task without shell task-context parsing. */
  taskId?: string;
  /** Validate and select the initial agent without creating a run or PTY. */
  dryRun?: boolean;
  /** Typed callers may provide a scoped environment instead of process.env. */
  env?: NodeJS.ProcessEnv;
  /** Explicit runtime root for an internal typed caller (for example on_complete chaining). */
  runsDir?: string;
}
export interface DirectRunLaunchResult { dryRun?: false; runId: string; runDir: string; agentId: string; launch: RunnerV2LaunchStarted }
export interface DirectRunDryRunResult { dryRun: true; chainName: string; agentId: string; workspacePath?: string }
export type DirectRunResult = DirectRunLaunchResult | DirectRunDryRunResult;

function requiredValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

/** Parse only the direct local initial-launch contract. Everything else is rejected. */
export function parseDirectRunArgs(argv: string[]): DirectRunOptions {
  let chainPath: string | undefined;
  let workspacePath: string | undefined;
  let agentId: string | undefined;
  let taskId: string | undefined;
  let dryRun = false;
  let debug = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--workspace") { workspacePath = requiredValue(argv, index, arg); index += 1; continue; }
    if (arg === "--start") { agentId = requiredValue(argv, index, arg); index += 1; continue; }
    if (arg === "--task") { taskId = requiredValue(argv, index, arg); index += 1; continue; }
    if (arg === "--dry-run") { dryRun = true; continue; }
    if (arg === "--debug") { debug = true; continue; }
    if (arg === "--parallel") {
      throw new Error("--parallel was retired: use the typed batch API for independent chains or declared fan-out branches for agents in one chain");
    }
    if (arg.startsWith("--")) throw new Error(`unsupported mentiko run option: ${arg}`);
    if (chainPath) throw new Error(`unexpected positional argument: ${arg}`);
    chainPath = arg;
  }
  if (!chainPath) throw new Error("usage: mentiko run <chain.json> [--workspace <path>] [--start <agent-id>] [--debug]");
  return { chainPath: resolve(chainPath), workspacePath, agentId, taskId, dryRun, debug };
}

function chainAgent(chain: ChainRecord, requested?: string): { id: string; name: string } {
  const agent = requested
    ? chain.agents.find((candidate) => candidate.id === requested)
    : chain.agents.find((candidate) => Array.isArray(candidate.triggers) && candidate.triggers.includes("manual-start")) || chain.agents[0];
  if (!agent || typeof agent.id !== "string" || !agent.id) throw new Error("chain has no launchable initial agent");
  return { id: agent.id, name: typeof agent.name === "string" && agent.name ? agent.name : agent.id };
}

function localWorkspace(path?: string): string | undefined {
  if (!path) return undefined;
  const resolved = realpathSync(path);
  if (!statSync(resolved).isDirectory()) throw new Error(`workspace must be a directory: ${path}`);
  return resolved;
}

/** Resolve a product-owned run root without treating it as an execution workspace. */
function runtimeRunsDir(path?: string): string {
  const configured = path ? resolve(path) : config.runsDir;
  if (!configured) throw new Error("typed direct run requires a runs directory");
  mkdirSync(configured, { recursive: true, mode: 0o700 });
  const resolved = realpathSync(configured);
  if (!statSync(resolved).isDirectory()) throw new Error(`runs directory must be a directory: ${configured}`);
  return resolved;
}

export async function runTypedDirect(options: DirectRunOptions): Promise<DirectRunResult> {
  const env = options.env ?? process.env;
  const validation = validateChainFile(options.chainPath, true);
  if (validation.errors.length > 0) throw new Error(validation.errors.join("\n"));
  const chain = loadNormalizedChainDefinition(options.chainPath, config.agentsDir);
  const workspaceType = (chain.config as Record<string, unknown> | undefined)?.workspace as Record<string, unknown> | undefined;
  if (workspaceType?.type && workspaceType.type !== "local") throw new Error(`typed direct run supports local workspaces only, got ${workspaceType.type}`);
  if (env.WORKSPACE_TYPE && env.WORKSPACE_TYPE !== "local") throw new Error(`typed direct run supports local workspaces only, got ${env.WORKSPACE_TYPE}`);
  const workspacePath = localWorkspace(options.workspacePath);
  const selected = chainAgent(chain, options.agentId);
  const chainName = typeof chain.name === "string" && chain.name ? chain.name : basename(options.chainPath, ".json");
  if (options.dryRun) return { dryRun: true, chainName, agentId: selected.id, workspacePath };
  const taskEnv = options.taskId ? await loadTypedTaskContext(options.taskId, env) : {};
  const runsDir = runtimeRunsDir(options.runsDir);
  const run = createRunRecord({
    runId: options.runId,
    chainName,
    goal: options.goal ?? (typeof chain.description === "string" ? chain.description : ""),
    workspacePath,
    taskId: options.taskId,
    parentRunId: options.parentRunId,
  });
  const runDir = join(runsDir, run.id);
  // A caller-provided identity is a durable reservation, never permission to
  // replace an existing run's immutable chain snapshot or provenance.
  mkdirSync(runDir, { recursive: false, mode: 0o700 });
  const chainPath = join(runDir, "chain.json");
  writeFileSync(chainPath, `${JSON.stringify(chain, null, 2)}\n`, { mode: 0o600 });
  updateRunJson(join(runDir, "run.json"), () => run);
  const launch = await startRunnerV2Bootstrap({
    chainPath, runDir, runId: run.id, agentId: selected.id,
    chainId: typeof chain.id === "string" ? chain.id : basename(options.chainPath, ".json"),
    chainName, workspacePath, taskId: options.taskId, debug: options.debug, logFd: 2, cwd: workspacePath || process.cwd(), env: { ...env, ...taskEnv },
  });
  if (launch.support === "unsupported") {
    updateRunStatus(join(runDir, "run.json"), "failed", `typed direct launch failed: ${launch.reason}`, undefined, undefined, undefined,
      { actor: "system", reason: `typed direct launch failed: ${launch.reason}` });
    throw new Error(launch.reason);
  }
  return { runId: run.id, runDir, agentId: selected.id, launch };
}

async function loadTypedTaskContext(taskId: string, env: NodeJS.ProcessEnv): Promise<Record<string, string>> {
  const apiBase = env.BETTER_AUTH_URL || env.MENTIKO_WEB_URL || `http://localhost:${env.WEB_PORT || env.PORT || "3000"}`;
  const context = await loadTaskContext({
    taskId,
    apiBase,
    authToken: env.BETTER_AUTH_SECRET,
    namespaceId: env.NAMESPACE_ID || "default",
    orgId: env.ORG_ID || "default",
  });
  return taskContextEnvironment(context, {
    namespaceId: env.NAMESPACE_ID || "default",
    orgId: env.ORG_ID || "default",
    sourceRunId: env.MENTIKO_RUN_ID || undefined,
    chainId: env.MENTIKO_CHAIN_ID || undefined,
  });
}
