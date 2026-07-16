import { realpathSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import config from "@/lib/config";
import { startRunnerV2Bootstrap } from "@/lib/runner-v2/bootstrap-executor";
import { loadNormalizedChainDefinition, type ChainRecord } from "@/lib/runner-v2/chain-contract";
import { validateChainFile } from "@/lib/runner-v2/chain-validation-cli";
import { readRunnerV2AttemptState } from "@/lib/runner-v2/agent-attempt";
import { acquireExclusiveFileClaim, ExclusiveFileClaimBusyError } from "@/lib/runner-v2/file-claim";
import { readRunRecordAt, resolveExistingRunRecordPaths, type RunRecord } from "@/lib/runs/run-record";
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

const LAUNCH_CLAIM_DIR_NAME = ".launch-claim";

/** Per-call claim-acquisition budget; tunable so tests can shrink the busy-wait. */
function claimWaitTimeoutMs(): number {
  const parsed = Number(process.env.MENTIKO_EXISTING_RUN_CLAIM_WAIT_MS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 500;
}

/** A pristine run has no durable evidence that a prior launch or replay already started it. */
function runHasLaunchEvidence(run: RunRecord, attemptsLength: number): boolean {
  return (run.sessions?.length || 0) > 0 || run.agents.length > 0 || attemptsLength > 0;
}

/**
 * Bind the immutable run-local chain snapshot's identity to the run record's
 * provenance and fail closed on mismatch. The snapshot is published exactly once
 * (exclusive create) by the preallocated-run creator, so a launch must never
 * boot a snapshot whose declared chain name/id disagrees with the run that
 * claims it. Absence on one side is not a mismatch; only a disagreement fails.
 */
function assertChainSnapshotIdentityBound(run: RunRecord, chain: ChainRecord, chainPath: string): void {
  const runChain = typeof run.chain === "string" ? run.chain : "";
  const snapshotName = typeof chain.name === "string" ? chain.name : "";
  if (runChain && snapshotName && runChain !== snapshotName) {
    throw new Error(
      `chain snapshot identity mismatch in ${chainPath}: run provenance chain "${runChain}" does not match snapshot name "${snapshotName}"`,
    );
  }
  const runChainId = typeof run.chainId === "string" ? run.chainId : "";
  const snapshotId = typeof chain.id === "string" ? chain.id : "";
  if (runChainId && snapshotId && runChainId !== snapshotId) {
    throw new Error(
      `chain snapshot identity mismatch in ${chainPath}: run provenance chainId "${runChainId}" does not match snapshot id "${snapshotId}"`,
    );
  }
}

/**
 * Bootstrap exactly one pristine preallocated run; it never creates or replaces a
 * record. The run is claimed for single-flight bootstrap before any launch side
 * effect: an owner-bearing file claim (the same reviewed primitive concurrency
 * admission uses) serializes concurrent launchers across processes, so two calls
 * for one pristine run can never create or hijack a second PTY or attempt. The
 * claim is released only on a pre-launch failure (the run is still pristine); a
 * launch that durably wrote attempt/session evidence keeps the claim so the run
 * can never be re-launched.
 */
export async function launchExistingTypedRun(options: ExistingRunLaunchOptions): Promise<ExistingRunLaunchResult> {
  const paths = resolveExistingRunRecordPaths(options.runsDir, options.runId);

  // Reject terminal runs before contending for the claim; a terminal run is never launched.
  const initialRun = readRunRecordAt(paths.runsDir, options.runId);
  if (TERMINAL.has(initialRun.status)) {
    throw new Error(`existing run ${initialRun.id} is terminal (${initialRun.status})`);
  }

  // Claim the run for single-flight bootstrap. acquireExclusiveFileClaim is
  // mkdir-atomic across processes, owner-token fenced on release, and reaps a
  // stale holder whose PID is provably dead, so a crashed launcher cannot wedge
  // the run. A held LIVE claim means another launch is in progress -> fail fast.
  const claimDir = join(paths.runDir, LAUNCH_CLAIM_DIR_NAME);
  let releaseClaim: () => void;
  try {
    releaseClaim = acquireExclusiveFileClaim(claimDir, {
      waitTimeoutMs: claimWaitTimeoutMs(),
      retryDelayMs: 20,
      freshMs: 30_000,
    });
  } catch (error) {
    if (error instanceof ExclusiveFileClaimBusyError) {
      throw new Error(`existing run ${options.runId} already has an in-progress launch`);
    }
    throw error;
  }

  // Re-read under the claim: a concurrent launcher that won the claim first has
  // by now written durable attempt/session evidence, so this is the authoritative
  // pristine verdict that closes the read-then-bootstrap race.
  const claimed = readRunRecordAt(paths.runsDir, options.runId);
  if (TERMINAL.has(claimed.status)) {
    releaseClaim();
    throw new Error(`existing run ${claimed.id} is terminal (${claimed.status})`);
  }
  const claimedAttempts = readRunnerV2AttemptState(paths.runJsonPath).attempts;
  if (runHasLaunchEvidence(claimed, claimedAttempts.length)) {
    releaseClaim();
    throw new Error(`existing run ${claimed.id} already has launch/replay evidence`);
  }

  try {
    const chainPath = join(paths.runDir, "chain.json");
    const validation = validateChainFile(chainPath, true);
    if (validation.errors.length > 0) throw new Error(validation.errors.join("\n"));
    const chain = loadNormalizedChainDefinition(chainPath, config.agentsDir);
    assertChainSnapshotIdentityBound(claimed, chain, chainPath);
    const workspace = (chain.config as Record<string, unknown> | undefined)?.workspace as Record<string, unknown> | undefined;
    if (workspace?.type && workspace.type !== "local") throw new Error(`typed existing-run launch supports local workspaces only, got ${workspace.type}`);
    const env = options.env ?? process.env;
    if (env.WORKSPACE_TYPE && env.WORKSPACE_TYPE !== "local") throw new Error(`typed existing-run launch supports local workspaces only, got ${env.WORKSPACE_TYPE}`);
    const workspacePath = localWorkspace(options.workspacePath);
    const agentId = selectInitialAgent(chain, options.agentId);
    const launch = await startRunnerV2Bootstrap({
      chainPath, runDir: paths.runDir, runId: claimed.id, agentId,
      chainId: typeof chain.id === "string" ? chain.id : basename(chainPath, ".json"),
      chainName: claimed.chain || (typeof chain.name === "string" ? chain.name : basename(chainPath, ".json")),
      workspacePath, debug: options.debug === true, logFd: 2, cwd: workspacePath || process.cwd(), env,
    });
    if (launch.support === "unsupported") throw new Error(launch.reason);
    // Success: retain the claim. Bootstrap wrote durable attempt/session evidence,
    // so the run is no longer pristine and must not be re-launchable. The claim
    // stays as the durable launch marker and is reaped as stale only after this
    // process exits; a later caller then retires it and rejects on the evidence.
    return { runId: claimed.id, runDir: paths.runDir, chainPath, agentId, launch };
  } catch (error) {
    // Release ONLY on a pre-launch failure: re-read and, if the run is still
    // pristine (no durable attempt/session was written), vacate the claim so a
    // retry can proceed. If bootstrap wrote any launch evidence before failing,
    // the run is no longer pristine and the claim is intentionally retained.
    let stillPristine = true;
    try {
      const afterRun = readRunRecordAt(paths.runsDir, options.runId);
      const afterAttempts = readRunnerV2AttemptState(paths.runJsonPath).attempts;
      stillPristine = !TERMINAL.has(afterRun.status) && !runHasLaunchEvidence(afterRun, afterAttempts.length);
    } catch {
      stillPristine = true;
    }
    if (stillPristine) releaseClaim();
    throw error;
  }
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
