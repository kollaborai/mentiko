---
title: Chain Execution Engine
type: component
tags: [chain, orchestration, events, bash]
related: [session-management, event-system, agent-profiles, run-objects]
---

## Overview

The Chain Execution Engine is the core orchestration layer that executes multi-agent workflows defined in JSON chain files. It handles agent sequencing, event-driven triggers, parallel execution, retry logic, and workspace isolation.

### Core Responsibilities

- **Agent Orchestration**: Launch agents in sequence based on event triggers
- **Event Processing**: Parse event files and route to next agent
- **Parallel Execution**: Fan-out (multiple agents) and fan-in (wait for completion)
- **State Management**: Track run status, agent states, and loop detection
- **Artifact Capture**: Git diffs, conversation logs, agent output per run
- **Workspace Support**: Local, SSH remote, and Docker container execution

## Key Files

| File | Purpose |
|------|---------|
| `lib/chain-runner.sh` | Main entry point, creates runs, launches agents |
| `lib/chain-runner-complete.sh` | Agent completion handler, finds next agent |
| `lib/chain-event-watcher.sh` | Daemon that watches for event triggers |
| `lib/launch-agent.sh` | Launch single agent from spec file |
| `lib/complete-agent.sh` | Legacy completion (spec-based chains) |
| `lib/event-trigger.sh` | Event file creation, processing, archival |
| `lib/routing-lib.sh` | Fan-out/fan-in, error handlers, retries |
| `lib/session-transport.sh` | PTY session management abstraction |
| `lib/run-lib.sh` | Run object creation and updates |

## How It Works

### 1. Chain Initialization

```bash
chain-runner.sh <chain.json> --workspace <path> [--task <id>] [--start <agent-id>]
```

1. Validate JSON and load chain config
2. Resolve config profiles (chain-level defaults)
3. Load task context if `--task` provided
4. Create run object via `create-run()`
5. Find starting agent (manual-start trigger or first agent)

### 2. Agent Launch

`launch_chain_agent()` in chain-runner.sh:

1. Resolve agent profile (agent > chain > workspace > namespace)
2. Build CLI command with env vars sourced from temp file
3. Create PTY session via `transport_new_session()`
4. Send instructions to agent (spec path or prompt)
5. Start monitor session (watches for AGENT_COMPLETE)
6. Record git HEAD for diff capture on completion

### 3. Completion Detection

Monitor watches agent output for `AGENT_COMPLETE` signal. When detected:

1. `chain-runner-complete.sh` is invoked
2. Captures final agent output
3. Parses event file from agent
4. Marks event as processed
5. Archives all events (prevents stale pickup)
6. Finds next agent by trigger lookup

### 4. Next Agent Resolution

Lookup priority:

1. **Branch mapping**: `chain.json` `branches[event]`
   - String → single agent
   - Array → parallel fan-out
   - Object with `fan_out` → fan-out with fan-in
2. **Agent triggers**: Find agents where `triggers[]` matches event
3. **Termination**: No match = chain complete

### 5. Loop Detection

Tracks visited `agent_id:event_name` pairs in `chain_loop_tracker.txt`.
Prevents infinite loops when agents trigger each other in cycles.

## Event System

Events are simple text files in `{projectRoot}/events/`:

```yaml
event: research-complete
source: researcher
timestamp: 2025-01-15T10:30:00
processed: false
data: optional payload
```

### Event Flow

```
agent writes event → file appears in events/
    ↓
chain-runner-complete.sh scans events/
    ↓
finds unprocessed event with matching source
    ↓
looks up next agent by trigger
    ↓
marks event processed
    ↓
archives all events to events/archive/
```

### Archive Behavior

`archive-all-events()` moves ALL events to archive between chain steps.
This is critical - prevents stale events from being picked up by later agents.

## Routing Patterns

### Fan-Out / Fan-In

Chain config for parallel execution:

```json
{
  "branches": {
    "research-done": {
      "fan_out": ["analyst-1", "analyst-2", "analyst-3"],
      "fan_in": "synthesizer",
      "wait_for": "all",
      "quorum": 0,
      "on_error": "error-handler"
    }
  }
}
```

- `fan_out`: Array of agent IDs to launch in parallel
- `fan_in`: Agent to trigger when all complete
- `wait_for`: "all", "any", or "quorum"
- `quorum`: Minimum count for quorum mode
- `on_error`: Route to this agent if any fan-out agent fails

### Conditional Branching

```json
{
  "branches": {
    "decision-made": {
      "conditions": [
        {"if": "approved", "then": "executor"},
        {"if": "rejected", "then": "appeals"}
      ],
      "default": "reviewer"
    }
  }
}
```

## Agent Profiles

Agent profiles decouple CLI configuration from chain definitions:

```json
{
  "cli": "claude",
  "cli_args": ["--max-tokens", "200000"],
  "model": "claude-3-7-sonnet",
  "env": {
    "ANTHROPIC_API_KEY": "{secret:ANTHROPIC_KEY}",
    "ANTHROPIC_BASE_URL": "https://api.anthropic.com"
  }
}
```

Resolution priority: agent `agent_profile` > chain `default_agent_profile` > workspace default > namespace default.

### Environment Variable Security

