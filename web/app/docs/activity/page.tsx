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
          <div><code className="text-foreground/70">agent</code> - agent execution events (launch, complete)</div>
          <div><code className="text-foreground/70">system</code> - schedule triggers, errors, and other platform events</div>
        </div>
        <p className="text-xs text-foreground/40 italic">
          Note: schedule and webhook events are grouped under the system filter.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Activity Entry Format</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Each activity log entry captures the full event context:
        </p>
        <CodeBlock>{`{
  "id": "act_789",
  "type": "chain_completed",
  "title": "Chain completed: deploy-pipeline",
  "message": "Successfully finished execution",
  "timestamp": "2026-03-16T10:30:00Z",
  "metadata": {
    "runId": "run_456",
    "chainId": "deploy-pipeline",
    "chainName": "deploy-pipeline",
    "status": "completed"
  }
}`}</CodeBlock>
        <p className="text-xs text-foreground/40 italic mt-2">
          Agent events include <code>agentId</code> and <code>agentName</code> in metadata.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Filtering and Search</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Narrow down activity to find what matters:
        </p>
        <div className="bg-card rounded-md p-3 space-y-1 text-xs text-foreground/60">
          <div>Filter by source - All, Chains, Agents, System</div>
          <div>Text search - search in page UI (not persisted)</div>
        </div>
        <p className="text-xs text-foreground/40 italic mt-2">
          Events are sorted by timestamp (newest first). Limited to the most recent 100 events.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Activity Persistence</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Activity data is read from multiple project-level sources:
        </p>
        <CodeBlock>{`namespaces/{id}/[projects/{projectId}/]
  ├── runs/
  │   └── run-*/
  │       └── run.json          # chain execution records
  ├── state/
  │   └── *.state               # agent state files
  └── events/
      ├── *.event                # event files
      └── *.md                   # markdown events`}</CodeBlock>
        <p className="text-xs text-foreground/40 italic mt-2">
          Default org/project collapse into the namespace root (no nesting).
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Real-Time Updates</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          The activity feed updates automatically via polling:
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div>5-second polling interval</div>
          <div>Auto-refresh on filter change</div>
          <div>Manual refresh via page banner action</div>
        </div>
        <p className="text-xs text-foreground/40 italic mt-2">
          SSE/WebSocket support is reserved for future implementation.
        </p>
      </section>
      </div>
    </div>
  );
}
