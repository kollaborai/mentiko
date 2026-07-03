# Bash Orchestration

Orchestration layer implementation in bash.

## Overview

Chain execution, agent launching, and event monitoring implemented as bash scripts.

## Design

### Orchestration Responsibilities

The orchestration layer:
1. Reads chain definition (JSON file)
2. Launches agents in PTY sessions
3. Watches for event files
4. Triggers next agent when events appear

These are file system and process operations. Bash is designed for these tasks.

### Core Scripts

**chain-runner.sh**
- Reads chain.json
- Resolves agent dependencies
- Manages execution order
- Handles chain lifecycle

**launch-agent.sh**
- Spawns agent in PTY session via pty-manager
- Sets up environment and workspace
- Manages agent input/output

**event-trigger.sh**
- Watches events directory with inotifywait
- Matches events to agent triggers
- Launches dependent agents

**complete-agent.sh**
- Captures agent output
- Writes event file
- Signals downstream agents

**watchdog.sh**
- Monitors PTY session activity
- Detects stalled runs
- Implements retry and escalation

## Implementation

### Chain Execution

```bash
# chain-runner.sh
chain_dir="chains/$chain_name"
chain_json="$chain_dir/chain.json"

# Read chain definition
agents=$(jq '.agents[]' "$chain_json")

# Execute in dependency order
for agent in $(topological_sort "$agents"); do
  agent_id=$(echo "$agent" | jq -r '.id')
  launch_agent "$agent_id" "$chain_json"
  wait_for_completion "$agent_id"
done
```

### Agent Launching

```bash
# launch-agent.sh
agent_id=$1
chain_json=$2

# Get agent config
agent_config=$(jq ".agents[] | select(.id == \"$agent_id\")" "$chain_json")

# Allocate PTY session
session_id=$(pty-manager allocate --workspace "$workspace")

# Execute agent in PTY
pty-manager exec --session "$session_id" \
  claude --prompt "$(get_agent_prompt "$agent_config")" \
  < "$input_file" > "$output_dir/$agent_id.output"

# Wait for completion
pty-manager wait --session "$session_id"
```

### Event Watching

```bash
# event-trigger.sh
events_dir="namespaces/$NAMESPACE_ID/events"

inotifywait -m -e create --format '%f' "$events_dir" | while read event_file; do
  event_data=$(cat "$events_dir/$event_file")
  event_name=$(echo "$event_data" | jq -r '.event')

  # Find agents triggered by this event
  matching_agents=$(jq -r ".agents[] | select(.triggers[] == \"$event_name\") | .id" "$chain_json")

  for agent_id in $matching_agents; do
    launch_agent "$agent_id" "$chain_json"
  done
done
```

## Characteristics

### Advantages

**File System Operations:**
- Bash designed for file manipulation
- Process management is native
- Directory watching with inotifywait

**Text Processing:**
- JSON parsing with jq
- String manipulation
- File format conversion

**Process Control:**
- Spawn and monitor child processes
- Signal handling
- Exit code checking

**Integration:**
- Direct access to Unix tools
- No serialization needed
- Native pipe support

### Limitations

**Error Handling:**
- No type system
- Error codes must be checked manually
- No exception mechanisms

**Testing:**
- Harder to unit test than typed languages
- Reliance on integration tests
- Mock file system operations

**Complexity:**
- Bash scripts become complex at scale
- Refactoring tools limited
- No module system

## Alternatives Considered

**Node.js:**
- More complex for file/process operations
- JSON parsing native but overhead for simple operations
- Requires runtime dependency

**Python:**
- Overhead for process orchestration use case
- Requires Python runtime
- More complex deployment

**Go:**
- Compiled binary required
- Overhead for simple scripting tasks
- Longer development cycle

## Script Structure

**Line count:** ~800 lines across 5 scripts

**Modularity:**
- Single-responsibility scripts
- Shared functions via source
- Configuration via JSON files

**Dependencies:**
- jq (JSON parsing)
- inotifywait (file watching)
- pty-manager (PTY allocation)

## Related

- [Single-Machine Deployment](/architecture/without-kubernetes)
- [PTY Sessions](/architecture/pty-sessions)
- [File-Based Events](/architecture/file-events)
- [Agent Chains](/concepts/agent-chains)
