# Events

Event system for agent coordination.

## Overview

Events enable agent coordination. When an agent completes, it writes an event file. The orchestration layer watches for new files and launches agents triggered by those events.

## Design

### Event Format

Events are JSON files written to the events directory:

```json
{
  "event": "agent:complete",
  "source": "research-agent",
  "timestamp": "2026-07-02T20:15:00Z",
  "processed": false,
  "data": {
    "status": "success",
    "output": "/workspace/findings.md"
  }
}
```

### Event Processing

1. Agent writes `.event` file to `namespaces/{id}/events/`
2. Filesystem watcher detects new file
3. Event name matched against agent triggers
4. Matching agents launched with event data
5. Event marked as processed

### Parser

Tries formats in order: JSON, YAML, markdown frontmatter. Falls back to filename if all fail.

**Implementation (lib/event-parser.mjs):**
```javascript
function parseEvent(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  
  try {
    return JSON.parse(content);
  } catch {
    // Try YAML, then frontmatter
  }
  
  // Fallback to filename
  return { event: path.basename(filePath, '.event') };
}
```

## Patterns

### Trigger/Emit

Agents declare what events they respond to (`triggers`) and what events they produce (`emits`):

```json
{
  "id": "writer",
  "triggers": ["research:complete"],
  "emits": ["draft:complete"]
}
```

### Conditional Routing

Events can include routing logic:

```json
{
  "event": "agent:complete",
  "data": {
    "status": "success",
    "branch": "production"
  }
}
```

Agents filter on event data:

```json
{
  "triggers": ["agent:complete"],
  "when": {
    "branch": "production"
  }
}
```

### Fan-Out

One event triggers multiple agents:

```json
{
  "event": "research:complete",
  "triggers": [
    "writer",
    "analyst",
    "archivist"
  ]
}
```

All three agents launch simultaneously.

### Fan-In

Multiple agents emit same event type. System waits for all before proceeding:

```json
{
  "event": "review:complete",
  "wait_for_all": true
}
```

## Error Handling

**Agent Failure:** Agent writes event with `status: "failed"`. Chain runner applies retry policy.

**Parse Failure:** Logs error, skips event, continues processing.

**Missing Required Fields:** Logs error, uses defaults where possible.

**Watchdog:** Detects stuck events (>5min unprocessed), alerts or retries.

## Debugging

**List all events:**
```bash
ls namespaces/default/events/
```

**View event content:**
```bash
cat namespaces/default/events/agent-complete.event
```

**Find failures:**
```bash
grep '"status":"failed"' namespaces/default/events/*.event
```

**Compare runs:**
```bash
git diff namespaces/default/events/
```

**Watch live:**
```bash
tail -f namespaces/default/events/*.event
```

## Location

```
namespaces/{NAMESPACE_ID}/events/
  chain-start.event
  agent-1-complete.event
  agent-2-complete.event
  chain-complete.event
```

## Schema

**Required fields:**
- `event` (string) - Event name for trigger matching
- `source` (string) - Emitting agent ID
- `timestamp` (ISO8601) - When event was emitted
- `processed` (boolean) - Whether event has been handled

**Optional fields:**
- `data.status` (string) - Execution status
- `data.output` (string) - Path to output artifact
- `data.error` (string) - Error message if failed
- `data.metrics` (object) - Performance data
- `data.branch` (string) - Routing condition

## Related

- [File-Based Event System](/architecture/file-events)
- [Event-Driven Architecture](/concepts/event-driven-architecture)
- [Agent Chains](/concepts/agent-chains)
