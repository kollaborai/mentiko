import { randomBytes } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { runTypedDirect, type DirectRunResult } from "@/lib/runner-v2/direct-run";
import {
  type BatchChainResult,
  type BatchMode,
  type BatchRunRecord,
  mintBatchId,
  mutateBatchRunRecord,
  publishPreparedBatchRunRecord,
  readBatchRunRecord,
  requireBatchChainId,
  requireBatchMode,
  resolveBatchPaths,
  writeBatchChainResult,
} from "@/lib/runner-v2/batch-run-record";

export interface BatchChainInput {
  id: string;
  file?: string;
  goal?: string;
  chain?: unknown;
}

export interface PrepareBatchInput {
  batchesDir: string;
  /** Canonical product-owned root from which saved chain JSON may be read. */
  chainSourceRoot?: string;
  chains: BatchChainInput[];
  mode?: BatchMode;
}

export interface RunBatchInput {
  batchesDir: string;
  batchId: string;
  runsDir: string;
  /** Test seam for the same typed initial-bootstrap contract used in production. */
  launchDirectRun?: (input: {
    chainPath: string;
    goal: string;
    runId: string;
    runsDir: string;
  }) => Promise<DirectRunResult>;
}

export async function prepareBatch(input: PrepareBatchInput): Promise<BatchRunRecord> {
  if (!Array.isArray(input.chains) || input.chains.length === 0 || input.chains.length > 50) {
    throw new Error("A batch must contain between 1 and 50 chains.");
  }
  const mode = requireBatchMode(input.mode ?? "parallel");
  const id = mintBatchId();
  const now = new Date().toISOString();
  const chains = input.chains.map((chain) => ({
    id: requireBatchChainId(chain.id),
    file: "",
    goal: typeof chain.goal === "string" ? chain.goal.slice(0, 50_000) : "",
    status: "pending" as const,
  }));
  if (new Set(chains.map((chain) => chain.id)).size !== chains.length) throw new Error("Batch chain ids must be unique.");

  // Build every immutable snapshot before publishing anything visible to the
  // worker or API. A malformed source must not leave a running batch behind.
  const snapshots = input.chains.map((chain, index) => ({
    chainId: chains[index].id,
    content: prepareChainSnapshot(chain, chains[index].goal, input.chainSourceRoot),
  }));
  const baseDir = resolveBatchPaths(input.batchesDir, id).batchDir;
  const publishedChains = chains.map((chain) => ({
    ...chain,
    file: `${baseDir}/${chain.id}/chain.json`,
  }));
  publishPreparedBatchRunRecord(input.batchesDir, {
    id,
    mode,
    status: "running",
    started: now,
    chains: publishedChains,
  }, snapshots);
  return readBatchRunRecord(input.batchesDir, id);
}

export async function runBatch(input: RunBatchInput): Promise<BatchRunRecord> {
  const initial = readBatchRunRecord(input.batchesDir, input.batchId);
  if (initial.status !== "running") return initial;
  if (!isAbsolute(input.runsDir)) {
    throw new Error("Batch runner requires absolute configured paths.");
  }

  const runOne = async (chainId: string) => runBatchChain(input, chainId);
  if (initial.mode === "parallel") {
    await Promise.all(initial.chains.map((chain) => runOne(chain.id)));
  } else {
    for (const chain of initial.chains) {
      if (readBatchRunRecord(input.batchesDir, input.batchId).status === "cancelled") break;
      await runOne(chain.id);
    }
  }

  return await mutateBatchRunRecord(input.batchesDir, input.batchId, (record) => {
    if (record.status === "cancelled") return record;
    const statuses = record.chains.map((chain) => chain.status);
    if (statuses.some((status) => status === "pending" || status === "running")) return record;
    const complete = statuses.every((status) => status === "complete");
    const failed = statuses.every((status) => status === "failed");
    return { ...record, status: complete ? "complete" : failed ? "failed" : "partial", completed: new Date().toISOString() };
  });
}

