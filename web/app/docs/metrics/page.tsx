"use client";

import { PageBanner } from "@/components/ui/page-banner";
import { ChartFilled, RouteSquareFilled, BotMessageSquare } from "@aliimam/icons";

const CodeBlock = ({ children }: { children: string }) => (
  <pre className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto mb-4">
    {children}
  </pre>
);

export default function MetricsDocPage() {
  return (
    <div>
      <PageBanner
        title="Metrics"
        subtitle="Track chain run performance, agent execution times, and usage statistics. Identify bottlenecks and optimize chain efficiency."
        icon={ChartFilled}
        sectionColor="#f59e0b"
        actions={[
          { label: "Metrics", href: "/settings/metrics", icon: ChartFilled, iconColor: "#a0927b" },
          { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
          { label: "Agents", href: "/agents", icon: BotMessageSquare, iconColor: "#b07ee8" },
        ]}
      />
      <div className="px-6 pb-6 max-w-3xl">

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Collected Metrics</h2>
        <div className="bg-card rounded-md p-3 space-y-2 text-xs text-foreground/60 mb-3">
          <div><code className="text-foreground/70">runs.total</code> - total runs found under the active project</div>
          <div><code className="text-foreground/70">runs.by_status</code> - run counts by current status</div>
          <div><code className="text-foreground/70">runs.by_chain</code> - run counts grouped by chain id/name</div>
          <div><code className="text-foreground/70">runs.avg_duration_ms</code> - completed-run duration average</div>
          <div><code className="text-foreground/70">agents.by_status</code> - agent status counts from run records</div>
          <div><code className="text-foreground/70">webhooks</code> - delivery totals and success rate</div>
          <div><code className="text-foreground/70">tokens.total_7d</code> - recent token counters when present</div>
          <div><code className="text-foreground/70">execution_times</code> - timer metrics from the shell metrics store</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Metric Format</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          The metrics API derives run totals from run records and merges optional shell metrics from
          <code className="text-foreground/70 bg-muted px-1 rounded ml-1">~/.mentiko-metrics</code>:
        </p>
        <CodeBlock>{`~/.mentiko-metrics/
├── counters.json
├── gauges.json
├── timers.json
└── webhooks.json

{
  "runs": { "total": 42, "by_status": { "completed": 30 }, "success_rate": 71.4 },
  "agents": { "total": 96, "by_status": { "complete": 61 } },
  "webhooks": { "total": 12, "delivered": 10, "failed": 2, "pending": 0 },
  "tokens": { "total_7d": 0, "input_7d": 0, "output_7d": 0 },
  "execution_times": { "chain.run": { "count": 3, "avg_ms": 1200 } }
}`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Usage Statistics</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Aggregated stats across all runs in a workspace:
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div>Total runs - all time count</div>
          <div>Total agents - cumulative agent executions</div>
          <div>Total tokens - input + output across all runs</div>
          <div>Avg duration - mean chain completion time</div>
          <div>Success rate - completed vs failed runs</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Performance Charts</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Visualize metrics over time with customizable charts:
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div>Runs by chain - top chains by run count</div>
          <div>Status distribution - run counts by status</div>
          <div>Webhook success - delivered, failed, and pending deliveries</div>
          <div>Recent run panels - duration, agents, and live run summaries</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Metric Retention</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Current metrics are computed from retained run records plus the optional shell metrics
          files. There is no daily, weekly, or monthly rollup job in the app:
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div>Run records - used for totals, durations, status, and agent counts</div>
          <div>Shell metrics - counters, gauges, timers, and webhook summaries</div>
          <div>Endpoint timings - in-memory API timing stats until reset or process restart</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Metrics API</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Query metrics programmatically for custom dashboards:
        </p>
        <CodeBlock>{`# Get workspace metrics as JSON
GET /api/metrics

# Get Prometheus output
GET /api/metrics?format=prometheus

# Get API endpoint timing stats
GET /api/metrics/endpoints?view=all&min_calls=5
GET /api/metrics/endpoints?view=slow
GET /api/metrics/endpoints?view=sub`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Identifying Bottlenecks</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Use metrics to find slow agents and optimize chain performance:
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div>Sort agents by duration - find the slowest</div>
          <div>Check rounds vs time - LLM API latency vs compute</div>
          <div>Token efficiency - output per input ratio</div>
          <div>Error patterns - recurring failures by type</div>
        </div>
      </section>
      </div>
    </div>
  );
}
