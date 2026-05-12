import { NextRequest } from "next/server";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import config from "@/lib/config";
import { checkAuth } from "@/lib/api-auth";
import { Unauthorized, NotFound, InternalServerError } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

interface ApiCall {
  model: string;
  timestamp: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  duration_ms: number;
}

interface ResourceSample {
  timestamp: string;
  cpu_pct?: number;
  mem_pct?: number;
  elapsed?: string;
}

interface AgentPerf {
  id: string;
  name: string;
  session: string;
  started: string;
  start_ms: number;
  status: string;
  end_ms?: number;
  duration_ms: number;
  api_calls: ApiCall[];
  total_calls: number;
  total_tokens: number;
  total_cost_usd: number;
  resource_samples?: ResourceSample[];
}

interface PerformanceData {
  run_id: string;
  started: string;
  agents: Record<string, AgentPerf>;
  summary: {
    total_api_calls: number;
    total_tokens: number;
    total_cost_usd: number;
    total_duration_ms: number;
  };
}

const PERF_DIR = join(config.namespaceRoot, "metrics");

// GET /api/performance - get performance data for runs
export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { searchParams } = new URL(request.url);
  const runId = searchParams.get("run-id");

  if (runId) {
    // get performance for specific run
    const perfFile = join(PERF_DIR, runId, "performance.json");

    if (!existsSync(perfFile)) {
      throw new NotFound("Performance data", runId);
    }

    try {
      const content = readFileSync(perfFile, "utf-8");
      const data: PerformanceData = JSON.parse(content);
      return apiSuccess(data);
    } catch (_e: unknown) {
      throw new InternalServerError("Failed to read performance data");
    }
  }

  // list all runs with performance data
  if (!existsSync(PERF_DIR)) {
    return apiSuccess({ runs: [] });
  }

  try {
    const entries = readdirSync(PERF_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith("run-"));

    const runs: Array<{
      run_id: string;
      summary: PerformanceData["summary"];
      agent_count: number;
    }> = [];

    for (const entry of entries) {
      const perfFile = join(PERF_DIR, entry.name, "performance.json");
      if (!existsSync(perfFile)) continue;

      try {
        const content = readFileSync(perfFile, "utf-8");
        const data: PerformanceData = JSON.parse(content);
        runs.push({
          run_id: data.run_id || entry.name,
          summary: data.summary,
          agent_count: Object.keys(data.agents || {}).length,
        });
      } catch {
        // skip invalid
      }
    }

    // sort by run id (newest first)
    runs.sort((a, b) => b.run_id.localeCompare(a.run_id));

    return apiSuccess({ runs });
  } catch (_e: unknown) {
    throw new InternalServerError("Failed to list performance data");
  }
});
