"use client";

import { PageBanner } from "@/components/ui/page-banner";
import { Setting2Filled, LinkFilled, BotMessageSquare } from "@aliimam/icons";

const CodeBlock = ({ children }: { children: string }) => (
  <pre className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto mb-4">
    {children}
  </pre>
);

export default function ConfigProfilesDocPage() {
  return (
    <div>
      <PageBanner
        title="CLI Reference"
        subtitle="CLI commands, agent execution profiles, and environment variables for mentiko."
        icon={Setting2Filled}
        sectionColor="#f59e0b"
        actions={[
          { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
          { label: "Agents", href: "/agents", icon: BotMessageSquare, iconColor: "#b07ee8" },
        ]}
      />
      <div className="px-6 pb-6 max-w-3xl">

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">CLI Commands</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          The CLI entry point is <code className="text-foreground/70 bg-muted px-1 rounded">./bin/mentiko</code>.
        </p>
        <CodeBlock>{`mentiko run <chain.json> [--workspace <path>] [--task <id>] [--start <agent-id>] [--parallel agent1 agent2...] [--dry-run] [--debug]
mentiko generate "<prompt>" [--output <dir>] [--template <file>] [--json] [--raw]
mentiko launch <spec-file> [--monitor]
mentiko validate <chain.json> [--strict]
mentiko graph <chain.json>
mentiko peek <session-name> [lines]
mentiko send <session-name> "message"
mentiko kill <session-name>
mentiko kill-all
mentiko list
mentiko events [--unprocessed]
mentiko emit <event-name> <source>
mentiko init [directory]
mentiko monitor <session-name> "end state" [profile] [interval]
mentiko audit [summary|export-json|export-csv|query|archive|clear]
mentiko seed`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">PTY Manager</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Bundled at <code className="text-foreground/70 bg-muted px-1 rounded">./bin/p</code>. No external dependency needed.
          Manages isolated PTY sessions for agent execution.
        </p>
        <CodeBlock>{`./bin/p create <name> [command]   # create new pty session
./bin/p list                     # list active sessions
./bin/p send <name> "message"    # send input to session
./bin/p read <name>              # read session output
./bin/p destroy <name>           # terminate session`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Agent Execution Profiles</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Agent profiles own the CLI, model, args, env, logging, and auth behavior used by runs.
          They are org-scoped and stored at <code className="text-foreground/70 bg-muted px-1 rounded">{"~/.mentiko/namespaces/{id}/agent-profiles/{profile-id}.json"}</code>
          for the default org, or under <code className="text-foreground/70 bg-muted px-1 rounded">{"orgs/{orgId}/agent-profiles/"}</code> for non-default orgs.
        </p>
        <div className="bg-card rounded-md p-3 space-y-1 text-xs text-foreground/60 mb-3">
          <div><code className="text-foreground/70">cli</code> - executable such as claude, codex, kollab, opencode, or a custom binary</div>
          <div><code className="text-foreground/70">model</code> / <code className="text-foreground/70">relay_model</code> - model selection passed to the CLI or gateway</div>
          <div><code className="text-foreground/70">pipe_flag</code>, <code className="text-foreground/70">permission_flag</code>, <code className="text-foreground/70">extra_args</code> - execution flags</div>
          <div><code className="text-foreground/70">env</code> - environment values, including <code className="text-foreground/70">{"{secret:NAME}"}</code> references</div>
          <div><code className="text-foreground/70">isDefault</code> / <code className="text-foreground/70">isAdvisorDefault</code> - default profile selectors</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Profile Resolution Order</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          When a run chooses an agent profile, values resolve in this priority:
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1 mb-3">
          <div>1. Explicit profile selected for the run</div>
          <div>2. Chain <code className="text-foreground/70">default_agent_profile</code></div>
          <div>3. Workspace <code className="text-foreground/70">default_agent_profile</code></div>
          <div>4. Org default profile, then the first available profile</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Agent Profile Example</h2>
        <CodeBlock>{`{
  "id": "codex-default",
  "name": "Codex Default",
  "description": "Default Codex profile for agent runs",
  "isDefault": true,
  "isAdvisorDefault": false,
  "cli": "codex",
  "model": "gpt-5",
  "pipe_flag": "",
  "permission_flag": "",
  "extra_args": [],
  "env": {
    "OPENAI_API_KEY": "{secret:OPENAI_API_KEY}"
  },
  "createdAt": "2026-06-01T00:00:00.000Z",
  "updatedAt": "2026-06-01T00:00:00.000Z"
}`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Gateway Profile Example</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Route agents through a custom CLI or gateway by setting the profile&apos;s CLI fields. Env vars use{" "}
          <code className="text-foreground/70 bg-muted px-1 rounded">{"{secret:NAME}"}</code> refs
          for encrypted values.
        </p>
        <CodeBlock>{`{
  "id": "custom-gateway",
  "name": "Custom Gateway",
  "isDefault": false,
  "cli": "claude",
  "extra_args": ["--api", "custom-endpoint"],
  "env": {
    "ANTHROPIC_API_KEY": "{secret:anthropic-key}",
    "ANTHROPIC_BASE_URL": "https://custom-gateway.example.com"
  }
}`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Chain Integration</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Reference a default agent profile at chain level, then override per agent only when needed:
        </p>
        <CodeBlock>{`{
  "name": "my-chain",
  "default_agent_profile": "codex-default",
  "agents": [
    {
      "id": "agent-1",
      "agent_profile": "custom-gateway"
    }
  ]
}`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Profile API</h2>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1 mb-3">
          <div><code className="text-foreground/70">GET /api/agent-profiles</code> - list all profiles</div>
          <div><code className="text-foreground/70">POST /api/agent-profiles</code> - create new profile</div>
          <div><code className="text-foreground/70">{"GET /api/agent-profiles/[id]"}</code> - get single profile</div>
          <div><code className="text-foreground/70">{"PATCH /api/agent-profiles/[id]"}</code> - update profile</div>
          <div><code className="text-foreground/70">{"DELETE /api/agent-profiles/[id]"}</code> - delete profile</div>
          <div><code className="text-foreground/70">GET /api/agent-profiles/[id]/resolved-env</code> - resolve secret refs for a profile</div>
          <div><code className="text-foreground/70">POST /api/agent-profiles/[id]/test</code> - run a quick CLI version check</div>
          <div><code className="text-foreground/70">GET /api/agent-profiles/bundles</code> - list installable provider bundles</div>
          <div><code className="text-foreground/70">POST /api/agent-profiles/install-bundle</code> - install or sync a provider bundle</div>
          <div>Set defaults with <code className="text-foreground/70">PATCH /api/agent-profiles/[id]</code> using <code className="text-foreground/70">isDefault</code> or <code className="text-foreground/70">isAdvisorDefault</code>.</div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Environment Variables</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Key environment variables for the system:
        </p>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-2">
          <div>
            <p className="text-foreground/70 font-medium mb-1">Data paths</p>
            <div className="space-y-0.5 pl-2">
              <div><code className="text-foreground/70">MENTIKO_GLOBAL_ROOT</code> - data root (~/.mentiko)</div>
              <div><code className="text-foreground/70">MENTIKO_CODE_ROOT</code> - git checkout root</div>
              <div><code className="text-foreground/70">MENTIKO_NAMESPACE_ROOT</code> - resolved namespace dir</div>
              <div><code className="text-foreground/70">MENTIKO_ORG_ROOT</code> - resolved org dir</div>
              <div><code className="text-foreground/70">MENTIKO_PROJECT_ROOT</code> - resolved project data dir</div>
              <div><code className="text-foreground/70">NAMESPACE_ID</code> - namespace slug (default: &quot;default&quot;)</div>
              <div><code className="text-foreground/70">ORG_ID</code> - org slug (default: &quot;default&quot;)</div>
            </div>
          </div>
          <div>
            <p className="text-foreground/70 font-medium mb-1">Auth</p>
            <div className="space-y-0.5 pl-2">
              <div><code className="text-foreground/70">DATABASE_URL</code> - sqlite path (file:~/.mentiko/data/auth.db)</div>
              <div><code className="text-foreground/70">BETTER_AUTH_SECRET</code> - session signing key</div>
              <div><code className="text-foreground/70">BETTER_AUTH_URL</code> - base auth URL</div>
              <div><code className="text-foreground/70">ADMIN_EMAILS</code> - comma-separated admin email list</div>
            </div>
          </div>
          <div>
            <p className="text-foreground/70 font-medium mb-1">OAuth</p>
            <div className="space-y-0.5 pl-2">
              <div><code className="text-foreground/70">GITHUB_CLIENT_ID</code> / <code className="text-foreground/70">GITHUB_CLIENT_SECRET</code></div>
              <div><code className="text-foreground/70">GOOGLE_CLIENT_ID</code> / <code className="text-foreground/70">GOOGLE_CLIENT_SECRET</code></div>
              <div><code className="text-foreground/70">MICROSOFT_CLIENT_ID</code> / <code className="text-foreground/70">MICROSOFT_CLIENT_SECRET</code></div>
            </div>
          </div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Validation Rules</h2>
        <div className="bg-card rounded-md p-3 text-xs text-foreground/60 space-y-1">
          <div>Profile name: alphanumeric + dashes, max 64 chars</div>
          <div>Name: required, max 128 chars</div>
          <div>CLI: required</div>
          <div>Env keys: uppercase alphanumeric with underscores</div>
        </div>
      </section>
      </div>
    </div>
  );
}