export async function requestBatchCancellation(batchesDir: string, batchId: string): Promise<{ record: BatchRunRecord; cancelled: number }> {
  let cancelled = 0;
  const record = await mutateBatchRunRecord(batchesDir, batchId, (current) => {
    if (current.status !== "running") return current;
    const completed = new Date().toISOString();
    const chains = current.chains.map((chain) => {
      if (chain.status !== "pending" && chain.status !== "running") return chain;
      cancelled += 1;
      return { ...chain, status: "cancelled" as const, completed };
    });
    return {
      ...current,
      status: "cancelled" as const,
      cancel_requested_at: completed,
      completed,
      chains,
    };
  });
  return { record, cancelled };
}

/** Mark a batch failed only when the detached worker itself never started. */
export async function markBatchWorkerLaunchFailed(
  batchesDir: string,
  batchId: string,
  reason: string,
): Promise<BatchRunRecord> {
  return mutateBatchRunRecord(batchesDir, batchId, (current) => {
    if (current.status !== "running") return current;
    const completed = new Date().toISOString();
    return {
      ...current,
      status: "failed",
      completed,
      status_message: reason.slice(0, 2_000),
      chains: current.chains.map((chain) => chain.status === "pending"
        ? { ...chain, status: "failed", completed }
        : chain),
    };
  });
}

/**
 * A typed bootstrap failure follows a durable batch claim. Only that exact
 * claim may become failed; cancellation and a newer claim win the race.
 */
async function markBatchChainLaunchFailed(
  batchesDir: string,
  batchId: string,
  chainId: string,
  reason: string,
  runId?: string,
): Promise<BatchRunRecord> {
  return mutateBatchRunRecord(batchesDir, batchId, (current) => {
    if (current.status !== "running") return current;
    const completed = new Date().toISOString();
    let changed = false;
    const chains = current.chains.map((chain) => {
      if (chain.id !== chainId || (chain.status !== "pending" && !(chain.status === "running" && chain.run_id === runId))) return chain;
      changed = true;
      return { ...chain, status: "failed" as const, completed };
    });
    if (!changed) return current;
    return {
      ...current,
      status_message: `Chain ${chainId} launch failed: ${reason}`.slice(0, 2_000),
      chains,
    };
  });
}

