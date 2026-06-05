import { NextRequest } from "next/server";
import { execSync, spawn } from "child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import config, { nsPath } from "@/lib/config";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { checkAuth } from "@/lib/auth/api-auth";
import { BadRequest, NotFound, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { buildChildEnv } from "@/lib/runs/child-env";
import { buildLocalAiGatewayProxyEnv } from "@/lib/ai-gateway/local-proxy-env";

export const dynamic = "force-dynamic";

const MULTI_CHAIN_RUNNER = join(config.libDir, "multi-chain-runner.sh");

// validate batch ID - prevent path traversal
function validateBatchId(id: string): string {
  const sanitized = String(id).replace(/[^a-zA-Z0-9\-_]/g, "");
  if (sanitized.length === 0 || sanitized.length > 100) {
    throw new BadRequest("Invalid batch ID", { field: "id" });
  }
  return sanitized;
}

// validate chain ID
function validateChainId(id: string): string {
  const sanitized = String(id).replace(/[^a-zA-Z0-9\-_]/g, "");
  if (sanitized.length === 0 || sanitized.length > 100) {
    throw new BadRequest("Invalid chain ID", { field: "id" });
  }
  return sanitized;
}

// batch state storage (in-memory for now, could move to redis)
const batchState = new Map<string, BatchStatus>();

interface ChainRequest {
  id: string;
  file?: string;
  goal?: string;
  chain?: unknown;
}

interface BatchRequest {
  chains: ChainRequest[];
  mode?: "parallel" | "sequential";
}

interface BatchStatus {
  id: string;
  mode: string;
  status: "running" | "complete" | "partial" | "failed" | "cancelled";
  started: string;
  completed?: string;
  chains: Array<{
    id: string;
    run_id?: string;
    status: "pending" | "running" | "complete" | "failed";
    started?: string;
    completed?: string;
    duration?: number;
    output?: string;
    error?: string;
  }>;
}

// GET /api/chains/run-batch - list all batches
export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { searchParams } = new URL(request.url);
  const batchId = searchParams.get("id");

  if (batchId) {
    const safeBatchId = validateBatchId(batchId);
    // Get specific batch status
    const namespaceId = await getNamespaceIdFromRequest(request);
    const batchDir = nsPath(namespaceId, "batches", safeBatchId);
    const batchFile = join(batchDir, "batch.json");

    if (!existsSync(batchFile)) {
      throw new NotFound("Batch", safeBatchId);
    }

    const batchData = JSON.parse(readFileSync(batchFile, "utf-8"));

    // Add details for each chain
    const chains = [];
    for (const chain of batchData.chains || []) {
      const chainDir = join(batchDir, chain.id);
      const resultFile = join(chainDir, "result.json");

      if (existsSync(resultFile)) {
        const result = JSON.parse(readFileSync(resultFile, "utf-8"));
        chains.push({ ...chain, ...result });
      } else {
        // Check if still running
        const pidFile = join(chainDir, "pid");
        if (existsSync(pidFile)) {
          const pid = readFileSync(pidFile, "utf-8").trim();
          try {
            process.kill(parseInt(pid, 10), 0); // Check if process exists
            chains.push({ ...chain, status: "running" });
          } catch {
            chains.push({ ...chain, status: "failed" });
          }
        } else {
          chains.push(chain);
        }
      }
    }

    return apiSuccess({
      ...batchData,
      chains,
    });
  }

  // List all batches - use readdir instead of shell command
  const namespaceId = await getNamespaceIdFromRequest(request);
  const batchesDir = nsPath(namespaceId, "batches");
  if (!existsSync(batchesDir)) {
    return apiSuccess({ batches: [] });
  }

  // safe approach: use readdirSync instead of execSync
  const batchDirs = readdirSync(batchesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)
    .sort((a, b) => b.localeCompare(a)) // descending by name (timestamp-based)
    .slice(0, 50);

  const batches = batchDirs
    .map((dir: string) => {
      const batchFile = join(batchesDir, dir, "batch.json");
      if (existsSync(batchFile)) {
        return JSON.parse(readFileSync(batchFile, "utf-8"));
      }
      return null;
    })
    .filter(Boolean);

  return apiSuccess({ batches });
});

