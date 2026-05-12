---
title: "Scheduling & Monitoring"
type: component
linked_files:
  - lib/scheduler.sh
  - lib/watchdog.sh
  - lib/chain-generator.sh
  - lib/run-lib.sh
  - lib/parallel-launcher.sh
  - lib/parallel-coordinator.sh
  - lib/multi-chain-runner.sh
  - lib/agent-functions.sh
  - lib/agent-activity-capture.sh
file_hashes:
  lib/agent-activity-capture.sh: sha256:7d9726045eb0cbb4
  lib/agent-functions.sh: sha256:c5b5f6a8a120cfec
  lib/chain-generator.sh: sha256:95da43f6007dd573
  lib/multi-chain-runner.sh: sha256:a072a15440e79abb
  lib/parallel-coordinator.sh: sha256:f88298764eb34456
  lib/parallel-launcher.sh: sha256:608f3f797b4b4a06
  lib/run-lib.sh: sha256:9464aeca9fa78673
  lib/scheduler.sh: sha256:64900d3487c3704d
  lib/watchdog.sh: sha256:514cdb0042a512e1
tags: [scheduler, watchdog, monitoring, bash]
created: 2026-04-07T09:39:40.001390
updated: 2026-04-07T09:39:40.001390
status: current
related: []
---

```yaml
---
title: Scheduling & Monitoring
type: component
tags: [scheduler, watchdog, monitoring, bash, cron, agent-orchestration]
related: [[chain-runner]], [[session-transport]], [[run-lib]]
---
```

## Scheduling & Monitoring

The scheduling and monitoring subsystem provides time-based chain execution and health monitoring for long-running agent chains. It consists of three main components:

- **scheduler.sh**: Cron-based scheduling for chains
- **watchdog.sh**: Background daemon that detects and handles stalled runs
- **agent-activity-capture.sh**: Captures agent artifacts (git diffs, files changed, conversations)

## Scheduler (`lib/scheduler.sh`)

### Overview

The scheduler enables chains to run automatically on a cron schedule. Each chain can define its own schedule in its `config.schedule` field. The scheduler daemon wakes periodically, checks if any chains are due, and executes them via `chain-runner.sh`.

### Schedule Format

Supports both flat and nested formats in `chain.json`:

```json
{
  "config": {
    "schedule": "0 9 * * *"
  }
}
```

Or nested with timezone:

```json
{
  "config": {
    "schedule": {
      "cron": "0 9 * * *",
      "timezone": "UTC"
    }
  }
}
```

### Key Functions

| Function | Purpose |
|----------|---------|
| `should_run_chain <chain.json>` | Returns "true"/"false" if chain is due |
| `validate_cron <cron-expr>` | Checks if cron expression is valid |
| `calculate_next_run <cron> [after]` | Computes next run timestamp |
| `is_running <schedule-id>` | Checks if previous execution still active |
| `is_enabled <chain.json>` | Checks if schedule is enabled |
| `mark_run_start/mark_run_end` | Lock/unlock during execution |

### State Management

Schedule state is stored in `$SCHEDULES_DIR/state.json`:

```json
{
  "path/to/chain.json": 1735123456
}
```

Per-schedule files:
- `{schedule-id}.lock` - Execution lock (timestamp)
- `{schedule-id}.pid` - Process ID
- `{schedule-id}.status` - "enabled: true/false"
- `{schedule-id}.history` - Execution history log

### CLI Commands

```bash
scheduler.sh check <chain.json>     # Check and run if due
scheduler.sh list                   # List all scheduled chains
scheduler.sh next <chain.json>      # Show next scheduled run
scheduler.sh enable <chain.json>    # Enable schedule
scheduler.sh disable <chain.json>   # Disable schedule
scheduler.sh daemon [interval]      # Run as daemon (default: 60s)
```

### Gotchas

- Schedule ID is derived from relative path (portable across namespaces)
- Lock files older than 2 hours are considered stale and removed
- Requires `python-croniter` for accurate next-run calculation
- Daemon mode spawns background jobs for each due chain

## Watchdog (`lib/watchdog.sh`)

### Overview

The watchdog is a background daemon that monitors all "running" chains and detects stalled executions. It checks PTY session liveness every 60 seconds and can emit events for self-healing chains.

### Control Flow

```
every 60s:
  1. Check pty-manager is responsive
  2. Get list of live PTY sessions
  3. For each "running" run:
     a. Get agent list from run.json
     b. For each agent, check if its PTY session is alive
     c. If any running agent has no live session → STALLED
  4. On stall:
     a. Kill all agent/monitor PTY sessions
     b. Update run.json: status=stopped
     c. Emit run-stalled event
     d. Fire hooks (notifications)
     e. Trigger self-heal chain if enabled
```

### Liveness Rules

