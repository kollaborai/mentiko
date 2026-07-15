import { NextRequest, NextResponse } from "next/server";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import config from "@/lib/config";
import { checkAuth } from "@/lib/auth/api-auth";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { legacyWebhookDeliveryCounts, resolveLegacyWebhookStateDir } from "@/lib/runner-v2/integration-contract";
import { readLegacyMetrics } from "@/lib/runner-v2/legacy-metrics";

export const dynamic = "force-dynamic";

interface Run {
  id: string;
  chain: string;
  chainId?: string;
  goal: string;
  started: string;
  completed?: string;
  status: string;
  agents: Array<{ id: string; name?: string; status: string; session: string }>;
}

interface TimerMetric {
  count: number;
  total_ms: number;
  avg_ms: number;
  min_ms: number;
  max_ms: number;
  type: string;
}

interface MetricsData {
  generated: string;
  counters: Record<string, number>;
  gauges: Record<string, number>;
  timers: Record<string, TimerMetric>;
  webhooks: {
    total: number;
    delivered: number;
    failed: number;
    by_event: Record<string, { total: number; delivered: number; failed: number; total_rt: number }>;
  };
}

interface Metrics {
  runs: {
    total: number;
    by_status: Record<string, number>;
    by_chain: Record<string, number>;
    success_rate: number;
    avg_duration_ms?: number;
  };
  agents: {
    total: number;
    by_status: Record<string, number>;
  };
  webhooks: {
    total: number;
    delivered: number;
    failed: number;
    pending: number;
    success_rate: number;
  };
  tokens: {
    total_7d: number;
    input_7d: number;
    output_7d: number;
  };
  system: {
    uptime_ms: number;
    timestamp: string;
  };
  // new metrics from metrics.sh
  execution_times?: Record<string, TimerMetric>;
}

function readMetricsFiles(): MetricsData | null {
  try {
    return readLegacyMetrics(config.metricsDir);
  } catch {
    return null;
  }
}