Env vars are NEVER inlined in commands. They're sourced from temp files:

```bash
# mktemp creates secure temp file
# source it, then delete immediately
source /tmp/agent-env-XXXXXX; rm -f /tmp/agent-env-XXXXXX; claude ...
```

This prevents credentials from appearing in:
- Terminal echo
- Output logs
- Web UI display

## Workspace Types

### Local (default)

Agent runs on same machine as chain-runner:

```bash
cd /project/root && unset CLAUDECODE && claude
```

### SSH Remote

1. Source profile env locally (API keys stay local)
2. SCP gateway env to remote host
3. SSH into remote host
4. Source gateway env, start CLI

```bash
ssh -i key user@host
cd /remote/path && source /tmp/gw-env; claude
```

### Docker Container

Similar to SSH but uses `docker exec`:

```bash
docker exec -it container bash
cd /container/path && source /tmp/gw-env; claude
```

## Run Objects

Each chain execution creates a run object at `runs/{runId}/run.json`:

```json
{
  "id": "run-1234567890",
  "chain": "my-chain",
  "parent_run_id": "run-...",
  "workspacePath": "/path/to/project",
  "goal": "Execute the chain",
  "started": "2025-01-15T10:00:00",
  "status": "running",
  "taskId": "task-123",
  "sessions": ["project-agent1-run-123", "project-agent2-run-123"],
  "agents": [
    {"id": "agent1", "name": "Researcher", "session": "...", "status": "complete"},
    {"id": "agent2", "name": "Writer", "session": "...", "status": "running"}
  ],
  "artifacts": [...]
}
```

### Artifacts Captured

Per-agent artifacts in `runs/{runId}/artifacts/`:

- `{agentId}-output.txt` - Captured PTY output
- `{agentId}-events.json` - Event agent emitted
- `{agentId}-diff.patch` - Git diff from agent's changes
- `{agentId}-files-changed.json` - List of modified files
- `{agentId}-conversations.json` - Paths to conversation logs
- `{agentId}-git-before.txt` - Git SHA before agent ran
- `{agentId}-started-at.txt` - Timestamp for conversation discovery

## Monitoring

Each agent gets a monitor session that:

1. Watches PTY output for `AGENT_COMPLETE` signal
2. Tracks stale output (no new lines for N intervals)
3. Invokes `chain-runner-complete.sh` on completion
4. Can trigger timeout agent if configured

Monitor invocation:

```bash
monitor-chain-agent <session> <interval> <context> <chain.json> <max_stale>
```

## Retry Logic

Agents can configure retry behavior:

```json
{
  "retry": {
    "max_retries": 3,
    "strategy": "exponential",
    "initial_delay": 5,
    "max_delay": 300,
    "backoff_multiplier": 2.0,
    "circuit_breaker": {
      "threshold": 5,
      "timeout": 300
    }
  }
}
```

Strategies: `fixed`, `exponential`, `linear`

## Chain Chaining

Chains can spawn other chains on completion:

```json
{
  "config": {
    "on_complete": "chain:next-chain-name"
  }
}
```

The spawned chain inherits `MENTIKO_PARENT_RUN_ID` for traceability.

## Event-Driven Chain Triggers

Chains can auto-launch when specific events occur:

```json
{
  "config": {
    "event_triggers": [
      {
        "event": "code-review-approved",
        "source_chain": "code-review",
        "condition": "",
        "pass_data": true
      }
    ]
  }
}
```

`chain-event-watcher.sh` daemon scans events dir and matches against chain configs.

## Gotchas

### Namespace Path Collapse

Default org collapses into namespace root for backward compat:

- Default org: `~/.mentiko/namespaces/default/chains/`
- Non-default: `~/.mentiko/namespaces/acme/orgs/engineering/chains/`

Code must check `ORG_ID` before building paths.

### Stop Value Ambiguity

Branch value `"stop"` terminates chain. But agent IDs named "stop" create phantom agents.
Avoid "stop", "error", "failed" as agent IDs.

### Process Persistence

Agents launched in background subshells must use `disown` to survive chain-runner exit:

```bash
( export MENTIKO_RUN_ID="$RUN_ID"; bash chain-runner.sh ... ) & disown
```

### macOS mktemp Incompatibility

macOS mktemp doesn't support suffixes in template:

```bash
# WRONG - fails on second call
mktemp /tmp/agent-env-XXXXXX.sh

# RIGHT - no suffix, add extension after
mktemp /tmp/agent-env-XXXXXX
```

### Event Processing Race Conditions

Multiple agents can write events simultaneously. Archive-all-events between steps prevents cross-pollination.

### Session Naming

Session names include run-id for grouping: `{project}-{agent}-{runId}`

Without run-id, parallel agents would have timestamp collisions.

## Dependencies

- **jq**: JSON parsing (required)
- **pty-manager** (bin/p): PTY session management
- **git**: Artifact capture (diff, SHA tracking)
- **curl**: System logging, task API calls

## Exit Conditions

Chain terminates when:

1. No agent matches the emitted event
2. Branch mapping returns `"stop"`
3. Max rounds exceeded (`config.max_rounds`)
4. Circuit breaker open (too many failures)
5. Budget exceeded (if budget-check enabled)
6. Debug breakpoint pauses execution