The PTY session is the source of truth:

1. **Session alive**: Agent is alive (no age check needed)
2. **Session dead + monitor alive**: Agent is being handled by chain-runner-complete
3. **Session dead + no monitor**: Agent is stalled

Grace periods apply when session is missing:
- Young runs (<2 min): Assume sessions starting up
- Recent completion (<5 min): chain-runner-complete doing handoff
- Pending agents: Expected in young runs

### Orphan Cleanup

Every 5 minutes (`WATCHDOG_CLEANUP_INTERVAL`), the watchdog kills PTY sessions that:
- Exist in pty-manager but are not referenced by any active run
- Are not special sessions (watchdog itself, monitors, user terminals, link/peer sessions)

### CLI Commands

```bash
watchdog.sh              # Start daemon (foreground)
watchdog.sh status       # Check if running
watchdog.sh stop         # Stop daemon
```

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `WATCHDOG_INTERVAL` | 60 | Check interval (seconds) |
| `WATCHDOG_AUTO_HEAL` | false | Auto-trigger self-heal chain |
| `WATCHDOG_CLEANUP_INTERVAL` | 300 | Orphan cleanup interval |

## Agent Activity Capture (`lib/agent-activity-capture.sh`)

### Overview

Captures agent execution artifacts after completion. Called by `chain-runner-complete.sh` to persist what the agent did.

### Artifacts Created

Written to `runs/{runId}/artifacts/`:

| File | Contents |
|------|----------|
| `{agentId}-diff.patch` | Git diff from before SHA → current HEAD |
| `{agentId}-files-changed.json` | List of changed files with M/A/D status |
| `{agentId}-conversations.json` | Paths to conversation JSONL files |
| `{agentId}-output.txt` | Terminal session output |

### Prereqs (Written Before Agent Starts)

The caller must create these before launching the agent:
- `artifacts/{agentId}-git-before.txt` - Git SHA before agent
- `artifacts/{agentId}-started-at.txt` - ISO timestamp

### Key Function

```bash
capture-agent-activity <agent_id> <run_id> <project_root> <report_file> [namespace_id] [profile_file]
```

### Conversation Discovery

Uses `session-log-resolver.sh` to find conversation files active during the agent's run. Searches for files modified after the `started-at` timestamp in the appropriate CLI log directory.

### Manifest Update

Updates `run.json` with artifact metadata:

```json
{
  "artifacts": [
    {"agentId": "agent1", "type": "diff", "diffLines": 42, "timestamp": "..."},
    {"agentId": "agent1", "type": "conversations", "timestamp": "..."},
    {"agentId": "agent1", "type": "output", "timestamp": "..."}
  ]
}
```

## Parallel Execution

### parallel-launcher.sh

Launches multiple agents in parallel:

```bash
parallel-launcher.sh <chain.json> <agent-id1> <agent-id2> [...]
```

- Launches each agent in a background subshell
- Creates tracking file in `$STATE_DIR/parallel/{group-id}.tracking`
- Waits for all agents to complete before returning

### parallel-coordinator.sh

Similar to parallel-launcher but with enhanced tracking:

```bash
parallel-coordinator.sh <chain.json> <agent-id1> <agent-id2> [...]
```

- Creates tracking file with PIDs and results
- Reports which agents succeeded/failed
- Returns non-zero if any agent failed

### multi-chain-runner.sh

Orchestrates multiple chains in parallel or sequential mode:

```bash
multi-chain-runner.sh <batch.json> [--mode parallel|sequential]
```

Batch format:
```json
{
  "id": "batch-20250225-143000",
  "mode": "parallel|sequential",
  "chains": [
    {"id": "chain1", "file": "/path/to/chain1.json", "goal": "..."}
  ]
}
```

## Chain Generator

`lib/chain-generator.sh` - AI-powered chain.json generator from natural language:

```bash
chain-generator.sh "<prompt>" [--output <dir>] [--template <file>] [--json]
```

- Reads schema from `$GEN_SCHEMA`
- Calls AI CLI (default: glm) with generation prompt
- Validates output against schema
- Writes chain.json + spec files if referenced

## Dependencies

- `jq` - JSON parsing and manipulation
- `python-croniter` - Cron expression evaluation (optional, for next-run calculation)
- `pty-manager` - PTY session management (via session-transport.sh)
- `chain-runner.sh` - Chain execution (scheduler invokes this)
- `run-lib.sh` - Run object management
- `session-log-resolver.sh` - Conversation file discovery

## Integration Points

- **Events**: Emits to `$EVENTS_DIR` for event-driven chains
- **Hooks**: Calls `hooks.sh` for notifications and custom actions
- **Task Store**: Updates task metadata via `/api/tasks` on completion/failure
- **PTY Manager**: All session checks go through session-transport abstraction