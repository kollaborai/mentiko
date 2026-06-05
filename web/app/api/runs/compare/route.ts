import { NextRequest } from "next/server";
import { checkRunAccess } from "@/lib/auth/run-acl";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { resolveLinkRunsDir } from "@/lib/links/link-run-runtime";
import { diffLines } from "diff";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { BadRequest, NotFound, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

interface RunObject {
  id: string;
  chain: string;
  chainId: string;
  goal: string;
  started: string;
  completed?: string;
  status: string;
  agents: Array<{
    id: string;
    name: string;
    status: string;
    session: string;
  }>;
}

interface AgentPerf {
  id: string;
  name: string;
  total_calls: number;
  total_tokens: number;
  total_cost_usd: number;
  duration_ms: number;
}

interface PerformanceData {
  summary: {
    total_tokens: number;
    total_cost_usd: number;
    total_duration_ms: number;
    total_api_calls: number;
  };
  agents: Record<string, AgentPerf>;
}

interface RunComparison {
  runA: RunObject;
  runB: RunObject;
  metricsDiff: {
    duration: number;
    durationPercent: number;
    tokens: number;
    tokensPercent: number;
    cost: number;
    costPercent: number;
    agentCount: number;
  };
  agentComparison: Array<{
    agentId: string;
    nameA: string;
    nameB: string;
    statusA: string;
    statusB: string;
    outputDiff?: Array<{
      type: "added" | "removed" | "unchanged";
      value: string;
    }>;
  }>;
  perfA?: PerformanceData;
  perfB?: PerformanceData;
}

function readRunFile(runsDir: string, runId: string): RunObject | null {
  const runJsonPath = join(runsDir, runId, "run.json");
  if (!existsSync(runJsonPath)) return null;
  try {
    return JSON.parse(readFileSync(runJsonPath, "utf-8"));
  } catch {
    return null;
  }
}

function readAgentOutput(runsDir: string, runId: string, agentId: string): string {
  const outputPath = join(runsDir, runId, "output", `${agentId}.txt`);
  if (!existsSync(outputPath)) return "";
  try {
    return readFileSync(outputPath, "utf-8");
  } catch {
    return "";
  }
}

function readPerformanceData(runsDir: string, runId: string): PerformanceData | null {
  const perfPath = join(runsDir, runId, "performance.json");
  if (!existsSync(perfPath)) return null;
  try {
    return JSON.parse(readFileSync(perfPath, "utf-8"));
  } catch {
    return null;
  }
}

function computeDiff(outputA: string, outputB: string): Array<{ type: "added" | "removed" | "unchanged"; value: string }> {
  const diff = diffLines(outputA || "", outputB || "");
  return diff.map((part) => ({
    type: (part.added ? ("added" as const) : part.removed ? ("removed" as const) : "unchanged" as const),
    value: part.value,
  }));
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const runA = searchParams.get("runA");
  const runB = searchParams.get("runB");

  if (!runA || !runB) {
    throw new BadRequest("Both runA and runB parameters are required", { field: "runA,runB" });
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const runsDir = resolveLinkRunsDir(namespaceId, orgId);

  // workspace ACL: user must have access to both runs' workspaces
  const aclA = await checkRunAccess(request, runA, runsDir);
  if (!aclA.ok) {
    if (aclA.reason === "run-not-found") throw new NotFound("Run", runA);
    throw new Unauthorized();
  }
  const aclB = await checkRunAccess(request, runB, runsDir);
  if (!aclB.ok) {
    if (aclB.reason === "run-not-found") throw new NotFound("Run", runB);
    throw new Unauthorized();
  }

  const runDataA = readRunFile(runsDir, runA);
  const runDataB = readRunFile(runsDir, runB);

  if (!runDataA) {
    throw new NotFound("Run", runA);
  }
  if (!runDataB) {
    throw new NotFound("Run", runB);
  }

  const perfA = readPerformanceData(runsDir, runA);
  const perfB = readPerformanceData(runsDir, runB);

  const startA = new Date(runDataA.started).getTime();
  const startB = new Date(runDataB.started).getTime();
  const endA = runDataA.completed ? new Date(runDataA.completed).getTime() : Date.now();
  const endB = runDataB.completed ? new Date(runDataB.completed).getTime() : Date.now();

  const durationA = endA - startA;
  const durationB = endB - startB;

  const tokensA = perfA?.summary.total_tokens || 0;
  const tokensB = perfB?.summary.total_tokens || 0;

  const costA = perfA?.summary.total_cost_usd || 0;
  const costB = perfB?.summary.total_cost_usd || 0;

  const metricsDiff = {
    duration: durationB - durationA,
    durationPercent: durationA > 0 ? ((durationB - durationA) / durationA) * 100 : 0,
    tokens: tokensB - tokensA,
    tokensPercent: tokensA > 0 ? ((tokensB - tokensA) / tokensA) * 100 : 0,
    cost: costB - costA,
    costPercent: costA > 0 ? ((costB - costA) / costA) * 100 : 0,
    agentCount: (runDataB.agents?.length || 0) - (runDataA.agents?.length || 0),
  };

  const allAgentIds = new Set([
    ...(runDataA.agents || []).map((a) => a.id),
    ...(runDataB.agents || []).map((a) => a.id),
  ]);

  const agentComparison = Array.from(allAgentIds).map((agentId) => {
    const agentA = (runDataA.agents || []).find((a) => a.id === agentId);
    const agentB = (runDataB.agents || []).find((a) => a.id === agentId);

    const outputA = readAgentOutput(runsDir, runA, agentId);
    const outputB = readAgentOutput(runsDir, runB, agentId);

    return {
      agentId,
      nameA: agentA?.name || agentId,
      nameB: agentB?.name || agentId,
      statusA: agentA?.status || "not_found",
      statusB: agentB?.status || "not_found",
      outputDiff: (outputA || outputB) ? computeDiff(outputA, outputB) : undefined,
    };
  });

  const comparison: RunComparison = {
    runA: runDataA,
    runB: runDataB,
    metricsDiff,
    agentComparison,
    perfA: perfA || undefined,
    perfB: perfB || undefined,
  };

  return apiSuccess(comparison);
});