async function runBatchChain(input: RunBatchInput, chainId: string): Promise<void> {
  let claimed: { chain: BatchRunRecord["chains"][number]; runId: string; started: string } | undefined;
  try {
    await mutateBatchRunRecord(input.batchesDir, input.batchId, (record) => {
      if (record.status !== "running") return record;
      const chain = record.chains.find((candidate) => candidate.id === chainId);
      if (!chain || chain.status !== "pending") return record;
      if (record.mode === "sequential" && record.chains.some((candidate) => candidate.status === "running")) {
        return record;
      }

      const started = new Date().toISOString();
      const runId = `run-${Date.now()}-${randomBytes(4).toString("hex")}`;
      // Claim first. The asynchronous typed bootstrap happens after the
      // record lock is released, so a duplicate detached worker cannot launch
      // the same snapshot and a cancellation can win before PTY allocation.
      claimed = { chain, runId, started };
      return {
        ...record,
        chains: record.chains.map((candidate) => candidate.id === chainId
          ? { ...candidate, run_id: runId, started, status: "running" }
          : candidate),
      };
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await markBatchChainLaunchFailed(input.batchesDir, input.batchId, chainId, reason, claimed?.runId);
    return;
  }
  if (!claimed) return;
  const { runId, started, chain } = claimed;
  const active = readBatchRunRecord(input.batchesDir, input.batchId);
  const stillClaimed = active.status === "running"
    && active.chains.some((candidate) => candidate.id === chainId && candidate.status === "running" && candidate.run_id === runId);
  if (!stillClaimed) return;

  let launch: DirectRunResult;
  try {
    const launchDirectRun = input.launchDirectRun ?? ((options) => runTypedDirect({
      chainPath: options.chainPath,
      goal: options.goal,
      runId: options.runId,
      runsDir: options.runsDir,
      debug: false,
    }));
    launch = await launchDirectRun({ chainPath: chain.file, goal: chain.goal, runId, runsDir: input.runsDir });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await markBatchChainLaunchFailed(input.batchesDir, input.batchId, chainId, reason, runId);
    return;
  }

  if (launch.dryRun) {
    await markBatchChainLaunchFailed(input.batchesDir, input.batchId, chainId, "Typed batch launch returned a dry-run result.", runId);
    return;
  }

  if (launch.runId !== runId) {
    await markBatchChainLaunchFailed(input.batchesDir, input.batchId, chainId, "Typed batch launch returned a mismatched run identity.", runId);
    return;
  }

  const completed = new Date().toISOString();
  const duration = Math.max(0, Math.round((Date.parse(completed) - Date.parse(started)) / 1000));
  const cancelled = readBatchRunRecord(input.batchesDir, input.batchId).status === "cancelled";
  const status: BatchChainResult["status"] = cancelled ? "cancelled" : "complete";
  writeBatchChainResult(input.batchesDir, input.batchId, {
    chain_id: chainId,
    run_id: runId,
    status,
    exit_code: 0,
    started,
    completed,
    duration,
    output: JSON.stringify({
      status: "launched",
      runId: launch.runId,
      runDir: launch.runDir,
      agentId: launch.agentId,
      mode: launch.launch.mode,
    }),
    error: "",
  });
  await mutateBatchRunRecord(input.batchesDir, input.batchId, (record) => ({
    ...record,
    chains: record.chains.map((candidate) => candidate.id === chainId && record.status === "running" && candidate.status === "running" && candidate.run_id === runId
      ? { ...candidate, status, completed, duration, pid: undefined }
      : candidate),
  }));
}

function prepareChainSnapshot(chain: BatchChainInput, goal: string, chainSourceRoot?: string): string {
  let value: unknown;
  if (chain.chain !== undefined) value = JSON.parse(JSON.stringify(chain.chain)) as unknown;
  else if (typeof chain.file === "string") {
    if (!isAbsolute(chain.file)) throw new Error("Chain file path must be absolute.");
    const source = resolveContainedChainSource(chain.file, chainSourceRoot);
    value = parseChainJson(readFileSync(source, "utf8"));
  } else throw new Error(`Batch chain ${chain.id} must include chain data or a file.`);
  if (!isRecord(value)) throw new Error("Batch chain must be a JSON object.");
  if (goal && Array.isArray(value.agents)) {
    value.agents = value.agents.map((agent, index) => {
      if (!isRecord(agent)) return agent;
      const prompt = String(agent.prompt ?? agent.role ?? "");
      return {
        ...agent,
        prompt: prompt.includes("{TASK}") ? prompt.replace(/\{TASK\}/g, goal) : index === 0 ? `USER REQUEST:\n${goal}\n\nAGENT INSTRUCTIONS:\n${prompt}` : prompt,
      };
    });
  }
  return `${JSON.stringify(value, null, 2)}\n`;
}

function resolveContainedChainSource(file: string, chainSourceRoot: string | undefined): string {
  if (!chainSourceRoot || !isAbsolute(chainSourceRoot)) {
    throw new Error("Chain file input requires an absolute configured chain source root.");
  }
  const root = realpathSync(chainSourceRoot);
  if (!lstatSync(root).isDirectory()) throw new Error("Configured chain source root must be a directory.");
  const source = realpathSync(file);
  if (!lstatSync(source).isFile()) throw new Error("Chain file source must be a regular file.");
  const relation = relative(root, source);
  if (relation === "" || relation.startsWith("..") || isAbsolute(relation)) {
    throw new Error("Chain file must resolve beneath the configured chain source root.");
  }
  return source;
}

function parseChainJson(content: string): unknown {
  try { return JSON.parse(content); } catch { throw new Error("Chain file is not valid JSON."); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
