"use client";

import Link from "next/link";
import { PageBanner } from "@/components/ui/page-banner";
import { DocumentTextFilled, LinkFilled, BotMessageSquare, CategoryFilled } from "@aliimam/icons";

const CodeBlock = ({ children }: { children: string }) => (
  <pre className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto mb-4">
    {children}
  </pre>
);

export default function GettingStartedPage() {
  return (
    <div>
      <PageBanner
        title="Getting Started"
        subtitle="Install mentiko, create your first chain, and run it in under 5 minutes."
        icon={DocumentTextFilled}
        sectionColor="#f59e0b"
        actions={[
          { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
          { label: "Agents", href: "/agents", icon: BotMessageSquare, iconColor: "#b07ee8" },
          { label: "Templates", href: "/marketplace/templates", icon: CategoryFilled, iconColor: "#5cb88a" },
        ]}
      />
      <div className="px-6 pb-6 max-w-3xl">

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Prerequisites</h2>
        <ul className="text-xs text-foreground/60 leading-relaxed space-y-1">
          <li>Node.js 20+ and npm</li>
          <li>pty-manager (bundled at bin/p, no external dependency needed)</li>
          <li>A CLI agent: Claude Code, Codex, Aider, or Kollabor</li>
          <li>Git</li>
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Installation</h2>
        <CodeBlock>{`git clone https://github.com/kollaborai/mentiko.git
cd mentiko
cd web && npm install
npm run dev`}</CodeBlock>
        <p className="text-xs text-foreground/60 leading-relaxed">
          The web UI starts at <code className="text-foreground/70 bg-muted px-1 rounded">localhost:3200</code>.
          The CLI is at <code className="text-foreground/70 bg-muted px-1 rounded">./bin/mentiko</code>.
        </p>
        <p className="mt-2 text-xs text-foreground/60 leading-relaxed">
          On a fresh install, choose <span className="text-foreground/70">Sign up</span> to create the
          first local account. The first user becomes the workspace owner and
          lands on the dashboard with the setup wizard open. After that, use <span className="text-foreground/70">Sign in</span> with the same account.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Create Your First Chain</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          A chain is a JSON file that defines a pipeline of agents connected by events.
          Create a file at <code className="text-foreground/70 bg-muted px-1 rounded">~/.mentiko/namespaces/default/chains/my-first-chain/chain.json</code>:
        </p>
        <CodeBlock>{`{
  "name": "my-first-chain",
  "description": "A simple two-agent research chain",
  "version": "1.0.0",
  "default_agent_profile": "codex-default",
  "config": {
    "monitor": true,
    "max_rounds": 50
  },
  "agents": [
    {
      "id": "researcher",
      "name": "Researcher",
      "role": "researcher",
      "prompt": "Research the topic and produce findings. {TASK}",
      "triggers": ["manual-start"],
      "emits": "research_complete"
    },
    {
      "id": "writer",
      "name": "Writer",
      "role": "writer",
      "prompt": "Write a summary based on the research findings. {TASK}",
      "triggers": ["research_complete"],
      "emits": "chain_complete"
    }
  ]
}`}</CodeBlock>
        <p className="text-xs text-foreground/60 leading-relaxed">
          The researcher starts on <code className="text-foreground/70 bg-muted px-1 rounded">manual-start</code>,
          emits <code className="text-foreground/70 bg-muted px-1 rounded">research_complete</code>,
          which triggers the writer. Events flow through files in the active project&apos;s events directory.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Run It</h2>
        <CodeBlock>{`./bin/mentiko run ~/.mentiko/namespaces/default/chains/my-first-chain/chain.json`}</CodeBlock>
        <p className="text-xs text-foreground/60 leading-relaxed">
          This launches each agent in its own pty session via pty-manager. The chain runner monitors events
          and triggers agents as their conditions are met.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">View in the Web UI</h2>
        <p className="text-xs text-foreground/60 leading-relaxed">
          Navigate to <code className="text-foreground/70 bg-muted px-1 rounded">localhost:3200</code> to
          see your chains, agents, runs, and conversations. The dashboard shows active
          sessions, and you can steer agents directly from the conversations page.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Next Steps</h2>
        <div className="space-y-2">
          <Link href="/docs/chains" className="block bg-card hover:bg-muted rounded-md p-3 transition-colors">
            <p className="text-xs font-medium">Chains</p>
            <p className="text-[11px] text-muted-foreground">Deep dive into chain format, events, and configuration</p>
          </Link>
          <Link href="/docs/agents" className="block bg-card hover:bg-muted rounded-md p-3 transition-colors">
            <p className="text-xs font-medium">Agents</p>
            <p className="text-[11px] text-muted-foreground">Standalone agents, $ref references, and the marketplace</p>
          </Link>
          <Link href="/docs/templates" className="block bg-card hover:bg-muted rounded-md p-3 transition-colors">
            <p className="text-xs font-medium">Templates</p>
            <p className="text-[11px] text-muted-foreground">Reusable chain blueprints for common workflows</p>
          </Link>
        </div>
      </section>
      </div>
    </div>
  );
}
