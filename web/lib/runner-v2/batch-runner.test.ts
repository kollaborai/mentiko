import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  parseBatchRunRecord,
  readBatchChainResult,
  readBatchRunRecord,
  readBatchRunRecordWithResults,
  resolveBatchPaths,
} from "@/lib/runner-v2/batch-run-record";
import { markBatchWorkerLaunchFailed, prepareBatch, requestBatchCancellation, runBatch } from "@/lib/runner-v2/batch-runner";

function typedLaunch(
  callback?: (input: { chainPath: string; goal: string; runId: string; runsDir: string }) => Promise<void> | void,
) {
  return async (input: { chainPath: string; goal: string; runId: string; runsDir: string }) => {
    await callback?.(input);
    return {
      runId: input.runId,
      runDir: join(input.runsDir, input.runId),
      agentId: "typed-initial-agent",
      launch: { support: "supported" as const, mode: "typed-plan" as const },
    };
  };
}

describe("typed batch run record", () => {
  let root: string;

  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "mentiko-batch-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("rejects malformed records before normalized validation", () => {
    expect(() => parseBatchRunRecord("{")).toThrow("not valid JSON");
    expect(() => parseBatchRunRecord(JSON.stringify({ id: "batch-a", mode: "parallel", status: "running", started: new Date().toISOString(), chains: [] })))
      .toThrow("1-50 chains");
  });

  it("confines batch ids to the configured absolute batches root", () => {
    expect(() => resolveBatchPaths(join(root, "batches"), "../batch-escape")).toThrow("Invalid batch id");
  });

  it("creates snapshots and records successful typed bootstrap acceptance", async () => {
    const batchesDir = join(root, "batches");
    const runsDir = join(root, "runs");
    let launchInput: { chainPath: string; goal: string; runId: string; runsDir: string } | undefined;
    const prepared = await prepareBatch({
      batchesDir,
      mode: "sequential",
      chains: [{ id: "first", goal: "ship it", chain: { name: "first", agents: [{ prompt: "{TASK}" }] } }],
    });
    const completed = await runBatch({
      batchesDir,
      batchId: prepared.id,
      runsDir,
      launchDirectRun: typedLaunch((input) => { launchInput = input; }),
    });
    expect(completed.status).toBe("complete");
    expect(completed.chains[0].run_id).toMatch(/^run-/);
    expect(launchInput).toMatchObject({
      chainPath: realpathSync(join(batchesDir, prepared.id, "first", "chain.json")),
      goal: "ship it",
      runId: completed.chains[0].run_id,
      runsDir,
    });
    expect(existsSync(join(batchesDir, prepared.id, "first", "pid"))).toBe(false);
    expect(JSON.parse(readFileSync(join(batchesDir, prepared.id, "first", "result.json"), "utf8"))).toMatchObject({
      status: "complete",
      output: expect.stringContaining('"status":"launched"'),
    });
  });

  it("records cancellation without letting an API route signal arbitrary PIDs", async () => {
    const prepared = await prepareBatch({ batchesDir: join(root, "batches"), chains: [{ id: "one", chain: { name: "one" } }] });
    const result = await requestBatchCancellation(join(root, "batches"), prepared.id);
    expect(result.cancelled).toBe(1);
    expect(readBatchRunRecord(join(root, "batches"), prepared.id).status).toBe("cancelled");
  });

  it("atomically claims a chain so duplicate detached workers cannot launch it twice", async () => {
    const batchesDir = join(root, "batches");
    const runsDir = join(root, "runs");
    const launches = join(root, "launches.log");
    const prepared = await prepareBatch({ batchesDir, chains: [{ id: "one", chain: { name: "one" } }] });
    const launchDirectRun = typedLaunch(async () => {
      appendFileSync(launches, "launch\n");
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    await Promise.all([
      runBatch({ batchesDir, batchId: prepared.id, runsDir, launchDirectRun }),
      runBatch({ batchesDir, batchId: prepared.id, runsDir, launchDirectRun }),
    ]);

    expect(readFileSync(launches, "utf8").trim().split("\n")).toHaveLength(1);
    expect(readBatchRunRecord(batchesDir, prepared.id)).toMatchObject({
      status: "complete",
      chains: [{ id: "one", status: "complete" }],
    });
  });

  it("preserves sequential ordering when duplicate workers race", async () => {
    const batchesDir = join(root, "batches");
    const runsDir = join(root, "runs");
    const launches = join(root, "sequential.log");
    const prepared = await prepareBatch({
      batchesDir,
      mode: "sequential",
      chains: [
        { id: "first", chain: { name: "first" } },
        { id: "second", chain: { name: "second" } },
      ],
    });
    const launchDirectRun = typedLaunch(async ({ chainPath }) => {
      const id = basename(dirname(chainPath));
      appendFileSync(launches, `start:${id}\n`);
      await new Promise((resolve) => setTimeout(resolve, 150));
      appendFileSync(launches, `end:${id}\n`);
    });

    await Promise.all([
      runBatch({ batchesDir, batchId: prepared.id, runsDir, launchDirectRun }),
      runBatch({ batchesDir, batchId: prepared.id, runsDir, launchDirectRun }),
    ]);

    expect(readFileSync(launches, "utf8").trim().split("\n")).toEqual([
      "start:first",
      "end:first",
      "start:second",
      "end:second",
    ]);
  });

  it("does not resurrect a cancelled chain when cancellation races the worker claim", async () => {
    const batchesDir = join(root, "batches");
    const runsDir = join(root, "runs");
    const prepared = await prepareBatch({ batchesDir, chains: [{ id: "one", chain: { name: "one" } }] });
    const launchDirectRun = typedLaunch(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });

    await Promise.all([
      runBatch({ batchesDir, batchId: prepared.id, runsDir, launchDirectRun }),
      requestBatchCancellation(batchesDir, prepared.id),
    ]);

    expect(readBatchRunRecord(batchesDir, prepared.id)).toMatchObject({
      status: "cancelled",
      chains: [{ id: "one", status: "cancelled" }],
    });
  });

  it("does not publish a running batch when immutable snapshot preparation fails", async () => {
    const batchesDir = join(root, "batches");
    await expect(prepareBatch({
      batchesDir,
      chainSourceRoot: root,
      chains: [{ id: "missing", file: join(root, "missing-chain.json") }],
    })).rejects.toThrow("ENOENT");
    expect(existsSync(batchesDir) ? readdirSync(batchesDir) : []).toEqual([]);
  });

  it("reads file-form chains only from the configured namespace chain root", async () => {
    const batchesDir = join(root, "batches");
    const chainsDir = join(root, "chains");
    const allowed = join(chainsDir, "allowed.json");
    const outside = join(root, "outside.json");
    mkdirSync(chainsDir);
    writeFileSync(allowed, JSON.stringify({ name: "allowed" }));
    writeFileSync(outside, JSON.stringify({ name: "outside" }));

    await expect(prepareBatch({
      batchesDir,
      chainSourceRoot: chainsDir,
      chains: [{ id: "allowed", file: allowed }],
    })).resolves.toMatchObject({ chains: [{ id: "allowed", status: "pending" }] });
    await expect(prepareBatch({
      batchesDir,
      chainSourceRoot: chainsDir,
      chains: [{ id: "outside", file: outside }],
    })).rejects.toThrow("must resolve beneath the configured chain source root");
  });

  it("durably fails a chain when its run record cannot be created", async () => {
    const batchesDir = join(root, "batches");
    const runsDir = join(root, "runs-file");
    writeFileSync(runsDir, "not a directory");
    const prepared = await prepareBatch({ batchesDir, chains: [{ id: "one", chain: { name: "one" } }] });

    const result = await runBatch({
      batchesDir,
      batchId: prepared.id,
      runsDir,
      launchDirectRun: typedLaunch(({ runsDir: requestedRunsDir }) => {
        if (!statSync(requestedRunsDir).isDirectory()) throw new Error("runs directory must be a directory");
      }),
    });

    expect(result).toMatchObject({
      status: "failed",
      status_message: expect.stringContaining("Chain one launch failed"),
      chains: [{ id: "one", status: "failed" }],
    });
    expect(result.chains[0].status).not.toBe("running");
  });

  it("marks every pending chain failed if the detached worker cannot start", async () => {
    const batchesDir = join(root, "batches");
    const prepared = await prepareBatch({ batchesDir, chains: [{ id: "one", chain: { name: "one" } }] });

    const failed = await markBatchWorkerLaunchFailed(batchesDir, prepared.id, "spawn failed");

    expect(failed).toMatchObject({ status: "failed", status_message: "spawn failed", chains: [{ id: "one", status: "failed" }] });
    await expect(requestBatchCancellation(batchesDir, prepared.id)).resolves.toMatchObject({ cancelled: 0, record: { status: "failed" } });
  });

  it("strictly reads persisted results for the API projection and rejects corrupted results", async () => {
    const batchesDir = join(root, "batches");
    const runsDir = join(root, "runs");
    const prepared = await prepareBatch({ batchesDir, chains: [{ id: "one", chain: { name: "one" } }] });
    await runBatch({ batchesDir, batchId: prepared.id, runsDir, launchDirectRun: typedLaunch() });

    expect(readBatchChainResult(batchesDir, prepared.id, "one")).toMatchObject({ status: "complete", output: expect.stringContaining('"status":"launched"') });
    expect(readBatchRunRecordWithResults(batchesDir, prepared.id).chains).toMatchObject([
      { id: "one", status: "complete", output: expect.stringContaining('"status":"launched"'), exit_code: 0 },
    ]);

    writeFileSync(join(batchesDir, prepared.id, "one", "result.json"), "{");
    expect(() => readBatchRunRecordWithResults(batchesDir, prepared.id)).toThrow("Batch result is not valid JSON");
  });
});
