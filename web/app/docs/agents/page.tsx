"use client";

import { PageBanner } from "@/components/ui/page-banner";
import { BotMessageSquare, LinkFilled, RouteSquareFilled } from "@aliimam/icons";

const CodeBlock = ({ children }: { children: string }) => (
  <pre className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto mb-4">
    {children}
  </pre>
);

export default function AgentsDocPage() {
  return (
    <div>
      <PageBanner
        title="Agents"
        subtitle="AI workers that execute tasks inside pty sessions. Defined inline in chains or as standalone reusable definitions."
        icon={BotMessageSquare}
        sectionColor="#f59e0b"
        actions={[
          { label: "Agents", href: "/agents", icon: BotMessageSquare, iconColor: "#b07ee8" },
          { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
          { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
        ]}
      />
      <div className="px-6 pb-6 max-w-3xl">

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Inline vs Standalone</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Inline agents are defined directly in the chain JSON. Standalone agents
          live in their own <code className="text-foreground/70 bg-muted px-1 rounded">agent.json</code> files
          and can be referenced across multiple chains via <code className="text-foreground/70 bg-muted px-1 rounded">$ref</code>.
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 mb-3">
          <p className="font-medium text-foreground/70 mb-1">When to use which:</p>
          <div className="space-y-1">
            <div>Inline - one-off agents specific to a single chain</div>
            <div>Standalone - reusable agents shared across chains</div>
          </div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Standalone Agent Format</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Stored at <code className="text-foreground/70 bg-muted px-1 rounded">namespaces/{"{id}"}/agents/{"{name}"}/agent.json</code> (org-scoped)
          or <code className="text-foreground/70 bg-muted px-1 rounded">marketplace/agents/{"{name}"}/agent.json</code> (marketplace/shared).
        </p>
        <CodeBlock>{`{
  "id": "researcher",
  "name": "Researcher",
  "description": "Deep research agent that investigates topics",
  "role": "researcher",
  "version": "1.1",
  "prompt": "You are a research agent...\\n\\n{TASK}",
  "triggers": ["research-request"],
  "emits": "research-complete",
  "model": "claude-sonnet-4-6",
  "tools": ["web_search", "read_file", "write_file"],
  "category": "research",
  "tags": ["research", "analysis"],
  "author": "mentiko"
}`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Agent Resolution</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          When loading an agent by ID, the system checks directories in this order:
        </p>
        <div className="bg-card rounded-md p-3 space-y-1 text-xs text-foreground/60 mb-3">
          <div>1. <code className="text-foreground/70">namespaces/{"{id}"}/agents/{"{agentId}"}/agent.json</code> (org-scoped, wins on conflict)</div>
          <div>2. <code className="text-foreground/70">marketplace/agents/{"{agentId}"}/agent.json</code> (marketplace/shared)</div>
        </div>
        <p className="text-xs text-foreground/60 leading-relaxed">
          Org-scoped agents override marketplace agents with the same ID. This lets you customize
          marketplace agents for your specific needs.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">$ref Syntax in Chains</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Reference standalone agents in your chain&apos;s agents array:
        </p>
        <CodeBlock>{`// basic reference - loads agent as-is
{ "$ref": "researcher" }

// reference with overrides - merges on top
{
  "$ref": "researcher",
  "prompt": "Custom prompt for this chain",
  "triggers": ["custom-trigger"]
}

// mixed array - inline and $ref together
"agents": [
  { "$ref": "researcher" },
  { "$ref": "code-reviewer" },
  { "id": "custom", "name": "Custom", ... }
]`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Artifacts</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Agents can declare what they produce and consume. Artifacts are named outputs that
          flow between agents in a chain. Use them for structured handoff of results.
        </p>
        <CodeBlock>{`"artifacts": {
  "produces": [
    {
      "id": "analysis",
      "type": "markdown",
      "description": "Research analysis document"
    },
    {
      "id": "code",
      "type": "code",
      "description": "Generated source code"
    }
  ],
  "consumes": [
    {
      "from": "researcher",
      "artifact": "notes",
      "required": true
    }
  ]
}

// artifact types: markdown, json, code, patch, csv, text, image
// file naming: {agentId}-{artifactId}.{ext}`}</CodeBlock>
        <p className="text-xs text-foreground/60 leading-relaxed">
          Artifact types: markdown, json, code, patch, csv, text, image. Filenames follow the pattern
          <code className="text-foreground/70 bg-muted px-1 rounded">{"{agentId}.{artifactId}.{ext}"}</code>.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Fan-In: Wait for Multiple Events</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Use <code className="text-foreground/70 bg-muted px-1 rounded">wait_for_events</code> to make an agent wait for multiple upstream events
          before starting. Useful for joining parallel branches or aggregating results.
        </p>
        <CodeBlock>{`// wait for all events (default)
"wait_for_events": {
  "events": ["research-done", "code-done", "tests-done"],
  "wait_for": "all",
  "timeout": 3600
},

// wait for any event
"wait_for_events": {
  "events": ["decision-approved", "decision-rejected"],
  "wait_for": "any"
},

// quorum: wait for 2 of 3 events
"wait_for_events": {
  "events": ["reviewer-1", "reviewer-2", "reviewer-3"],
  "wait_for": "quorum",
  "quorum": 2,
  "timeout": 1800
}`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Skill Import</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Import agents from Claude Code skills. The system scans <code className="text-foreground/70 bg-muted px-1 rounded">~/.claude/skills/</code> for
          SKILL.md files with YAML frontmatter and converts them to standalone agent definitions.
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div>1. Go to the Agents page</div>
          <div>2. Click &quot;Import Skills&quot;</div>
          <div>3. Select skills to import</div>
          <div>4. Imported agents appear in your namespace registry</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Agent Marketplace</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          The marketplace provides a catalog of pre-built agents you can install.
          Marketplace agents live in the shared <code className="text-foreground/70 bg-muted px-1 rounded">marketplace/agents/</code> directory.
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div>Browse: <code className="text-foreground/70">/agents/marketplace</code></div>
          <div>Install: copies agent to your org&apos;s agents directory</div>
          <div>Rate: 1-5 star rating system</div>
          <div>View Details: see the full prompt, triggers, emits, and tools</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Agent Definition Fields</h2>
        <div className="bg-card rounded-md p-3">
          <div className="space-y-2 text-xs text-foreground/60">
            <div><code className="text-foreground/70">id</code> - unique identifier (used in $ref)</div>
            <div><code className="text-foreground/70">name</code> - display name</div>
            <div><code className="text-foreground/70">description</code> - what the agent does</div>
            <div><code className="text-foreground/70">role</code> - freeform role label (e.g. researcher, writer, reviewer)</div>
            <div><code className="text-foreground/70">version</code> - semantic version</div>
            <div><code className="text-foreground/70">spec</code> - path to external .md spec file with instructions</div>
            <div><code className="text-foreground/70">prompt</code> - inline instructions (used if no spec file)</div>
            <div><code className="text-foreground/70">triggers</code> - events that start this agent (use hyphens: research-request)</div>
            <div><code className="text-foreground/70">emits</code> - event produced on completion (use hyphens: research-complete)</div>
            <div><code className="text-foreground/70">model</code> - LLM model override (e.g. claude-sonnet-4-6)</div>
            <div><code className="text-foreground/70">tools</code> - tool list override</div>
            <div><code className="text-foreground/70">agent_profile</code> - profile ID defining LLM model and tools config</div>
            <div><code className="text-foreground/70">session_prefix</code> - prefix for the PTY session name</div>
            <div><code className="text-foreground/70">monitor</code> - enable watchdog monitor session (boolean)</div>
            <div><code className="text-foreground/70">monitor_interval</code> - watchdog check interval in seconds</div>
            <div><code className="text-foreground/70">timeout</code> - max execution time in seconds (0 = no timeout)</div>
            <div><code className="text-foreground/70">retry</code> - retry config (max_retries, backoff: fixed|exponential|linear, initial_delay, max_delay, backoff_multiplier)</div>
            <div><code className="text-foreground/70">on_error</code> - agent ID to route to on failure</div>
            <div><code className="text-foreground/70">on_timeout</code> - agent ID to route to on timeout</div>
            <div><code className="text-foreground/70">wait_for_events</code> - fan-in config: wait for multiple events (all|any|quorum) before starting</div>
            <div><code className="text-foreground/70">context</code> - workspace path and read_first files</div>
            <div><code className="text-foreground/70">authorities</code> - what the agent can do vs needs approval for</div>
            <div><code className="text-foreground/70">artifacts</code> - artifact declarations (produces/consumes)</div>
            <div><code className="text-foreground/70">tags</code> - searchable tags for marketplace</div>
            <div><code className="text-foreground/70">category</code> - marketplace category (development, research, content, etc.)</div>
            <div><code className="text-foreground/70">author</code> - who created the agent</div>
          </div>
        </div>
      </section>
      </div>
    </div>
  );
}