function formatPrometheus(metrics: Metrics, extraData: MetricsData | null): string {
  const lines: string[] = [];

  lines.push("# mentiko metrics");
  lines.push(`# generated ${metrics.system.timestamp}`);
  lines.push("");

  // run metrics
  lines.push("# HELP mentiko_runs_total Total number of runs");
  lines.push("# TYPE mentiko_runs_total gauge");
  lines.push(`mentiko_runs_total ${metrics.runs.total}`);

  lines.push("# HELP mentiko_runs_success_rate Success rate percentage");
  lines.push("# TYPE mentiko_runs_success_rate gauge");
  lines.push(`mentiko_runs_success_rate ${metrics.runs.success_rate}`);

  for (const [status, count] of Object.entries(metrics.runs.by_status)) {
    lines.push(`mentiko_runs_by_status{status="${status}"} ${count}`);
  }
  lines.push("");

  // agent metrics
  lines.push("# HELP mentiko_agents_total Total number of agents");
  lines.push("# TYPE mentiko_agents_total gauge");
  lines.push(`mentiko_agents_total ${metrics.agents.total}`);

  for (const [status, count] of Object.entries(metrics.agents.by_status)) {
    lines.push(`mentiko_agents_by_status{status="${status}"} ${count}`);
  }
  lines.push("");

  // webhook metrics
  lines.push("# HELP mentiko_webhooks_total Total webhooks sent");
  lines.push("# TYPE mentiko_webhooks_total counter");
  lines.push(`mentiko_webhooks_total ${metrics.webhooks.total}`);

  lines.push("# HELP mentiko_webhooks_delivered Total webhooks delivered");
  lines.push("# TYPE mentiko_webhooks_delivered counter");
  lines.push(`mentiko_webhooks_delivered ${metrics.webhooks.delivered}`);

  lines.push("# HELP mentiko_webhooks_failed Total webhooks failed");
  lines.push("# TYPE mentiko_webhooks_failed counter");
  lines.push(`mentiko_webhooks_failed ${metrics.webhooks.failed}`);

  lines.push("# HELP mentiko_webhooks_success_rate Webhook success rate percentage");
  lines.push("# TYPE mentiko_webhooks_success_rate gauge");
  lines.push(`mentiko_webhooks_success_rate ${metrics.webhooks.success_rate}`);
  lines.push("");

  // extra metrics from metrics.sh
  if (extraData) {
    // counters
    lines.push("# HELP mentiko_counter Counter metrics");
    lines.push("# TYPE mentiko_counter gauge");
    for (const [key, value] of Object.entries(extraData.counters)) {
      lines.push(`mentiko_counter{name="${key}"} ${value}`);
    }
    lines.push("");

    // gauges
    lines.push("# HELP mentiko_gauge Gauge metrics");
    lines.push("# TYPE mentiko_gauge gauge");
    for (const [key, value] of Object.entries(extraData.gauges)) {
      lines.push(`mentiko_gauge{name="${key}"} ${value}`);
    }
    lines.push("");

    // timers
    lines.push("# HELP mentiko_timer_ms Timer metrics in milliseconds");
    lines.push("# TYPE mentiko_timer_count gauge");
    for (const [key, value] of Object.entries(extraData.timers)) {
      lines.push(`mentiko_timer_count{name="${key}"} ${value.count}`);
    }

    lines.push("# TYPE mentiko_timer_avg_ms gauge");
    for (const [key, value] of Object.entries(extraData.timers)) {
      lines.push(`mentiko_timer_avg_ms{name="${key}"} ${value.avg_ms}`);
    }

    lines.push("# TYPE mentiko_timer_max_ms gauge");
    for (const [key, value] of Object.entries(extraData.timers)) {
      lines.push(`mentiko_timer_max_ms{name="${key}"} ${value.max_ms}`);
    }
    lines.push("");

    // webhook by event
    lines.push("# HELP mentiko_webhook_by_event Webhooks by event type");
    lines.push("# TYPE mentiko_webhook_by_event counter");
    for (const [event, data] of Object.entries(extraData.webhooks.by_event)) {
      lines.push(`mentiko_webhook_by_event{event="${event}",status="delivered"} ${data.delivered || 0}`);
      lines.push(`mentiko_webhook_by_event{event="${event}",status="failed"} ${data.failed || 0}`);
    }
  }

  return lines.join("\n");
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") || "json";

  // collect run metrics
  const runsDir = config.runsDir;
  const runs: Run[] = [];

  if (existsSync(runsDir)) {
    try {
      const entries = readdirSync(runsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.startsWith("run-"));

      for (const entry of entries) {
        const runFile = join(runsDir, entry.name, "run.json");
        if (!existsSync(runFile)) continue;

        try {
          const content = readFileSync(runFile, "utf-8");
          const run: Run = JSON.parse(content);
          runs.push(run);
        } catch {
          // skip invalid json
        }
      }
    } catch {
      // ignore errors
    }
  }

  // calculate run metrics
  const runByStatus: Record<string, number> = {};
  const runByChain: Record<string, number> = {};
  let completedRuns = 0;
  let totalDuration = 0;

  for (const run of runs) {
    runByStatus[run.status] = (runByStatus[run.status] || 0) + 1;
    const chainKey = run.chainId || run.chain;
    runByChain[chainKey] = (runByChain[chainKey] || 0) + 1;

    if (run.completed && run.started) {
      completedRuns++;
      const started = new Date(run.started).getTime();
      const completed = new Date(run.completed).getTime();
      if (!isNaN(started) && !isNaN(completed)) {
        totalDuration += completed - started;
      }
    }
  }

  const successRate = runs.length > 0 ? (completedRuns / runs.length) * 100 : 0;
  const avgDuration = completedRuns > 0 ? totalDuration / completedRuns : undefined;

  // agent metrics
  const agentByStatus: Record<string, number> = {};
  let totalAgents = 0;

  for (const run of runs) {
    for (const agent of run.agents || []) {
      totalAgents++;
      agentByStatus[agent.status] = (agentByStatus[agent.status] || 0) + 1;
    }
  }

  // webhook metrics from state files
  const { total: webhooksTotal, delivered: webhooksDelivered, failed: webhooksFailed, pending: webhooksPending } = legacyWebhookDeliveryCounts(resolveLegacyWebhookStateDir());

  const webhookSuccessRate = webhooksTotal > 0 ? (webhooksDelivered / webhooksTotal) * 100 : 0;

  // token usage from last 7 days (scan conversation JSONL files)
  let tokensTotal7d = 0;
  let tokensInput7d = 0;
  let tokensOutput7d = 0;
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  if (existsSync(runsDir)) {
    try {
      const runDirs = readdirSync(runsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.startsWith("run-"));

      for (const runDir of runDirs) {
        const runFile = join(runsDir, runDir.name, "run.json");
        if (!existsSync(runFile)) continue;

        let runStarted: number;
        try {
          const runData = JSON.parse(readFileSync(runFile, "utf-8"));
          runStarted = new Date(runData.started).getTime();
        } catch { continue; }

        if (runStarted < sevenDaysAgo) continue;

        const artifactsDir = join(runsDir, runDir.name, "artifacts");
        if (!existsSync(artifactsDir)) continue;

        try {
          const convFiles = readdirSync(artifactsDir).filter((f) => f.endsWith("-conversations.json"));

          for (const convFile of convFiles) {
            try {
              const paths: Array<{ path: string }> = JSON.parse(
                readFileSync(join(artifactsDir, convFile), "utf-8")
              );

              for (const { path: jsonlPath } of paths) {
                if (!jsonlPath || !existsSync(jsonlPath)) continue;

                try {
                  const lines = readFileSync(jsonlPath, "utf-8").split("\n");
                  for (const line of lines) {
                    if (!line.includes('"usage"')) continue;
                    try {
                      const obj = JSON.parse(line);
                      const usage = obj?.message?.usage;
                      if (usage) {
                        tokensInput7d += usage.input_tokens || 0;
                        tokensOutput7d += usage.output_tokens || 0;
                      }
                    } catch { /* skip malformed */ }
                  }
                } catch { /* skip unreadable */ }
              }
            } catch { /* skip */ }
          }
        } catch { /* skip */ }
      }
      tokensTotal7d = tokensInput7d + tokensOutput7d;
    } catch { /* ignore */ }
  }

  // read extra metrics from metrics.sh
  const extraData = readMetricsFiles();

  const metrics: Metrics = {
    runs: {
      total: runs.length,
      by_status: runByStatus,
      by_chain: runByChain,
      success_rate: Math.round(successRate * 100) / 100,
      avg_duration_ms: avgDuration,
    },
    agents: {
      total: totalAgents,
      by_status: agentByStatus,
    },
    webhooks: {
      total: webhooksTotal,
      delivered: webhooksDelivered,
      failed: webhooksFailed,
      pending: webhooksPending,
      success_rate: Math.round(webhookSuccessRate * 100) / 100,
    },
    tokens: {
      total_7d: tokensTotal7d,
      input_7d: tokensInput7d,
      output_7d: tokensOutput7d,
    },
    system: {
      uptime_ms: process.uptime() * 1000,
      timestamp: new Date().toISOString(),
    },
    execution_times: extraData?.timers,
  };

  if (format === "prometheus") {
    const prometheus = formatPrometheus(metrics, extraData);
    return new NextResponse(prometheus, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; version=0.0.4",
      },
    });
  }

  return apiSuccess(metrics);
});
