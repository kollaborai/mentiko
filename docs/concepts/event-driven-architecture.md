# Event-Driven Architecture

Coordination model for agent execution.

## Overview

Agents coordinate via event emission and triggering rather than pre-defined graph structures. Agents emit events when they complete; other agents listen for specific event types to start their execution.

## Design

### Event-Based Coordination

**Traditional approach:** Pre-define all nodes and edges in a DAG (directed acyclic graph).

**Event-driven approach:** Agents emit events, other agents respond to specific event types.

**Example:**
```json
{
  "agent": "researcher",
  "status": "complete",
  "findings": ["security_vuln", "perf_regression"],
  "triggers": ["security-reviewer", "perf-analyst"]
}
```

Researcher found two issues, so two agents trigger. If it found one, one agent would trigger.

### Agent Configuration

Agents declare what events they respond to:

```json
{
  "id": "analyst",
  "triggers": ["research:complete"],
  "emits": ["analysis:complete"]
}
```

When `research:complete` event is emitted, analyst agent starts.

## Characteristics

### Advantages

**Adaptive Workflows:**
- Agents emit different events based on what they discover
- No need to pre-declare all possible execution paths
- System adapts to runtime conditions

**Debuggability:**
- Event files are readable text files
- No hidden graph state
- Inspect events directly: `cat events/*.event`

**Loose Coupling:**
- Agents don't know about each other
- Shared event format, not shared interfaces
- Easy to add/remove agents without changing graph structure

**Composability:**
- Agents can be reused across different chains
- Event names form coordination protocol
- No hard-coded dependencies

### Limitations

**No Global View:**
- No centralized graph showing all possible execution paths
- Runtime behavior emerges from event emissions
- Harder to visualize all possible flows statically

**Event Naming:**
- Requires convention on event names
- Inconsistent naming causes confusion
- No validation that events form coherent workflow

**No Ordering Guarantees:**
- Simultaneous events processed in filesystem order
- Requires explicit ordering when needed
- Sequence numbers or timestamps for partial ordering

## Comparison with DAG-Based Systems

**DAG-based (LangGraph, Airflow):**
- Pre-declared graph structure
- Static execution paths
- Conditional branches increase complexity
- Better for: known workflows, ETL pipelines

**Event-driven:**
- Dynamic execution paths
- Runtime adaptation
- Emergent behavior from event emissions
- Better for: exploratory tasks, adaptive workflows, self-hosting

## Implementation

### Event Emission

Agent writes event file on completion:

```bash
# complete-agent.sh
cat > "events/$AGENT_ID.event" <<EOF
{
  "event": "agent:complete",
  "source": "$AGENT_ID",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "processed": false,
  "data": {
    "status": "$STATUS",
    "output": "$OUTPUT_FILE"
  }
}
EOF
```

### Event Triggering

```bash
# event-trigger.sh
inotifywait -m -e create --format '%f' events/ | while read event; do
  event_type=$(jq -r '.event' "$event")
  matching_agents=$(jq -r '.agents[] | select(.triggers[] == "$event_type") | .id' chain.json)
  
  for agent_id in $matching_agents; do
    launch-agent.sh "$agent_id" "$event"
  done
done
```

### Chain Configuration

```json
{
  "name": "adaptive-workflow",
  "agents": [
    {
      "id": "researcher",
      "triggers": ["chain:start"],
      "emits": ["finding:discovered"]
    },
    {
      "id": "analyst",
      "triggers": ["finding:discovered"],
      "emits": ["analysis:complete"]
    }
  ]
}
```

## Use Cases

**Adaptive Workflows:**
- Research agent discovers subtopics → triggers specialized analysts
- Code review agent finds issues → triggers domain-specific reviewers
- Testing agent finds failures → triggers debugging agents

**Parallel Processing:**
- Single event triggers multiple agents
- Fan-out from discovery to parallel analysis
- Independent processing of same event

**Conditional Routing:**
- Events carry routing data
- Agents filter on event data
- Different branches for different conditions

## Related

- [Events](/reference/events)
- [Agent Chains](/concepts/agent-chains)
- [File-Based Events](/architecture/file-events)
