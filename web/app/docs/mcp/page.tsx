"use client";

import { PageBanner } from "@/components/ui/page-banner";
import { CloudConnectionFilled, LinkFilled, RouteSquareFilled, Shield } from "@aliimam/icons";

const CodeBlock = ({ children }: { children: string }) => (
  <pre className="bg-muted rounded-md p-3 font-mono text-[11px] text-foreground/70 whitespace-pre overflow-x-auto mb-4">
    {children}
  </pre>
);

export default function McpDocPage() {
  return (
    <div>
      <PageBanner
        title="MCP"
        subtitle="Model Context Protocol integration. Connect Claude Desktop, Claude Code, or any MCP client to a running Mentiko instance to inspect and operate chains, agents, tasks, decisions, and more."
        icon={CloudConnectionFilled}
        sectionColor="#5cb88a"
        actions={[
          { label: "Chains", href: "/chains", icon: LinkFilled, iconColor: "#b07ee8" },
          { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
          { label: "MCP Connections", href: "/settings/security", icon: Shield, iconColor: "#5cb88a" },
        ]}
      />
      <div className="px-6 pb-6 max-w-3xl">

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Overview</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          <code className="font-mono bg-muted px-1 rounded">@mentiko/mentiko-mcp</code> is a
          stdio MCP server that exposes Mentiko to any MCP-compatible client.
          It is a client bridge — Mentiko must already be running. The server
          calls the Mentiko web API under a short-lived session token.
        </p>
        <p className="text-xs text-foreground/60 leading-relaxed">
          You no longer hand-mint or paste tokens. The bridge authenticates through a
          browser-approved <strong className="text-foreground/80">device flow</strong> (the
          <code className="font-mono bg-muted px-1 rounded">reconnect</code> tool), stores a long-lived,
          revocable refresh token in a sidecar file, and silently swaps in fresh access tokens
          as they expire. See <a href="#connecting" className="text-foreground/80 underline hover:text-foreground">Connecting</a> below.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Install</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Run directly without installing:
        </p>
        <CodeBlock>{`npx @mentiko/mentiko-mcp@latest`}</CodeBlock>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">Or install globally:</p>
        <CodeBlock>{`npm install @mentiko/mentiko-mcp`}</CodeBlock>
        <p className="text-xs text-foreground/60 leading-relaxed">
          Requires Node.js 20 or newer.
        </p>
      </section>

      <section className="mb-6" id="connecting">
        <h2 className="text-sm font-medium mb-2">Connecting</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          When you register the server through the Mentiko app, credentials are wired for you.
          For a standalone client (e.g. Claude Code), the config only needs the web URL and a
          session id — then you authenticate once with the <code className="font-mono bg-muted px-1 rounded">reconnect</code> tool:
        </p>
        <div className="bg-card rounded-md p-3 mb-3 space-y-2">
          <p className="text-xs text-foreground/60 leading-relaxed">
            <strong className="text-foreground/80">1.</strong> Run the <code className="font-mono bg-muted px-1 rounded">reconnect</code> tool
            (alias <code className="font-mono bg-muted px-1 rounded">authenticate</code>). The bridge starts a device flow and returns a sign-in link.
          </p>
          <p className="text-xs text-foreground/60 leading-relaxed">
            <strong className="text-foreground/80">2.</strong> Open the link — <code className="font-mono bg-muted px-1 rounded">{"{web-url}"}/mcp-auth?code={"{user_code}"}</code> —
            while signed in to Mentiko in your browser. Confirm the client and the granted scopes, then approve.
          </p>
          <p className="text-xs text-foreground/60 leading-relaxed">
            <strong className="text-foreground/80">3.</strong> The bridge picks up a revocable <strong className="text-foreground/80">90-day refresh token</strong>,
            writes it to the sidecar file, and resumes — no restart, no config editing.
          </p>
        </div>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          After that, daily access-token expiry is invisible: on a <code className="font-mono bg-muted px-1 rounded">401</code> the
          bridge silently exchanges the refresh token for a fresh access token via
          <code className="font-mono bg-muted px-1 rounded">POST /api/mentiko-mcp/auth/token</code>. If it has no usable refresh token,
          an expired session returns a friendly message with a live sign-in link instead of a raw error.
        </p>
        <p className="text-xs text-foreground/60 leading-relaxed">
          Revoke a client any time from <a href="/settings/security" className="text-foreground/80 underline hover:text-foreground">Settings → Security → MCP Connections</a>.
          Revoking kills that client&apos;s ability to refresh; it must run <code className="font-mono bg-muted px-1 rounded">reconnect</code> again.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Sidecar session file</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          The credential lives in a file the bridge reads at runtime rather than being baked
          into the static MCP config — so it survives a bridge restart and doesn&apos;t need to be
          re-pasted into <code className="font-mono bg-muted px-1 rounded">~/.claude.json</code>:
        </p>
        <CodeBlock>{`~/.mentiko/mcp/session.json   (mode 0600)
  { "refresh_token": "...", "session_token": "...", "updatedAt": "..." }`}</CodeBlock>
        <p className="text-xs text-foreground/60 leading-relaxed">
          Access-token precedence: <strong className="text-foreground/80">sidecar file → <code className="font-mono bg-muted px-1 rounded">MENTIKO_SESSION_TOKEN</code> env → engine refresh</strong>.
          After one reconnect the sidecar is the source of truth.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Environment Variables</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          The Mentiko runtime injects these automatically when the MCP server is
          registered through the app. For manual MCP clients, set them yourself:
        </p>
        <CodeBlock>{`MENTIKO_WEB_URL        # required - Mentiko web URL. Default: http://127.0.0.1:3200
MENTIKO_SESSION_ID     # session-scoped UI effects and token-refresh identity
MENTIKO_SESSION_TOKEN  # optional - bootstrap access token; superseded by the
                       #   sidecar session file once you reconnect
MENTIKO_INBOX_KEY      # optional - UI effects (toasts, confirmations) for the in-app bar
KOLLABOR_ENGINE_URL    # optional - engine token-refresh endpoint (engine-spawned sessions)
MENTIKO_MCP_TOOL_SCOPE # optional - set to "bar" to expose only floating bar tools`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Claude Desktop</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Edit{" "}
          <code className="font-mono bg-muted px-1 rounded">
            ~/Library/Application Support/Claude/claude_desktop_config.json
          </code>{" "}
          and add the server, then run <code className="font-mono bg-muted px-1 rounded">reconnect</code> once to sign in:
        </p>
        <CodeBlock>{`{
  "mcpServers": {
    "mentiko": {
      "command": "npx",
      "args": ["-y", "@mentiko/mentiko-mcp@latest"],
      "env": {
        "MENTIKO_WEB_URL": "http://127.0.0.1:3200",
        "MENTIKO_SESSION_ID": "your-session-id"
      }
    }
  }
}`}</CodeBlock>
        <p className="text-xs text-foreground/60 leading-relaxed">
          Restart Claude Desktop after saving, then run the <code className="font-mono bg-muted px-1 rounded">reconnect</code> tool.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Claude Code</h2>
        <CodeBlock>{`claude mcp add mentiko -- env \\
  MENTIKO_WEB_URL=http://127.0.0.1:3200 \\
  MENTIKO_SESSION_ID=your-session-id \\
  npx -y @mentiko/mentiko-mcp@latest`}</CodeBlock>
        <p className="text-xs text-foreground/60 leading-relaxed">
          Then run the <code className="font-mono bg-muted px-1 rounded">reconnect</code> tool and approve the link. No token wiring required.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Tool Scope</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          By default the server exposes the full tool set: chains, agents,
          tasks, decisions, schedules, templates, files, terminal sessions,
          notifications, docs, and current app context — plus the <code className="font-mono bg-muted px-1 rounded">reconnect</code> auth tool.
        </p>
        <p className="text-xs text-foreground/60 leading-relaxed">
          Set{" "}
          <code className="font-mono bg-muted px-1 rounded">
            MENTIKO_MCP_TOOL_SCOPE=bar
          </code>{" "}
          to expose only the subset used by the Mentiko floating bar.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Local Development</h2>
        <CodeBlock>{`cd lib/mentiko-mcp
npm install
npm run typecheck
npm run build      # esbuild -> dist/server.js
node dist/server.js`}</CodeBlock>
        <p className="text-xs text-foreground/60 leading-relaxed">
          Dev runs the TypeScript directly via tsx; the build bundles to <code className="font-mono bg-muted px-1 rounded">dist/server.js</code>.
          The server prints a ready line to stderr and then waits for MCP stdio messages.
        </p>
      </section>

      </div>
    </div>
  );
}
