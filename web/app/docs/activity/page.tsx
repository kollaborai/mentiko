"use client";

import { PageBanner } from "@/components/ui/page-banner";
import { ActivityFilled, RouteSquareFilled, SendFilled } from "@aliimam/icons";

const CodeBlock = ({ children }: { children: string }) => (
  <pre className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto mb-4">
    {children}
  </pre>
);

export default function ActivityDocPage() {
  return (
    <div>
      <PageBanner
        title="Activity Feed"
        subtitle="Real-time activity feed showing all system events across chains, agents, and schedules. Filter by type, search, and drill into details."
        icon={ActivityFilled}
        sectionColor="#f59e0b"
        actions={[
          { label: "Activity", href: "/activity", icon: ActivityFilled, iconColor: "#5b9ef5" },
          { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
          { label: "Events", href: "/events", icon: SendFilled, iconColor: "#b07ee8" },
        ]}
      />
      <div className="px-6 pb-6 max-w-3xl">

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Event Sources</h2>
        <div className="bg-card rounded-md p-3 space-y-2 text-xs text-foreground/60 mb-3">
          <div><code className="text-foreground/70">chain</code> - chain lifecycle events (start, complete, fail)</div>
          <div><code className="text-foreground/70">agent</code> - agent execution events (launch, heartbeat, done)</div>
          <div><code className="text-foreground/70">schedule</code> - scheduler events (trigger, miss, disable)</div>
          <div><code className="text-foreground/70">system</code> - platform events (auth, billing, org changes)</div>
          <div><code className="text-foreground/70">webhook</code> - incoming webhook triggers</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Activity Entry Format</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Each activity log entry captures the full event context:
        </p>
        <CodeBlock>{`{
  "id": "act_789",
  "timestamp": "2026-03-16T10:30:00Z",
  "source": "chain",
  "type": "chain_complete",
  "message": "Deploy pipeline completed",
  "metadata": {
    "chainId": "deploy-pipeline",
    "runId": "run_456",
    "duration": 45,
    "agentCount": 3,
    "workspaceId": "local"
  }
}`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Time Buckets</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Activity is grouped into time buckets for easier navigation:
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div>Now - last 5 minutes</div>
          <div>Today - earlier today</div>
          <div>Yesterday - yesterday&apos;s activity</div>
          <div>This week - last 7 days</div>
          <div>Older - everything else</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Filtering and Search</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Narrow down activity to find what matters:
        </p>
        <div className="bg-card rounded-md p-3 space-y-1 text-xs text-foreground/60">
          <div>Filter by source - chains, agents, schedules, system</div>
          <div>Filter by type - complete, failed, started, etc.</div>
          <div>Search text - matches message, chain ID, agent name</div>
          <div>Date range picker - custom time window</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Activity Persistence</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Activity logs are stored in the project-scoped events directory:
        </p>
        <CodeBlock>{`namespaces/{id}/projects/{cwd}/events/
  ├── 2026-03-16.jsonl     # daily log files
  ├── 2026-03-15.jsonl
  └── ...`}</CodeBlock>
        <p className="text-xs text-foreground/60 leading-relaxed">
          Events are appended as JSONL for efficient streaming and rotation.
          Retention is configurable per workspace.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Real-Time Updates</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          The activity feed connects via WebSocket to receive live updates as
          events occur. No refresh needed - new activity appears instantly.
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div>WebSocket connection for live streaming</div>
          <div>Auto-reconnect on connection loss</div>
          <div>Optimistic UI updates for instant feedback</div>
        </div>
      </section>
      </div>
    </div>
  );
}
