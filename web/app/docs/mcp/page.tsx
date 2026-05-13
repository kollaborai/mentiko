"use client";

import { PageBanner } from "@/components/ui/page-banner";
import { CloudConnectionFilled, LinkFilled, RouteSquareFilled } from "@aliimam/icons";

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
        ]}
      />
      <div className="px-6 pb-6 max-w-3xl">

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Overview</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          <code className="font-mono bg-muted px-1 rounded">@mentiko/mentiko-mcp</code> is a
          stdio MCP server that exposes Mentiko to any MCP-compatible client.
          It is a client bridge - Mentiko must already be running. The server
          communicates with the Mentiko web API using session credentials you
          supply as environment variables.
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

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Environment Variables</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          The Mentiko runtime injects these automatically when the MCP server is
          registered through the app. For manual MCP clients, set them yourself:
        </p>
        <CodeBlock>{`MENTIKO_WEB_URL        # Mentiko web URL. Default: http://127.0.0.1:3000
MENTIKO_SESSION_TOKEN  # required - data operations via /api/mentiko-mcp/ops/*
MENTIKO_SESSION_ID     # required - session-scoped UI effects and token refresh
MENTIKO_INBOX_KEY      # required - UI effects, notifications, confirmations
KOLLABOR_ENGINE_URL    # optional - token-refresh endpoint. Default: http://127.0.0.1:7433
MENTIKO_MCP_TOOL_SCOPE # optional - set to "bar" to expose only floating bar tools`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Claude Desktop</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          Edit{" "}
          <code className="font-mono bg-muted px-1 rounded">
            ~/Library/Application Support/Claude/claude_desktop_config.json
          </code>{" "}
          and add:
        </p>
        <CodeBlock>{`{
  "mcpServers": {
    "mentiko": {
      "command": "npx",
      "args": ["-y", "@mentiko/mentiko-mcp@latest"],
      "env": {
        "MENTIKO_WEB_URL": "http://127.0.0.1:3000",
        "MENTIKO_SESSION_ID": "your-session-id",
        "MENTIKO_SESSION_TOKEN": "your-session-token",
        "MENTIKO_INBOX_KEY": "your-inbox-key"
      }
    }
  }
}`}</CodeBlock>
        <p className="text-xs text-foreground/60 leading-relaxed">
          Restart Claude Desktop after saving.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Claude Code</h2>
        <CodeBlock>{`claude mcp add mentiko -- env \\
  MENTIKO_WEB_URL=http://127.0.0.1:3000 \\
  MENTIKO_SESSION_ID=your-session-id \\
  MENTIKO_SESSION_TOKEN=your-session-token \\
  MENTIKO_INBOX_KEY=your-inbox-key \\
  npx -y @mentiko/mentiko-mcp@latest`}</CodeBlock>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-medium mb-2">Tool Scope</h2>
        <p className="text-xs text-foreground/60 leading-relaxed mb-3">
          By default the server exposes the full tool set: chains, agents,
          tasks, decisions, schedules, templates, files, terminal sessions,
          notifications, docs, and current app context.
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
npm run build
node dist/server.js`}</CodeBlock>
        <p className="text-xs text-foreground/60 leading-relaxed">
          The server prints a ready line to stderr and then waits for MCP stdio messages.
        </p>
      </section>

      </div>
    </div>
  );
}
