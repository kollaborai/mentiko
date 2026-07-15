import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { createRunRecordFile } from "@/lib/runs/run-record";
import { createRunRecord, updateRunStatus } from "@/lib/runner-v2/run-state";
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
  chainRunnerPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
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
  if (!isAbsolute(input.runsDir) || !isAbsolute(input.chainRunnerPath) || !isAbsolute(input.cwd)) {
    throw new Error("Batch runner requires absolute configured paths.");
  }
  if (!existsSync(input.chainRunnerPath)) throw new Error("Configured chain runner is missing.");

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
 * A per-chain startup failure occurs while the batch record lock is held, so
 * the throwing mutation never publishes its claim. Persist a terminal state
 * afterward, unless cancellation won the race.
 */
async function markBatchChainLaunchFailed(
  batchesDir: string,
  batchId: string,
  chainId: string,
  reason: string,
): Promise<BatchRunRecord> {
  return mutateBatchRunRecord(batchesDir, batchId, (current) => {
    if (current.status !== "running") return current;
    const completed = new Date().toISOString();
    let changed = false;
    const chains = current.chains.map((chain) => {
      if (chain.id !== chainId || chain.status !== "pending") return chain;
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
  let claimed: { chain: BatchRunRecord["chains"][number]; runId: string; started: string; child: ReturnType<typeof spawn> } | undefined;
  try {
    await mutateBatchRunRecord(input.batchesDir, input.batchId, (record) => {
      if (record.status !== "running") return record;
      const chain = record.chains.find((candidate) => candidate.id === chainId);
      if (!chain || chain.status !== "pending") return record;
      if (record.mode === "sequential" && record.chains.some((candidate) => candidate.status === "running")) {
        return record;
      }

      const run = createRunRecord({
        runId: `run-${Date.now()}-${randomBytes(4).toString("hex")}`,
        chainName: chainId,
        goal: chain.goal,
      });
      createRunRecordFile(input.runsDir, run);
      const started = new Date().toISOString();
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(input.chainRunnerPath, [chain.file], {
          cwd: input.cwd,
          env: { ...input.env, MENTIKO_RUN_ID: run.id },
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        updateRunStatus(joinRunJsonPath(input.runsDir, run.id), "failed", error instanceof Error ? error.message : String(error));
        throw error;
      }
      claimed = { chain, runId: run.id, started, child };
      return {
        ...record,
        chains: record.chains.map((candidate) => candidate.id === chainId
          ? { ...candidate, run_id: run.id, started, status: "running", ...(child.pid ? { pid: child.pid } : {}) }
          : candidate),
      };
    });
  } catch (error) {
    // If persistence failed after a synchronous spawn, do not leave its child
    // running under a record that was never claimed.
    claimed?.child.kill("SIGTERM");
    const reason = error instanceof Error ? error.message : String(error);
    await markBatchChainLaunchFailed(input.batchesDir, input.batchId, chainId, reason);
    return;
  }
  if (!claimed) return;
  const { runId, started, child } = claimed;
  const outcome = await waitForChild(child, () => readBatchRunRecord(input.batchesDir, input.batchId).status === "cancelled");
  const completed = new Date().toISOString();
  const duration = Math.max(0, Math.round((Date.parse(completed) - Date.parse(started)) / 1000));
  const status: BatchChainResult["status"] = outcome.cancelled ? "cancelled" : outcome.code === 0 ? "complete" : "failed";
  writeBatchChainResult(input.batchesDir, input.batchId, {
    chain_id: chainId,
    run_id: runId,
    status,
    exit_code: outcome.code,
    started,
    completed,
    duration,
    output: outcome.stdout,
    error: outcome.error ? `${outcome.stderr}${outcome.stderr ? "\n" : ""}${outcome.error}` : outcome.stderr,
  });
  await mutateBatchRunRecord(input.batchesDir, input.batchId, (record) => ({
    ...record,
    chains: record.chains.map((candidate) => candidate.id === chainId && record.status === "running" && candidate.status === "running" && candidate.run_id === runId
      ? { ...candidate, status, completed, duration, pid: undefined }
      : candidate),
  }));
  if (outcome.error) updateRunStatus(joinRunJsonPath(input.runsDir, runId), "failed", outcome.error);
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

function waitForChild(child: ReturnType<typeof spawn>, isCancelled: () => boolean): Promise<{ code: number | null; stdout: string; stderr: string; cancelled: boolean; error?: string }> {
  return new Promise((resolveWait) => {
    let stdout = "";
    let stderr = "";
    let cancellationSent = false;
    const timer = setInterval(() => {
      if (!cancellationSent && isCancelled()) {
        cancellationSent = true;
        child.kill("SIGTERM");
      }
    }, 100);
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", (error) => {
      clearInterval(timer);
      resolveWait({ code: null, stdout, stderr, cancelled: cancellationSent, error: error.message });
    });
    child.once("close", (code) => { clearInterval(timer); resolveWait({ code, stdout, stderr, cancelled: cancellationSent }); });
  });
}

function joinRunJsonPath(runsDir: string, runId: string): string {
  return join(runsDir, runId, "run.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
