# File-Based Event System

Event communication mechanism for agent coordination.

## Overview

Agents communicate via event files written to the filesystem. When an agent completes, it writes an event file. The orchestration layer watches the events directory and launches the next agent in the chain.

## Design

### Event Format

Runner events are canonical lowercase `key: value` files:

```text
event: research-complete
source: research-agent
run_id: run-1784102007562-bb990ff5
timestamp: 2026-07-02T20:15:00.000Z
processed: false
data: output=/workspace/research.md status=success
```

### Processing Flow

1. Producer invokes `mentiko emit`; agents use the ambient run scope
2. Filesystem watcher detects new file
3. Event name matched against agent triggers
4. Matching agents launched with event data
5. Event marked as processed

### Implementation

The typed emitter in `web/lib/runner-v2/event-emitter.ts` owns serialization,
filename selection, and atomic no-clobber persistence. The parser in
`web/lib/runner-v2/events.ts` validates the physical file before normalization.
The typed watcher in `web/lib/runner-v2/chain-watcher-service.ts` consumes only
validated records from the configured event root.

## Characteristics

### Advantages

**Debuggability:** Events are files. Use standard shell tools:
```bash
ls events/
cat events/agent-complete.event
grep "status" events/*.event
git diff events/
```

**Zero Infrastructure:** No separate services to deploy or monitor.

**Strict Contract:** Six canonical lowercase fields are required exactly once.
Malformed, duplicate, missing, JSON, YAML, frontmatter, and noncanonical files
are rejected rather than partially normalized.

### Limitations

**No Guaranteed Ordering:** Simultaneous events processed in filesystem order. Sequential chains wait for previous agent, so ordering is implicit.

**No Built-in Retry:** Retry logic in chain runner, not event system.

**No Cross-Machine Communication:** Files work on shared filesystem only.

**No Backpressure:** Events accumulate until watchdog detects stalled chain.

## Schema

**Required fields:**
- `event` (string) - Event name for trigger matching
- `source` (string) - Emitting agent ID
- `run_id` (string) - Owning run ID; empty only for explicit pre-run ingress
- `timestamp` (ISO8601) - When event was emitted
- `processed` (boolean) - Whether event has been handled
- `data` (string) - Additional context; may be empty

**Optional fields:**
- lowercase extension fields used by typed diagnostic producers

## Location

```
namespaces/{NAMESPACE_ID}/events/
  chain-start.event
  agent-1-complete.event
  agent-2-complete.event
  chain-complete.event
```

## Monitoring

**Event metrics tracked:**
- Events per chain execution
- Event processing latency
- Failed events by type
- Stuck events (>5min unprocessed)

**Health checks:**
```bash
# Count unprocessed events
grep -l "processed.*false" events/*.event | wc -l

# Find old events
find events/ -mmin +5 -name "*.event"
```

## Error Handling

**Parse failures:** Log error, skip event, continue processing.

**Missing required fields:** Log error, skip event.

**Invalid timestamp:** Reject the event; consumers do not substitute file time or current time.

## Related

- [Event-Driven Architecture](/concepts/event-driven-architecture)
- [Events Reference](/reference/events)
- [Chain Execution](/concepts/agent-chains)
