"use client";

import { PageBanner } from "@/components/ui/page-banner";
import { LinkFilled, BotMessageSquare, RouteSquareFilled, SendFilled } from "@aliimam/icons";

const CodeBlock = ({ children }: { children: string }) => (
  <pre className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto mb-4">
    {children}
  </pre>
);

export default function ChainsDocPage() {
  return (
    <div>
      <PageBanner
        title="Chains"
        subtitle="JSON pipelines of agents connected by events. Each agent listens for trigger events and emits new events when done."
        icon={LinkFilled}
        sectionColor="#f59e0b"
        actions={[
          { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
          { label: "Agents", href: "/agents", icon: BotMessageSquare, iconColor: "#b07ee8" },
          { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
          { label: "Events", href: "/events", icon: SendFilled, iconColor: "#b07ee8" },
        ]}
      />
      <div className="px-6 pb-6 max-w-3xl">

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Chain Format</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Chains are org-scoped. In the default org they live at <code className="text-foreground/70 bg-muted px-1 rounded">~/.mentiko/namespaces/{"{namespace_id}"}/chains/{"{chain_id}"}/chain.json</code>;
          non-default orgs use <code className="text-foreground/70 bg-muted px-1 rounded">orgs/{"{org_id}"}/chains/{"{chain_id}"}/chain.json</code> under the namespace.
          Here&apos;s the core structure:
        </p>
        <CodeBlock>{`{
  "name": "my-chain",
  "description": "What this chain does",
  "version": "1.0.0",
  "config": {
    "monitor": true,
    "max_rounds": 3,
    "on_complete": "stop"
  },
  "agents": [
    {
      "id": "agent-1",
      "name": "First Agent",
      "role": "researcher",
      "agent_profile": "researcher-profile",
      "prompt": "Your task instructions. {TASK}",
      "triggers": ["chain-start"],
      "emits": "step_1_done"
    },
    {
      "id": "agent-2",
      "name": "Second Agent",
      "role": "writer",
      "agent_profile": "writer-profile",
      "prompt": "Continue from previous step. {TASK}",
      "triggers": ["step_1_done"],
      "emits": "chain-complete"
    }
  ]
}`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Agent Entries</h2>
        <div className="bg-card rounded-md p-3 mb-3">
          <div className="space-y-2 text-xs text-foreground/60">
            <div><code className="text-foreground/70">id</code> - unique identifier within the chain</div>
            <div><code className="text-foreground/70">name</code> - display name</div>
            <div><code className="text-foreground/70">role</code> - agent role (researcher, writer, reviewer, etc.)</div>
            <div><code className="text-foreground/70">agent_profile</code> - optional agent profile ID for LLM/tools config</div>
            <div><code className="text-foreground/70">prompt</code> - instructions sent to the agent (or <code className="text-foreground/70">spec</code> for external .md file)</div>
            <div><code className="text-foreground/70">triggers</code> - array of event names that start this agent</div>
            <div><code className="text-foreground/70">emits</code> - event name produced when agent completes</div>
            <div><code className="text-foreground/70">timeout</code> - optional timeout in seconds (0 = no timeout)</div>
            <div><code className="text-foreground/70">retry</code> - optional retry config (max_retries, backoff: fixed|exponential|linear, initial_delay, max_delay, backoff_multiplier)</div>
            <div><code className="text-foreground/70">on_error</code> - optional agent ID to route to on failure</div>
            <div><code className="text-foreground/70">on_timeout</code> - optional agent ID to route to on timeout</div>
            <div><code className="text-foreground/70">wait_for_events</code> - optional fan-in object: events, wait_for (all|any|quorum), quorum, timeout</div>
            <div><code className="text-foreground/70">artifacts</code> - optional artifact declarations (produces/consumes)</div>
          </div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Event Flow</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Events are project-scoped files written under the resolved project root, for example <code className="text-foreground/70 bg-muted px-1 rounded">~/.mentiko/namespaces/{"{id}"}/events/</code> for the default project.
          When an agent completes, it writes an event file. The event trigger monitors
          this directory and launches agents whose triggers match.
        </p>
        <CodeBlock>{`chain-start
  └─> Agent A (triggers: ["chain-start"])
        emits: "research_done"
          └─> Agent B (triggers: ["research_done"])
                emits: "review_done"
                  └─> Agent C (triggers: ["review_done"])
                        emits: "chain-complete"`}</CodeBlock>
        <p className="text-xs text-foreground/60 leading-relaxed">
          Multiple agents can trigger on the same event for parallel execution.
          Multiple entries in <code className="text-foreground/70">triggers</code> are treated as any-of matches; use
          <code className="text-foreground/70"> wait_for_events</code> or branch fan-in when an agent must wait for several events.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Agent Profiles and Gateways</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Agent profiles determine the LLM model and tools available to an agent.
          Gateways inject environment variables for provider-specific configuration (API keys, endpoints).
        </p>
        <CodeBlock>{`// set default profile for all agents in chain
"default_agent_profile": "my-profile",

// override for specific agent
"agents": [
  {
    "id": "agent-1",
    "name": "Researcher",
    "agent_profile": "research-profile"
  }
],

// gateways inject provider-specific env vars
"gateways": {
  "anthropic": {
    "env": {
      "ANTHROPIC_API_KEY": "sk-..."
    }
  },
  "github": {
    "env": {
      "GITHUB_TOKEN": "ghp_..."
    }
  }
}`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Branches and Routing</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Branches define conditional routing between agents. Route events to specific agents,
          fan-out to parallel agents, or conditionally route based on event patterns.
        </p>
        <CodeBlock>{`// simple routing: one event -> one agent
"branches": {
  "research_done": "reviewer"
},

// fan-out: one event -> multiple agents in parallel
"branches": {
  "analysis_done": ["agent-a", "agent-b", "agent-c"]
},

// complex routing with conditions and fan-in
"branches": {
  "analysis_complete": {
    "conditions": [
      { "if": "high_confidence", "then": "approve" },
      { "if": "low_confidence", "then": "escalate" }
    ],
    "default": "review",
    "fan_out": ["parallel-1", "parallel-2"],
    "fan_in": "aggregator",
    "wait_for": "all"
  }
}`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Spec vs Prompt</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Each agent can use either a <code className="text-foreground/70 bg-muted px-1 rounded">spec</code> file (external .md) or inline <code className="text-foreground/70 bg-muted px-1 rounded">prompt</code> text.
          Spec files are better for complex, multi-line instructions. Prompts are cleaner for simple tasks.
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div><span className="text-foreground/70">spec</span> - path to markdown file with detailed instructions (preferred for complex tasks)</div>
          <div><span className="text-foreground/70">prompt</span> - inline text instructions (used if no spec file)</div>
          <div>Both support placeholders like {"{TASK}"}, {"{GOAL}"}, {"{CHAIN_NAME}"}</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">$ref Syntax</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Instead of defining agents inline, reference standalone agents from the org registry or marketplace cache:
        </p>
        <CodeBlock>{`"agents": [
  { "$ref": "researcher" },
  { "$ref": "code-reviewer", "prompt": "Review the research output" },
  {
    "id": "inline-agent",
    "name": "Inline",
    "triggers": ["review_complete"],
    "emits": "chain-complete"
  }
]`}</CodeBlock>
        <p className="text-xs text-foreground/60 leading-relaxed">
          You can mix $ref and inline agents. Web APIs resolve refs from org agents first, then marketplace agents;
          the shell runner resolves refs from the configured <code className="text-foreground/70">AGENTS_DIR</code>. Override fields are merged on top
          of the loaded agent definition.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Runtime Placeholders</h2>
        <div className="bg-card rounded-md p-3">
          <div className="space-y-2 text-xs text-foreground/60">
            <div><code className="text-foreground/70">{"{TASK}"}</code> - the task description passed at runtime</div>
            <div><code className="text-foreground/70">{"{GOAL}"}</code> - the high-level goal for the chain</div>
            <div><code className="text-foreground/70">{"{CHAIN_NAME}"}</code> - name of the currently running chain</div>
            <div><code className="text-foreground/70">{"{TASK_CONTEXT}"}</code> - context from an assigned task</div>
          </div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Chain Config</h2>
        <div className="bg-card rounded-md p-3">
          <div className="space-y-2 text-xs text-foreground/60">
            <div><code className="text-foreground/70">monitor</code> - enable session monitoring. Default: true</div>
            <div><code className="text-foreground/70">max_rounds</code> - maximum execution rounds before timeout. Default: 3</div>
            <div><code className="text-foreground/70">on_complete</code> - action when chain finishes (stop|notify|webhook|chain:&lt;name&gt;). Default: stop</div>
            <div><code className="text-foreground/70">webhook_url</code> - URL to POST when chain completes (if on_complete=webhook)</div>
            <div><code className="text-foreground/70">schedule</code> - cron expression for scheduled execution</div>
            <div><code className="text-foreground/70">timezone</code> - timezone for schedule. Default: UTC</div>
            <div><code className="text-foreground/70">slack</code> - Slack webhook notifications config</div>
            <div><code className="text-foreground/70">email</code> - email notification config</div>
            <div><code className="text-foreground/70">integrations</code> - GitHub, Teams, etc. integration config</div>
            <div><code className="text-foreground/70">workspace</code> - remote workspace config (type: local|ssh|docker)</div>
          </div>
        </div>
      </section>
      </div>
    </div>
  );
}
