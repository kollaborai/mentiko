import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { NextRequest } from "next/server";
import config, { nsPath, orgPath } from "@/lib/config";
import { getNamespaceConfig, getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { checkAuth } from "@/lib/auth/api-auth";
import { BadRequest, NotFound, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { buildChildEnv } from "@/lib/runs/child-env";
import { buildLocalAiGatewayProxyEnv } from "@/lib/ai-gateway/local-proxy-env";
import { resolveLinkRunsDir } from "@/lib/links/link-run-runtime";
import {
  type BatchChainInput,
  markBatchWorkerLaunchFailed,
  prepareBatch,
  requestBatchCancellation,
} from "@/lib/runner-v2/batch-runner";
import {
  BATCH_ID_PATTERN,
  type BatchMode,
  BatchRunRecordValidationError,
  readBatchRunRecord,
  readBatchRunRecordWithResults,
} from "@/lib/runner-v2/batch-run-record";

export const dynamic = "force-dynamic";

const BATCH_RUNNER = join(config.libDir, "runner-batch-runner.js");
const CHAIN_RUNNER = join(config.libDir, "chain-runner.sh");

interface BatchRequest {
  chains: BatchChainInput[];
  mode?: BatchMode;
}

function requireBatchId(value: string): string {
  if (!BATCH_ID_PATTERN.test(value)) throw new BadRequest("Invalid batch ID", { field: "id" });
  return value;
}

function batchesDir(namespaceId: string): string {
  return nsPath(namespaceId, "batches");
}

// GET /api/chains/run-batch - list batches or read one strict persisted record.
export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) throw new Unauthorized();
  const namespaceId = await getNamespaceIdFromRequest(request);
  const root = batchesDir(namespaceId);
  const requested = new URL(request.url).searchParams.get("id");
  if (requested) {
    const batchId = requireBatchId(requested);
    try {
      return apiSuccess(readBatchRunRecordWithResults(root, batchId));
    } catch (error) {
      if (error instanceof BatchRunRecordValidationError && /missing/.test(error.message)) throw new NotFound("Batch", batchId);
      throw error;
    }
  }
  if (!existsSync(root)) return apiSuccess({ batches: [] });
  const batches = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && BATCH_ID_PATTERN.test(entry.name))
    .sort((left, right) => right.name.localeCompare(left.name))
    .slice(0, 50)
    .map((entry) => readBatchRunRecord(root, entry.name));
  return apiSuccess({ batches });
});

// POST /api/chains/run-batch - persist a typed batch then launch its typed worker.
export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) throw new Unauthorized();
  const namespaceConfig = await getNamespaceConfig(request);
  const { namespaceId, orgId } = namespaceConfig;
  const body = await request.json() as BatchRequest;

  const workerPath = resolve(BATCH_RUNNER);
  const chainRunnerPath = resolve(CHAIN_RUNNER);
  if (!existsSync(workerPath) || !existsSync(chainRunnerPath)) {
    throw new BadRequest("Typed batch runner is unavailable", { field: "runner" });
  }
  const root = batchesDir(namespaceId);
  const record = await prepareBatch({
    batchesDir: root,
    chainSourceRoot: namespaceConfig.chainsDir,
    chains: body.chains,
    mode: body.mode,
  });
  const runsDir = resolveLinkRunsDir(namespaceId, orgId);
  const namespaceRoot = nsPath(namespaceId);
  const orgRoot = orgPath(namespaceId, orgId);
  const env = buildChildEnv({
    MENTIKO_GLOBAL_ROOT: config.globalRoot,
    MENTIKO_CODE_ROOT: config.codeRoot,
    MENTIKO_PROJECT_ROOT: orgRoot,
    MENTIKO_ORG_ROOT: orgRoot,
    MENTIKO_NAMESPACE_ROOT: namespaceRoot,
    NAMESPACE_ID: namespaceId,
    ORG_ID: orgId,
    RUNS_DIR: runsDir,
    ...buildLocalAiGatewayProxyEnv(new URL(request.url).origin),
  });
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(process.execPath, [
      workerPath,
      "run",
      "--batches-dir", root,
      "--batch-id", record.id,
      "--runs-dir", runsDir,
      "--chain-runner", chainRunnerPath,
      "--cwd", config.codeRoot,
    ], {
      cwd: config.codeRoot,
      env,
      detached: true,
      stdio: "ignore",
      shell: false,
    });
  } catch (error) {
    await markBatchWorkerLaunchFailed(root, record.id, error instanceof Error ? error.message : String(error));
    throw error;
  }
  child.once("error", (error) => {
    void markBatchWorkerLaunchFailed(root, record.id, error.message).catch(() => undefined);
  });
  child.unref();
  return apiSuccess({ success: true, batchId: record.id, mode: record.mode, chains: record.chains.length, status: record.status });
});

// DELETE /api/chains/run-batch - request cancellation; only the typed worker kills its owned child.
export const DELETE = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) throw new Unauthorized();
  const batchId = new URL(request.url).searchParams.get("id");
  if (!batchId) throw new BadRequest("Batch ID is required", { field: "id" });
  const namespaceId = await getNamespaceIdFromRequest(request);
  const safeBatchId = requireBatchId(batchId);
  const { cancelled } = await requestBatchCancellation(batchesDir(namespaceId), safeBatchId);
  return apiSuccess({ success: true, cancelled });
});
