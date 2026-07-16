"use client";

import { PageBanner } from "@/components/ui/page-banner";
import { MonitorFilled, LinkFilled, RouteSquareFilled } from "@aliimam/icons";

const CodeBlock = ({ children }: { children: string }) => (
  <pre className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto mb-4">
    {children}
  </pre>
);

export default function WorkspacesDocPage() {
  return (
    <div>
      <PageBanner
        title="Workspaces"
        subtitle="Execution environments for chain runs. Configure local paths, SSH remotes, or Docker containers with isolated settings."
        icon={MonitorFilled}
        sectionColor="#f59e0b"
        actions={[
          { label: "Workspaces", href: "/workspaces", icon: MonitorFilled, iconColor: "#f59e0b" },
          { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
          { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
        ]}
      />
      <div className="px-6 pb-6 max-w-3xl">

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Workspace Types</h2>
        <div className="bg-card rounded-md p-3 space-y-2 text-xs text-foreground/60 mb-3">
          <div><code className="text-foreground/70">local</code> - execute on the current machine</div>
          <div><code className="text-foreground/70">ssh</code> - execute on a remote server via SSH</div>
          <div><code className="text-foreground/70">docker</code> - execute inside a Docker container</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Workspace Configuration</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Each workspace defines execution context and limits:
        </p>
        <CodeBlock>{`{
  "id": "workspace_123",
  "name": "Production Server",
  "path": "/app/chains",
  "execution": {
    "type": "ssh",
    "ssh": {
      "host": "prod.example.com",
      "user": "deploy",
      "path": "/app/chains",
      "port": 22,
      "key": "~/.ssh/id_ed25519"
    }
  },
  "model": {
    "cli": "claude",
    "model": "sonnet"
  },
  "max_agents": 10,
  "max_rounds": 50,
  "default_branch": "main",
  "default_agent_profile": "codex-default",
  "auto_run": "enabled",
  "auto_approve_decisions": false
}`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Auto-Run Setting</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Control whether chains execute automatically when linked tasks complete:
        </p>
        <div className="bg-card rounded-md p-3 space-y-1 text-xs text-foreground/60">
          <div><code className="text-foreground/70">enabled</code> - run immediately on task close</div>
          <div><code className="text-foreground/70">disabled</code> - never auto-run, manual only</div>
          <div><code className="text-foreground/70">inherit</code> - use organization default</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Decision Auto-Approval</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Set <code className="text-foreground/70">auto_approve_decisions</code> to <code className="text-foreground/70">true</code> only when this workspace should proceed without a human decision click.
          Mentiko then selects the decision&apos;s explicit recommendation, generates that option&apos;s plan, and creates the plan&apos;s tasks.
        </p>
        <p className="text-xs text-foreground/60 leading-relaxed">
          The default is <code className="text-foreground/70">false</code>. A missing or invalid recommendation stays paused; Mentiko never guesses a first option.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Task Provider Integration</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Workspaces can connect to task providers through get, set, and ping
          routes. Task/run linking is handled by task and run metadata flows.
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div>Configured in workspace settings via <code className="text-foreground/70">/api/workspaces/{'{id}'}/task-provider</code></div>
          <div>Stores connection timestamp and status</div>
          <div>Supports ping checks for configured providers</div>
          <div>Skips if the provider is unavailable (graceful fallback)</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Workspace-Scoped Data</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          When a workspace is selected, the UI filters to show only relevant data:
        </p>
        <div className="bg-card rounded-md p-3 space-y-1 text-xs text-foreground/60">
          <div>Runs - only executions in this workspace</div>
          <div>Tasks - filtered by workspaceId match</div>
          <div>Conversations - agent sessions in this workspace</div>
          <div>Schedules - workspace-triggered schedules only</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Environment Variables</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Define environment variables for agent execution. These are sourced
          before each agent launch and never appear in output logs.
        </p>
        <CodeBlock>{`{
  "env": {
    "API_KEY": "secret-value",
    "DEPLOY_ENV": "production",
    "LOG_LEVEL": "info"
  }
}`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Default Workspace</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Workspaces are stored in <code className="text-foreground/70 bg-muted px-1 rounded">workspaces.json</code>.
          The UI auto-selects the first accessible workspace when one exists, but
          there is no guaranteed hardcoded local workspace.
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div>Accessible workspaces are filtered by membership</div>
          <div>Local workspaces validate an existing writable path on create</div>
          <div>Configurable like any other workspace</div>
        </div>
      </section>
      </div>
    </div>
  );
}
