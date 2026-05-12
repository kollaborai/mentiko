"use client";

import { PageBanner } from "@/components/ui/page-banner";
import { SendFilled, LinkFilled, Webhook } from "@aliimam/icons";

const CodeBlock = ({ children }: { children: string }) => (
  <pre className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto mb-4">
    {children}
  </pre>
);

export default function EventsDocPage() {
  return (
    <div>
      <PageBanner
        title="Events"
        subtitle="File-based event system for agent communication. Agents emit events on completion, and chains can trigger on specific events."
        icon={SendFilled}
        sectionColor="#f59e0b"
        actions={[
          { label: "Events", href: "/events", icon: SendFilled, iconColor: "#b07ee8" },
          { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
          { label: "Webhooks", href: "/webhooks", icon: Webhook, iconColor: "#b07ee8" },
        ]}
      />
      <div className="px-6 pb-6 max-w-3xl">

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Event Flow</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Events drive agent handoffs in chains. When an agent completes, it
          writes an event file. The chain-runner reads this and determines the
          next agent to launch.
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div>1. Agent completes, writes event to events/ directory</div>
          <div>2. Chain-runner detects new event file</div>
          <div>3. Next agent with matching trigger is launched</div>
          <div>4. Event file marked as processed</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Triggers and Emits</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Agents define which events they respond to and what they produce:
        </p>
        <CodeBlock>{`{
  "id": "deployer",
  "name": "Deployer",
  "triggers": ["build_complete", "test_passed"],
  "emits": "deploy_complete"
}`}</CodeBlock>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          When <code className="text-foreground/70 bg-muted px-1 rounded">build_complete</code> or <code className="text-foreground/70 bg-muted px-1 rounded">test_passed</code> is emitted,
          the deployer agent starts. On completion, it emits <code className="text-foreground/70 bg-muted px-1 rounded">deploy_complete</code>.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Event Storage and Format</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Events are stored in the configured events directory. The system reads
          files ending in .event, .json, or .md and parses them line-by-line.
        </p>
        <CodeBlock>{`# Example event file (line-based format)
event: chain-complete
source: system
timestamp: 2026-03-16T10:30:00Z
processed: false
data: runId=run-abc123 status=success

# Event file storage
namespaces/{id}/events/
  ├── chain-complete--1747498200.event
  ├── agent-error--1747498245.event
  └── webhook-triggered--1747498280.json

# Event structure (parsed from file)
{
  "filename": "chain-complete--1747498200.event",
  "event": "chain-complete",
  "source": "system",
  "timestamp": "2026-03-16T10:30:00Z",
  "processed": false,
  "data": "runId=run-abc123 status=success"
}`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Built-in Events</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          The system emits these events automatically:
        </p>
        <div className="bg-card rounded-md p-3 space-y-1 text-xs text-foreground/60">
          <div><code className="text-foreground/70">manual-start</code> - triggered manually or via API</div>
          <div><code className="text-foreground/70">chain-started</code> - chain execution begins</div>
          <div><code className="text-foreground/70">chain-complete</code> - all agents finished successfully</div>
          <div><code className="text-foreground/70">chain-error</code> - chain failed</div>
          <div><code className="text-foreground/70">agent-started</code> - agent launched</div>
          <div><code className="text-foreground/70">agent-complete</code> - agent finished</div>
          <div><code className="text-foreground/70">agent-error</code> - agent returned error</div>
          <div><code className="text-foreground/70">agent-timeout</code> - agent exceeded timeout</div>
          <div><code className="text-foreground/70">webhook-triggered</code> - chain triggered via webhook</div>
          <div><code className="text-foreground/70">schedule-triggered</code> - chain triggered by schedule</div>
          <div><code className="text-foreground/70">fan-in-complete</code> - all fan-out agents complete</div>
          <div><code className="text-foreground/70">fan-out-complete</code> - parallel agents finished</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Custom Event Triggers</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Trigger chains externally by writing event files or using the CLI:
        </p>
        <CodeBlock>{`# CLI: emit an event
./bin/mentiko emit custom_event "manual trigger"

# API: trigger a chain via webhook
POST /api/webhooks/{webhookId}
{
  "event": "deploy_requested",
  "data": { "branch": "main" }
}`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Event Log Viewer</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          The /events page shows all system events with filtering and search:
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div>Filter by event name or source agent</div>
          <div>View event payload and metadata</div>
          <div>Replay events for debugging</div>
          <div>Export event log as JSON or CSV</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Fan-In: Wait for Multiple Events</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Agents can wait for multiple events before starting (fan-in pattern).
          Use <code className="text-foreground/70 bg-muted px-1 rounded">wait_for_events</code> to synchronize across parallel workflows:
        </p>
        <CodeBlock>{`{
  "id": "consolidator",
  "name": "Data Consolidator",
  "wait_for_events": {
    "events": ["build_complete", "test_complete", "scan_complete"],
    "wait_for": "all",
    "timeout": 1800
  },
  "emits": "deploy_ready"
}`}</CodeBlock>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          <code className="text-foreground/70 bg-muted px-1 rounded">wait_for</code> options: <code className="text-foreground/70">all</code> (all events),
          <code className="text-foreground/70">any</code> (first event), or <code className="text-foreground/70">quorum</code> (minimum count).
        </p>
      </section>
      </div>
    </div>
  );
}
