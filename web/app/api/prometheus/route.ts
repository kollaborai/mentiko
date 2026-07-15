import { NextRequest, NextResponse } from "next/server";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import config from "@/lib/config";
import { checkAuth } from "@/lib/auth/api-auth";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling } from "@/lib/api-response";
import { legacyWebhookDeliveryCounts, resolveLegacyWebhookStateDir } from "@/lib/runner-v2/integration-contract";

export const dynamic = "force-dynamic";

interface Run {
  id: string;
  chain: string;
  chainId?: string;
  started: string;
  completed?: string;
  status: string;
  agents: Array<{ id: string; status: string }>;
}

function toPrometheusMetric(
  name: string,
  value: number | string,
  type: "gauge" | "counter",
  help: string,
  labels?: Record<string, string>
): string {
  const lines: string[] = [];

  // help comment
  lines.push(`# HELP ${name} ${help}`);
  lines.push(`# TYPE ${name} ${type}`);

  // metric line with labels
  if (labels) {
    const labelStr = Object.entries(labels)
      .map(([k, v]) => `${k}="${escapeLabelValue(v)}"`)
      .join(",");
    lines.push(`${name}{${labelStr}} ${value}`);
  } else {
    lines.push(`${name} ${value}`);
  }

  return lines.join("\n");
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const lines: string[] = [];

  // system uptime
  lines.push(toPrometheusMetric("mentiko_uptime_ms", Math.floor(process.uptime() * 1000), "gauge", "Server uptime in milliseconds"));
  lines.push("");

  // collect run data
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
          runs.push(JSON.parse(content));
        } catch {
          // skip invalid
        }
      }
    } catch {
      // ignore
    }
  }

  // run count by status
  const runByStatus: Record<string, number> = {};
  const runByChain: Record<string, number> = {};

  for (const run of runs) {
    runByStatus[run.status] = (runByStatus[run.status] || 0) + 1;
    const chainKey = run.chainId || run.chain.toLowerCase().replace(/\s+/g, "-");
    runByChain[chainKey] = (runByChain[chainKey] || 0) + 1;
  }

  lines.push(toPrometheusMetric("mentiko_runs_total", runs.length, "gauge", "Total number of runs"));
  lines.push("");

  for (const [status, count] of Object.entries(runByStatus)) {
    lines.push(toPrometheusMetric("mentiko_runs_by_status", count, "gauge", "Runs by status", { status }));
  }
  lines.push("");

  for (const [chain, count] of Object.entries(runByChain)) {
    lines.push(toPrometheusMetric("mentiko_runs_by_chain", count, "gauge", "Runs by chain", { chain }));
  }
  lines.push("");

  // agent metrics
  let totalAgents = 0;
  const agentByStatus: Record<string, number> = {};

  for (const run of runs) {
    for (const agent of run.agents || []) {
      totalAgents++;
      agentByStatus[agent.status] = (agentByStatus[agent.status] || 0) + 1;
    }
  }

  lines.push(toPrometheusMetric("mentiko_agents_total", totalAgents, "gauge", "Total number of agents"));
  lines.push("");

  for (const [status, count] of Object.entries(agentByStatus)) {
    lines.push(toPrometheusMetric("mentiko_agents_by_status", count, "gauge", "Agents by status", { status }));
  }
  lines.push("");

  // webhook metrics
  const { total: webhooksTotal, delivered: webhooksDelivered, failed: webhooksFailed, pending: webhooksPending } = legacyWebhookDeliveryCounts(resolveLegacyWebhookStateDir());

  lines.push(toPrometheusMetric("mentiko_webhooks_total", webhooksTotal, "gauge", "Total webhooks sent"));
  lines.push(toPrometheusMetric("mentiko_webhooks_delivered", webhooksDelivered, "gauge", "Webhooks successfully delivered"));
  lines.push(toPrometheusMetric("mentiko_webhooks_failed", webhooksFailed, "gauge", "Webhooks that failed delivery"));
  lines.push(toPrometheusMetric("mentiko_webhooks_pending", webhooksPending, "gauge", "Webhooks pending delivery"));
  lines.push("");

  // timestamp
  lines.push(toPrometheusMetric("mentiko_scrape_timestamp", Date.now(), "gauge", "Scrape timestamp in milliseconds"));

  const prometheusText = lines.join("\n") + "\n";

  return new NextResponse(prometheusText, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; version=0.0.4",
    },
  });
});
