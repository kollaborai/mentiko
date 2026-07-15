# Hybrid Orchestration

Shell boundaries launch chains and agents. Long-running orchestration services
run in the supervised TypeScript background worker.

## Overview

Chain execution and agent launching retain shell boundaries. Event-triggered
cross-chain launches and stalled-run recovery are TypeScript services owned by
`web/server/background-worker.ts`; neither service is a shell or PTY daemon.

## Design

### Orchestration Responsibilities

The orchestration layer:
1. Reads chain definition (JSON file)
2. Launches agents in PTY sessions
3. Watches canonical event files in the typed chain-watcher service
4. Recovers stalled runs in the typed watchdog scan

Shell remains useful at the chain/agent process boundary. TypeScript owns the
long-running watcher/watchdog lifecycle and their persisted contracts.

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

**event-emitter.ts / event-lifecycle.ts**
- Own canonical event writes and strict raw-file validation
- Own list, completion lookup, processed mutation, and scoped archival
- Expose compiled TypeScript CLIs to shell process boundaries

**completion-entrypoint.ts**
- Owns completion, routing, and strict event consumption in TypeScript
- Never fabricates a missing declared success event and has no shell fallback

**background-worker.ts**
- Starts and stops the typed chain-watcher service
- Runs the typed watchdog scan at startup and every 60 seconds

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

```text
process-manager
  -> web/server/background-worker.ts
       -> startChainWatcherService()  # typed event-triggered chain launch
       -> runTypedWatchdogScan()      # typed stalled-run recovery
```

## Characteristics

### Advantages

**File System Operations:**
- Bash designed for file manipulation
- Process management is native
- Typed chain watcher owns long-running event-directory observation

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
- Node.js (typed background services)
- pty-manager (PTY allocation)

## Related

- [Single-Machine Deployment](/architecture/without-kubernetes)
- [PTY Sessions](/architecture/pty-sessions)
- [File-Based Events](/architecture/file-events)
- [Agent Chains](/concepts/agent-chains)
