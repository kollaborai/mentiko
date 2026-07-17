"use client";

import { BotMessageSquare, Data2Filled, GlobalFilled, Element2Filled, DocumentTextFilled } from "@aliimam/icons";
import { TerminalIcon } from "@/components/ui/terminal-icon";
import { PageBanner } from "@/components/ui/page-banner";

const layers = [
  {
    icon: GlobalFilled,
    name: "UI Layer",
    description: "user interfaces for chain management and monitoring",
    items: [
      { label: "next.js 16 web app", desc: "app router, react 19, typescript, tailwind 4" },
      { label: "cli", desc: "bin/mentiko - run, generate, validate, list chains" },
      { label: "rest api", desc: "/api/chains, /api/runs, /api/agents, /api/events" },
    ],
  },
  {
    icon: TerminalIcon,
    name: "Orchestration Layer",
    description: "typed execution, lifecycle, and background services",
    items: [
      { label: "runner-v2", desc: "typed direct, batch, graph, and routed chain execution" },
      { label: "chain-runner.sh", desc: "compatibility filename that immediately execs the typed direct runner" },
      { label: "agent-functions.sh", desc: "thin PTY transport and standalone/manual-monitor boundaries" },
      { label: "event-lifecycle.ts", desc: "strict event lookup, processed mutation, and scoped archival" },
      { label: "background-worker.ts", desc: "owns typed chain watcher and watchdog lifecycle" },
      { label: "runtime workers", desc: "runner-job-worker.js, pty-manager.mjs, chain-generator.mjs" },
    ],
  },
  {
    icon: BotMessageSquare,
    name: "Execution Layer",
    description: "ai agents running in isolated pty sessions",
    items: [
      { label: "claude code", desc: "anthropic claude via cli, tool use, file editing" },
      { label: "codex", desc: "OpenAI CLI tool with session paths" },
      { label: "kollab", desc: "custom agent framework" },
      { label: "glm", desc: "OpenAI-compatible CLI tool" },
      { label: "antigravity", desc: "OpenAI-compatible CLI tool" },
      { label: "opencode", desc: "OpenAI-compatible CLI tool" },
      { label: "aider", desc: "ai pair programming tool" },
    ],
  },
  {
    icon: Data2Filled,
    name: "Data Layer",
    description: "file-based storage scoped by namespace",
    items: [
      { label: "events/", desc: "canonical line-oriented events and trigger matching" },
      { label: "state/", desc: "runtime state, agent status, chain progress" },
      { label: "runs/", desc: "chain execution history, logs, outputs" },
      { label: "chains/", desc: "chain definitions, agent configs" },
    ],
  },
];

const techStack = [
  { name: "next.js 16", desc: "app router, server components" },
  { name: "react 19", desc: "latest hooks, concurrent rendering" },
  { name: "typescript 5", desc: "strict mode, full type safety" },
  { name: "tailwind 4", desc: "utility-first styling, dark mode" },
  { name: "@xyflow/react", desc: "visual chain builder with drag-drop" },
  { name: "zustand", desc: "lightweight state management" },
  { name: "theme provider", desc: "dark/light/system mode toggle" },
  { name: "ws", desc: "websocket for real-time run updates" },
];

const namespaceExample = `# directory structure (3-tier: namespace > org > project)
namespaces/acme-corp/
├── billing/              # namespace: plan, billing
├── settings/             # namespace: settings
├── orgs/
│   └── engineering/      # org root
│       ├── chains/       # org: chain definitions
│       ├── agents/       # org: agent definitions
│       ├── links/        # org: agent collaboration links
│       ├── emails/       # org: email routes (inbound/outbound)
│       ├── secrets/      # org: encrypted api keys
│       ├── profiles/     # org: agent-profiles and config-profiles
│       ├── templates/    # org: chain templates
│       ├── webhooks/     # org: webhook configs
│       └── projects/
│           └── {encoded-cwd}/  # project root
│               ├── runs/       # project: chain executions
│               ├── events/     # project: event log
│               ├── state/      # project: agent state
│               ├── decisions/  # project: decision records
│               └── schedules/  # project: scheduled runs

# "default" org collapses into namespace root (no orgs/default/ dir)
# "default" project collapses into org root
# local dev paths stay flat: namespaces/default/chains/`;

export default function ArchitectureDocsPage() {
  return (
    <div>
      <PageBanner
        title="Architecture"
        subtitle="The 4-layer system that powers mentiko."
        icon={DocumentTextFilled}
        sectionColor="#f59e0b"
      />
      <div className="max-w-3xl px-6 pb-6">

      <section className="mb-8">
        <h2 className="text-sm font-medium mb-3">System Overview</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-4">
          mentiko is built as 4 distinct layers. each layer has a single responsibility
          and communicates with adjacent layers through well-defined interfaces.
        </p>
        <div className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto">
ui → orchestration → execution → data
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-medium mb-4 flex items-center gap-2">
          <Element2Filled className="h-4 w-4 text-foreground/40" />
          Layers
        </h2>
        <div className="space-y-4">
          {layers.map((layer, i) => {
            const Icon = layer.icon;
            return (
              <div key={i} className="bg-card rounded-md p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="h-4 w-4 text-foreground/40" />
                  <h3 className="text-sm font-medium">{layer.name}</h3>
                </div>
                <p className="text-xs text-foreground/50 leading-relaxed mb-3">
                  {layer.description}
                </p>
                <div className="space-y-1.5">
                  {layer.items.map((item, j) => (
                    <div key={j} className="flex gap-3">
                      <span className="text-[11px] text-foreground/70 font-mono shrink-0">
                        {item.label}
                      </span>
                      <span className="text-[11px] text-foreground/50">
                        {item.desc}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-medium mb-3">Multi-Tenancy</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-4">
          all data is scoped by namespace. the NAMESPACE_ID environment variable (default: &quot;default&quot;)
          determines which namespace directory is used. this enables complete isolation between
          teams, projects, or customers.
        </p>
        <div className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto">
{namespaceExample}
        </div>
        <p className="text-xs text-foreground/50 leading-relaxed mt-3">
          namespace resolution: the CLI and typed run services resolve NAMESPACE_ID into the
          scoped runtime roots before any run, event, or PTY is created.
        </p>
      </section>

      <section>
        <h2 className="text-sm font-medium mb-3">Web Stack</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-4">
          the web ui is built with modern react technologies. no build step required for
          development, optimized production build via next.js.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {techStack.map((tech, i) => (
            <div key={i} className="bg-card rounded-md p-3">
              <span className="text-xs font-medium text-foreground">{tech.name}</span>
              <p className="text-[11px] text-foreground/50 mt-0.5">{tech.desc}</p>
            </div>
          ))}
        </div>
      </section>
      </div>
    </div>
  );
}
