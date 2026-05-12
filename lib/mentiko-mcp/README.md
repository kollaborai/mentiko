# @kollaborai/mentiko-mcp

Mentiko MCP is the stdio Model Context Protocol server for the Mentiko
platform. It lets MCP clients inspect and operate a running Mentiko instance:
chains, agents, tasks, decisions, schedules, templates, files, terminal
sessions, notifications, docs, and current app context.

This package is a client bridge. It does not start Mentiko by itself. Run the
Mentiko web app first, then point the MCP server at that instance with the
environment variables below.

## Install

Run it directly:

```bash
npx @kollaborai/mentiko-mcp@latest
```

Or install it:

```bash
npm install @kollaborai/mentiko-mcp
```

The package requires Node.js 20 or newer.

## Runtime Environment

Mentiko uses two auth channels:

- `MENTIKO_SESSION_TOKEN`: required for data operations against
  `/api/mentiko-mcp/ops/*`.
- `MENTIKO_SESSION_ID`: required for session-scoped UI effects and token
  refresh.
- `MENTIKO_WEB_URL`: Mentiko web URL. Defaults to `http://127.0.0.1:3000`.
- `MENTIKO_INBOX_KEY`: required for UI effects, notifications, confirmation
  prompts, and browser dispatch/reply flows.
- `KOLLABOR_ENGINE_URL`: optional token-refresh endpoint. Defaults to
  `http://127.0.0.1:7433`.
- `MENTIKO_MCP_TOOL_SCOPE`: optional. Set to `bar` to expose only the tool set
  used by the Mentiko floating bar.

The normal Mentiko runtime registers this MCP server and injects the right
session values automatically. Manual configuration is for advanced MCP clients
that can provide the same values.

## Claude Desktop

Edit:

```text
~/Library/Application Support/Claude/claude_desktop_config.json
```

Add a server entry:

```json
{
  "mcpServers": {
    "mentiko": {
      "command": "npx",
      "args": ["-y", "@kollaborai/mentiko-mcp@latest"],
      "env": {
        "MENTIKO_WEB_URL": "http://127.0.0.1:3000",
        "MENTIKO_SESSION_ID": "your-session-id",
        "MENTIKO_SESSION_TOKEN": "your-session-token",
        "MENTIKO_INBOX_KEY": "your-inbox-key"
      }
    }
  }
}
```

Restart Claude Desktop after saving the file.

## Claude Code

Register the server with env injected by `env`:

```bash
claude mcp add mentiko -- env \
  MENTIKO_WEB_URL=http://127.0.0.1:3000 \
  MENTIKO_SESSION_ID=your-session-id \
  MENTIKO_SESSION_TOKEN=your-session-token \
  MENTIKO_INBOX_KEY=your-inbox-key \
  npx -y @kollaborai/mentiko-mcp@latest
```

## Local Development

From this directory:

```bash
npm install
npm run typecheck
npm run build
node dist/server.js
```

The server should print a ready line to stderr and then wait for MCP stdio
messages.

## Release

Publish manually after npm org access is confirmed:

```bash
scripts/publish-mentiko-mcp.sh 0.1.0
```

The GitHub workflow publishes tags named `mentiko-mcp-v*` with the `NPM_TOKEN`
repository secret.

## License

Apache-2.0. See `LICENSE`.
