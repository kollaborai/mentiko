# MCP Integration

Local Model Context Protocol server integration.

## Overview

Mentiko exposes itself as a local MCP server, enabling AI assistants (like Claude Code) to interact with chains, agents, and runs.

## Setup

### 1. Start the MCP Server

The MCP server starts automatically when Mentiko runs. It's available at `stdio://mentiko`.

### 2. Configure Claude Code

**claude_desktop_config.json:**
```json
{
  "mcpServers": {
    "mentiko": {
      "command": "node",
      "args": [
        "/path/to/mentiko/server/mcp-server.js"
      ]
    }
  }
}
```

### 3. Restart Claude Code

Quit and restart Claude Code to load the MCP server.

## Available Tools

### Chain Management

**list_chains**
- List all chains in the current namespace
- Returns: chain IDs, names, descriptions

**get_chain**
- Get chain definition by ID
- Returns: full chain.json content

**run_chain**
- Execute a chain
- Parameters: chain_id, workspace_id, task
- Returns: run_id

### Run Management

**list_runs**
- List recent runs
- Parameters: limit, status
- Returns: run IDs, status, timestamps

**get_run**
- Get run details
- Parameters: run_id
- Returns: run metadata, agent status

**cancel_run**
- Cancel a running chain
- Parameters: run_id

### Agent Management

**list_agents**
- List all agents in namespace
- Returns: agent IDs, names, types

**get_agent**
- Get agent definition
- Parameters: agent_id
- Returns: agent.json content

### Task Management

**list_tasks**
- List tasks with dependencies
- Parameters: status, limit
- Returns: task tree with blocked_by relationships

**create_task**
- Create a new task
- Parameters: subject, description, priority
- Returns: task_id

**complete_task**
- Mark task as complete
- Parameters: task_id

## Authentication

MCP tools use session-based authentication:

1. **Initial connection:** No auth required for list operations
2. **Write operations:** Require active Mentiko session
3. **Session recovery:** Automatic via `reconnect` tool

## Session Recovery

When MCP session expires:

```javascript
// Call reconnect tool
reconnect()
```

**Flow:**
1. Generates device authorization link
2. User approves in browser at `/mcp-auth`
3. Stores refresh token in `~/.mentiko/mcp/session.json`
4. Auto-exchanges refresh token on 401

**Benefits:**
- No manual token rewiring
- 90-day refresh token
- Silent 24h access-token renewal

## Usage Examples

### Run a Chain from Claude Code

```typescript
// Claude Code conversation
User: "Run the research chain on my current project"

Claude: Invoking run_chain...
Agent: Chain started (run: abc123)
Agent: Research agent analyzing project structure...
Agent: Draft agent creating documentation...
Agent: Complete!
```

### List Tasks

```typescript
User: "What tasks do I have pending?"

Claude: Invoking list_tasks...
Agent: You have 3 tasks pending:
- TASK-1: Fix auth bug (blocked by TASK-0)
- TASK-5: Update docs (ready to start)
- TASK-8: Review PR (ready to start)
```

### Create Task from Decision

```typescript
User: "Create tasks for this decision"

Claude: Invoking decision → task generation...
Agent: Created 5 tasks from decision "Choose database"
Agent: TASK-10: Evaluate PostgreSQL options
Agent: TASK-11: Benchmark performance
Agent: TASK-12: Set up test environment
```

## Troubleshooting

**MCP server not found:**
- Verify Mentiko is running
- Check claude_desktop_config.json path
- Restart Claude Code

**"Session expired" errors:**
- Run `reconnect()` tool
- Approve in browser
- Token auto-saved for future use

**Tools not available:**
- Check MCP server logs
- Verify session is active
- Try reconnecting

**TODO:** Webhook integration, streaming run output, MCP tool parameters
