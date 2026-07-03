# Single-Machine Deployment

Deployment model for isolated tenant instances without container orchestration.

## Overview

Each tenant instance runs on a dedicated VPS. Orchestration uses bash scripts and PTY sessions instead of Kubernetes.

## Design

### Deployment Model

**Per-tenant VPS:**
- Isolated machine per customer
- No shared infrastructure
- Platform runs as systemd services
- Data stored on local filesystem

**Benefits:**
- Simple operational model
- Customer data isolation
- Predictable resource allocation

### Orchestration Components

**chain-runner.sh**
- Reads chain.json definition
- Resolves agent dependencies
- Manages execution order
- Handles chain lifecycle

**launch-agent.sh**
- Spawns agent in PTY session
- Sets up environment and workspace
- Manages agent input/output

**event-trigger.sh**
- Watches events directory
- Triggers dependent agents
- Manages event processing

**complete-agent.sh**
- Captures agent output
- Writes event file
- Signals downstream agents

**watchdog.sh**
- Monitors PTY session activity
- Detects stalled runs
- Implements retry and escalation

**pty-manager**
- Allocates PTY sessions for agents
- Provides real terminal interface
- Manages session lifecycle

## PTY Sessions

Agents require real terminals for CLI tool interaction.

**Implementation:**
```bash
# launch-agent.sh spawns agent in PTY session
pty-manager allocate --session "$agent_id"
pty-manager exec --session "$agent_id" -- \
  claude --model sonnet --system-prompt "$prompt" \
  < "$input_file" > "$output_dir/$agent_id.output"
```

**Why PTY:**
- Interactive tools expect terminals (stdin, stdout, stderr, TTY signals)
- `isatty()` checks fail in containers
- SSH, git, npm require real terminals
- No shims or wrappers needed

## File-Based Events

Agents communicate via event files.

**Event format:**
```json
{
  "agent": "researcher",
  "status": "complete",
  "output_path": "/runs/abc123/researcher/output",
  "tokens_used": 14200,
  "duration_seconds": 34,
  "timestamp": "2026-03-19T09:41:22Z"
}
```

**Processing:**
```bash
# event-trigger.sh watches for new events
inotifywait -m -e create --format '%f' .events/ | while read event; do
  process_event "$event"
done
```

**Characteristics:**
- State visible as files
- No separate broker service
- Debuggable with standard tools
- Replayable by deleting event files

## Characteristics

### Advantages

**Operational Simplicity:**
- Deployment: `scp` and `systemctl restart`
- No container registry or image builds
- No rolling deployment strategies
- No control plane management

**Debuggability:**
- SSH and read event files
- Check PTY session logs directly
- No distributed tracing needed
- Root cause analysis in minutes

**Isolation:**
- Per-customer VPS
- Actual machine separation
- Data isolation clear to explain
- No shared cluster attack surface

**Learning Curve:**
- Read bash to understand system
- No Kubernetes concepts required
- No CRDs, operators, or Helm charts

### Limitations

**Single Point of Failure:**
- VPS down = agents stop
- Mitigated by systemd auto-restart
- Chains resumable from last event

**Testing Complexity:**
- Bash harder to unit test than typed languages
- Reliance on integration tests
- Watchdog for runtime safety

**Event Ordering:**
- Simultaneous events lack guaranteed ordering
- Mitigated by sequence numbers in filenames
- Conflict resolution conventions

**Scaling:**
- No horizontal scaling within instance
- Vertical scaling (bigger VPS) for more capacity
- Separate instances for different workloads

## Deployment

**Services:**
```bash
# systemd services
mentiko-chain-runner.service
mentiko-pty-manager.service
mentiko-watchdog.service
```

**Commands:**
```bash
# Deploy platform
scp bin/* lib/* user@vps:/opt/mentiko/
ssh user@vps "systemctl restart mentiko-*"

# Check status
ssh user@vps "systemctl status mentiko-*"
```

**Monitoring:**
- systemd service status
- PTY session activity
- Event file processing
- Watchdog alerts

## Related

- [PTY Sessions](/architecture/pty-sessions)
- [File-Based Events](/architecture/file-events)
- [Agent Chains](/concepts/agent-chains)
- [Self-Hosting](/guides/self-hosting)
