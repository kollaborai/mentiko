# File-Based Event System

Event communication mechanism for agent coordination.

## Overview

Agents communicate via event files written to the filesystem. When an agent completes, it writes an event file. The orchestration layer watches the events directory and launches the next agent in the chain.

## Design

### Event Format

Events are JSON files:

```json
{
  "event": "agent:complete",
  "source": "research-agent",
  "timestamp": "2026-07-02T20:15:00Z",
  "processed": false,
  "data": {
    "status": "success",
    "output": "/workspace/research.md"
  }
}
```

### Processing Flow

1. Agent writes `.event` file to `namespaces/{id}/events/`
2. Filesystem watcher detects new file
3. Event name matched against agent triggers
4. Matching agents launched with event data
5. Event marked as processed

### Implementation

**Watcher (lib/event-trigger.sh):**
```bash
inotifywait -m -e create --format '%f' events/ | while read file; do
  process_event "$file"
done
```

**Parser (lib/event-parser.mjs):**
```javascript
const event = JSON.parse(fs.readFileSync(path, 'utf8'));
const eventName = event.event;
const timestamp = new Date(event.timestamp);
```

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

**Format Tolerance:** Parser accepts JSON, YAML, or markdown frontmatter. Filename fallback when parsing fails.

### Limitations

**No Guaranteed Ordering:** Simultaneous events processed in filesystem order. Sequential chains wait for previous agent, so ordering is implicit.

**No Built-in Retry:** Retry logic in chain runner, not event system.

**No Cross-Machine Communication:** Files work on shared filesystem only.

**No Backpressure:** Events accumulate until watchdog detects stalled chain.

## Schema

**Required fields:**
- `event` (string) - Event name for trigger matching
- `source` (string) - Emitting agent ID
- `timestamp` (ISO8601) - When event was emitted
- `processed` (boolean) - Whether event has been handled

**Optional fields:**
- `data.status` (string) - Agent execution status
- `data.output` (string) - Path to agent output
- `data.error` (string) - Error message if failed
- `data.metrics` (object) - Performance metrics

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

**Invalid timestamp:** Log error, use current time.

## Related

- [Event-Driven Architecture](/concepts/event-driven-architecture)
- [Events Reference](/reference/events)
- [Chain Execution](/concepts/agent-chains)