// POST /api/chains/run-batch - start a batch of chains
export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { chains, mode = "parallel" }: BatchRequest = await request.json();

  if (!chains || chains.length === 0) {
    throw new BadRequest("At least one chain is required", { field: "chains" });
  }

  if (chains.length > 50) {
    throw new BadRequest("Maximum 50 chains per batch", { field: "chains", count: chains.length });
  }

  const batchId = `batch-${Date.now()}`;
  const batchDir = nsPath(namespaceId, "batches", batchId);
  mkdirSync(batchDir, { recursive: true });

  // Prepare chain files and build batch config
  const batchConfig = {
    id: batchId,
    mode,
    chains: [] as Array<{
      id: string;
      file: string;
      goal: string;
    }>,
  };

  for (const chainReq of chains) {
    const safeChainId = validateChainId(chainReq.id);
    const chainDir = join(batchDir, safeChainId);
    mkdirSync(chainDir, { recursive: true });

    let chainFile: string;

    if (chainReq.chain) {
      // Use provided chain config
      const chainData: Record<string, unknown> = { ...chainReq.chain };

      // Inject goal if provided
      if (chainReq.goal && Array.isArray(chainData.agents) && chainData.agents.length > 0) {
        const safeGoal = String(chainReq.goal).slice(0, 50000);
        chainData.agents = chainData.agents.map((agent: Record<string, unknown>, idx: number) => {
          let prompt = String(agent.prompt || agent.role || "");
          if (prompt.includes("{TASK}")) {
            prompt = prompt.replace(/\{TASK\}/g, safeGoal);
          } else if (idx === 0) {
            prompt = `USER REQUEST:\n${safeGoal}\n\nAGENT INSTRUCTIONS:\n${prompt}`;
          }
          return { ...agent, prompt };
        });
      }

      chainFile = join(chainDir, "chain.json");
      writeFileSync(chainFile, JSON.stringify(chainData, null, 2));
    } else if (chainReq.file) {
      // Validate and use existing chain file
      const safeFile = String(chainReq.file);
      // prevent path traversal
      if (safeFile.includes("..") || safeFile.includes("~")) {
        throw new BadRequest(`Invalid chain file path for ${safeChainId}`, { chainId: safeChainId });
      }
      chainFile = safeFile;
    } else {
      throw new BadRequest(`Chain ${safeChainId} must have either file or chain config`, { chainId: safeChainId });
    }

    batchConfig.chains.push({
      id: safeChainId,
      file: chainFile,
      goal: chainReq.goal || "",
    });
  }

  // Write batch config
  const batchConfigFile = join(batchDir, "batch.json");
  writeFileSync(batchConfigFile, JSON.stringify(batchConfig, null, 2));

  // Track in memory
  const batchStatus: BatchStatus = {
    id: batchId,
    mode,
    status: "running",
    started: new Date().toISOString(),
    chains: batchConfig.chains.map((c) => ({
      id: c.id,
      status: "pending" as const,
    })),
  };
  batchState.set(batchId, batchStatus);

  // Launch multi-chain-runner (non-blocking for parallel mode)
  const runnerPath = resolve(MULTI_CHAIN_RUNNER);
  const configPath = resolve(batchConfigFile);

  // validate paths are within expected directories
  if (!runnerPath.startsWith(config.root) || !configPath.startsWith(config.root)) {
    throw new BadRequest("Invalid runner or config path", { field: "path" });
  }

  const cmd = `"${runnerPath}" "${configPath}" --mode ${mode}`;
  const env = buildChildEnv({
    MENTIKO_GLOBAL_ROOT: config.globalRoot,
    MENTIKO_CODE_ROOT: config.codeRoot,
    MENTIKO_PROJECT_ROOT: config.projectRoot,
    MENTIKO_ORG_ROOT: config.orgRoot,
    MENTIKO_NAMESPACE_ROOT: config.namespaceRoot,
    NAMESPACE_ID: namespaceId,
    ORG_ID: orgId,
    ...buildLocalAiGatewayProxyEnv(new URL(request.url).origin),
  });

  if (mode === "parallel") {
    // Spawn and return immediately
    const child = spawn("bash", ["-c", cmd], {
      cwd: config.codeRoot,
      env,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } else {
    // Sequential mode - run with timeout
    try {
      execSync(cmd, {
        cwd: config.codeRoot,
        env,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 600000, // 10 min
      });
    } catch (_error: unknown) {
      // Update batch status to failed
      batchStatus.status = "failed";
      batchState.set(batchId, batchStatus);
    }
  }

  return apiSuccess({
    success: true,
    batchId,
    mode,
    chains: chains.length,
    status: batchStatus.status,
  });
});

// DELETE /api/chains/run-batch - cancel a running batch
export const DELETE = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { searchParams } = new URL(request.url);
  const batchId = searchParams.get("id");

  if (!batchId) {
    throw new BadRequest("Batch ID is required", { field: "id" });
  }

  const safeBatchId = validateBatchId(batchId);
  const namespaceId = await getNamespaceIdFromRequest(request);
  const batchDir = nsPath(namespaceId, "batches", safeBatchId);

  // Kill all pids in the batch - safe approach using fs
  const chainDirs = readdirSync(batchDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  const pids: number[] = [];
  for (const chainDir of chainDirs) {
    const pidFile = join(batchDir, chainDir, "pid");
    if (existsSync(pidFile)) {
      try {
        const pidStr = readFileSync(pidFile, "utf-8").trim();
        const pid = parseInt(pidStr, 10);
        if (pid > 0 && pid < 2147483647) {
          pids.push(pid);
        }
      } catch {
        // ignore invalid pid files
      }
    }
  }

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process already dead
    }
  }

  // Update batch status
  const batchFile = join(batchDir, "batch.json");
  if (existsSync(batchFile)) {
    const batchData = JSON.parse(readFileSync(batchFile, "utf-8"));
    batchData.status = "cancelled";
    batchData.completed = new Date().toISOString();
    writeFileSync(batchFile, JSON.stringify(batchData, null, 2));
  }

  return apiSuccess({ success: true, cancelled: pids.length });
});
