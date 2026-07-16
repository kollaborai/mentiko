import { realpathSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import config from "@/lib/config";
import { startRunnerV2Bootstrap } from "@/lib/runner-v2/bootstrap-executor";
import { loadNormalizedChainDefinition, type ChainRecord } from "@/lib/runner-v2/chain-contract";
import { validateChainFile } from "@/lib/runner-v2/chain-validation-cli";
import { readRunnerV2AttemptState } from "@/lib/runner-v2/agent-attempt";
import { readRunRecordAt, resolveExistingRunRecordPaths } from "@/lib/runs/run-record";
import type { RunnerV2LaunchResult } from "@/lib/runner-v2/types";

export interface ExistingRunLaunchOptions { runsDir: string; runId: string; workspacePath?: string; agentId?: string; debug?: boolean; env?: NodeJS.ProcessEnv }
export interface ExistingRunLaunchResult { runId: string; runDir: string; chainPath: string; agentId: string; launch: RunnerV2LaunchResult }

const TERMINAL = new Set(["blocked", "failed", "stopped", "completed", "cancelled"]);

function localWorkspace(path?: string): string | undefined {
  if (!path) return undefined;
  const resolved = realpathSync(path);
  if (!statSync(resolved).isDirectory()) throw new Error(`workspace must be a directory: ${path}`);
  return resolved;
}

function selectInitialAgent(chain: ChainRecord, requested?: string): string {
  const agent = requested
    ? chain.agents.find((candidate) => candidate.id === requested)
    : chain.agents.find((candidate) => Array.isArray(candidate.triggers) && candidate.triggers.includes("manual-start")) || chain.agents[0];
  if (!agent || typeof agent.id !== "string" || !agent.id) throw new Error("chain has no launchable initial agent");
  return agent.id;
}

/** Bootstrap exactly one pristine preallocated run; it never creates or replaces a record. */
export async function launchExistingTypedRun(options: ExistingRunLaunchOptions): Promise<ExistingRunLaunchResult> {
  const paths = resolveExistingRunRecordPaths(options.runsDir, options.runId);
  const run = readRunRecordAt(paths.runsDir, options.runId);
  if (TERMINAL.has(run.status)) throw new Error(`existing run ${run.id} is terminal (${run.status})`);
  const attempts = readRunnerV2AttemptState(paths.runJsonPath).attempts;
  if ((run.sessions?.length || 0) > 0 || run.agents.length > 0 || attempts.length > 0) {
    throw new Error(`existing run ${run.id} already has launch/replay evidence`);
  }

  const chainPath = join(paths.runDir, "chain.json");
  const validation = validateChainFile(chainPath, true);
  if (validation.errors.length > 0) throw new Error(validation.errors.join("\n"));
  const chain = loadNormalizedChainDefinition(chainPath, config.agentsDir);
  const workspace = (chain.config as Record<string, unknown> | undefined)?.workspace as Record<string, unknown> | undefined;
  if (workspace?.type && workspace.type !== "local") throw new Error(`typed existing-run launch supports local workspaces only, got ${workspace.type}`);
  const env = options.env ?? process.env;
  if (env.WORKSPACE_TYPE && env.WORKSPACE_TYPE !== "local") throw new Error(`typed existing-run launch supports local workspaces only, got ${env.WORKSPACE_TYPE}`);
  const workspacePath = localWorkspace(options.workspacePath);
  const agentId = selectInitialAgent(chain, options.agentId);
  const launch = await startRunnerV2Bootstrap({
    chainPath, runDir: paths.runDir, runId: run.id, agentId,
    chainId: typeof chain.id === "string" ? chain.id : basename(chainPath, ".json"),
    chainName: run.chain || (typeof chain.name === "string" ? chain.name : basename(chainPath, ".json")),
    workspacePath, debug: options.debug === true, logFd: 2, cwd: workspacePath || process.cwd(), env,
  });
  if (launch.support === "unsupported") throw new Error(launch.reason);
  return { runId: run.id, runDir: paths.runDir, chainPath, agentId, launch };
}

export function parseExistingRunLaunchArgs(argv: string[]): Omit<ExistingRunLaunchOptions, "runsDir" | "env"> {
  let runId: string | undefined;
  let workspacePath: string | undefined;
  let agentId: string | undefined;
  let debug = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--debug") { debug = true; continue; }
    if (flag === "--run-id" || flag === "--workspace" || flag === "--start") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
      if (flag === "--run-id") runId = value;
      else if (flag === "--workspace") workspacePath = value;
      else agentId = value;
      index += 1;
      continue;
    }
    throw new Error(`unsupported existing-run launch option: ${flag}`);
  }
  if (!runId) throw new Error("usage: runner-v2-existing-run --run-id <run-id> [--workspace <path>] [--start <agent-id>] [--debug]");
  return { runId, workspacePath, agentId, debug };
}
