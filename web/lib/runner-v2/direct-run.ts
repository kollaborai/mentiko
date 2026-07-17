import { mkdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import config from "@/lib/config";
import { startRunnerV2Bootstrap } from "@/lib/runner-v2/bootstrap-executor";
import { loadNormalizedChainDefinition, type ChainRecord } from "@/lib/runner-v2/chain-contract";
import { validateChainFile } from "@/lib/runner-v2/chain-validation-cli";
import { createRunRecord, updateRunJson, updateRunStatus } from "@/lib/runner-v2/run-state";
import type { RunnerV2LaunchResult } from "@/lib/runner-v2/types";

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
  parentRunId?: string;
  /** Explicit runtime root for an internal typed caller (for example on_complete chaining). */
  runsDir?: string;
}
export interface DirectRunResult { runId: string; runDir: string; agentId: string; launch: RunnerV2LaunchResult }

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
  let debug = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--workspace") { workspacePath = requiredValue(argv, index, arg); index += 1; continue; }
    if (arg === "--start") { agentId = requiredValue(argv, index, arg); index += 1; continue; }
    if (arg === "--debug") { debug = true; continue; }
    if (arg === "--task" || arg === "--parallel" || arg === "--dry-run") {
      throw new Error(`${arg} is not supported by typed direct run; use its dedicated typed entrypoint`);
    }
    if (arg.startsWith("--")) throw new Error(`unsupported mentiko run option: ${arg}`);
    if (chainPath) throw new Error(`unexpected positional argument: ${arg}`);
    chainPath = arg;
  }
  if (!chainPath) throw new Error("usage: mentiko run <chain.json> [--workspace <path>] [--start <agent-id>] [--debug]");
  return { chainPath: resolve(chainPath), workspacePath, agentId, debug };
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

export async function runTypedDirect(options: DirectRunOptions): Promise<DirectRunResult> {
  const validation = validateChainFile(options.chainPath, true);
  if (validation.errors.length > 0) throw new Error(validation.errors.join("\n"));
  const chain = loadNormalizedChainDefinition(options.chainPath, config.agentsDir);
  const workspaceType = (chain.config as Record<string, unknown> | undefined)?.workspace as Record<string, unknown> | undefined;
  if (workspaceType?.type && workspaceType.type !== "local") throw new Error(`typed direct run supports local workspaces only, got ${workspaceType.type}`);
  if (process.env.WORKSPACE_TYPE && process.env.WORKSPACE_TYPE !== "local") throw new Error(`typed direct run supports local workspaces only, got ${process.env.WORKSPACE_TYPE}`);
  const workspacePath = localWorkspace(options.workspacePath);
  const selected = chainAgent(chain, options.agentId);
  const chainName = typeof chain.name === "string" && chain.name ? chain.name : basename(options.chainPath, ".json");
  const runsDir = options.runsDir ? localWorkspace(options.runsDir) : config.runsDir;
  if (!runsDir) throw new Error("typed direct run requires a runs directory");
  const run = createRunRecord({
    chainName,
    goal: typeof chain.description === "string" ? chain.description : "",
    workspacePath,
    parentRunId: options.parentRunId,
  });
  const runDir = join(runsDir, run.id);
  mkdirSync(runDir, { recursive: true, mode: 0o700 });
  const chainPath = join(runDir, "chain.json");
  writeFileSync(chainPath, `${JSON.stringify(chain, null, 2)}\n`, { mode: 0o600 });
  updateRunJson(join(runDir, "run.json"), () => run);
  const launch = await startRunnerV2Bootstrap({
    chainPath, runDir, runId: run.id, agentId: selected.id,
    chainId: typeof chain.id === "string" ? chain.id : basename(options.chainPath, ".json"),
    chainName, workspacePath, debug: options.debug, logFd: 2, cwd: workspacePath || process.cwd(), env: process.env,
  });
  if (launch.support === "unsupported") {
    updateRunStatus(join(runDir, "run.json"), "failed", `typed direct launch failed: ${launch.reason}`);
    throw new Error(launch.reason);
  }
  return { runId: run.id, runDir, agentId: selected.id, launch };
}
