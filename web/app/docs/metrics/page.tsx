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
          <div><code className="text-foreground/70">chain_duration</code> - total chain execution time</div>
          <div><code className="text-foreground/70">agent_duration</code> - per-agent execution time</div>
          <div><code className="text-foreground/70">agent_rounds</code> - number of LLM turns per agent</div>
          <div><code className="text-foreground/70">token_usage</code> - tokens consumed per agent</div>
          <div><code className="text-foreground/70">success_rate</code> - chain completion percentage</div>
          <div><code className="text-foreground/70">error_rate</code> - failure types and frequency</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Metric Format</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Metrics are stored per chain run in the metrics directory:
        </p>
        <CodeBlock>{`namespaces/{id}/projects/{cwd}/metrics/
  └── deploy-pipeline--2026-03-16.json

{
  "chainId": "deploy-pipeline",
  "runId": "run_456",
  "timestamp": "2026-03-16T10:30:00Z",
  "totalDuration": 45.2,
  "agents": [
    {
      "agentId": "builder",
      "duration": 12.5,
      "rounds": 8,
      "tokens": {
        "input": 4500,
        "output": 1200
      }
    },
    {
      "agentId": "tester",
      "duration": 25.1,
      "rounds": 15,
      "tokens": {
        "input": 8200,
        "output": 3400
      }
    }
  ],
  "success": true
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
          <div>Duration trend - chain execution times over days/weeks</div>
          <div>Token usage - input/output tokens by date</div>
          <div>Agent breakdown - time spent per agent type</div>
          <div>Error distribution - failure types by frequency</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Metric Retention</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Metrics are stored indefinitely but aggregated for performance:
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div>Raw data - per-run metrics (unlimited)</div>
          <div>Daily aggregates - stats rolled up per day</div>
          <div>Weekly aggregates - stats rolled up per week</div>
          <div>Monthly aggregates - long-term trends</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Metrics API</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Query metrics programmatically for custom dashboards:
        </p>
        <CodeBlock>{`# Get metrics for a specific chain
GET /api/chains/{id}/metrics?from=2026-03-01&to=2026-03-31

# Get aggregated workspace metrics
GET /api/metrics?workspaceId={id}&aggregate=daily

# Get agent performance stats
GET /api/agents/{id}/metrics?runs=50`}</CodeBlock>
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
