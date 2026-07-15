# Events

Event system for agent coordination.

## Overview

Events enable agent coordination. A producer requests a canonical event write
through the typed emitter. The typed chain watcher observes validated files and
launches chains triggered by those events.

## Design

### Event Format

Runner events are canonical lowercase `key: value` files written to the
configured events directory:

```text
event: research-complete
source: research-agent
run_id: run-1784102007562-bb990ff5
timestamp: 2026-07-02T20:15:00.000Z
processed: false
data: output=/workspace/findings.md status=success
```

### Event Processing

1. Producer invokes `mentiko emit`; agents use the ambient run scope
2. Filesystem watcher detects new file
3. Event name matched against agent triggers
4. Matching agents launched with event data
5. Event marked as processed

### Parser

`web/lib/runner-v2/events.ts` validates the physical file before normalizing it.
All six canonical fields must exist exactly once. Keys must be lowercase;
`processed` must be `true` or `false`; and malformed files are rejected. Unknown
extension fields are allowed only when they are lowercase, unique, and do not
replace a canonical field. There is no JSON, YAML, frontmatter, filename, or
file-mtime fallback.

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

**Missing Required Fields:** Rejects the event; consumers do not synthesize defaults.

**Watchdog:** Recovers proven stalled runs. It does not retry unprocessed
events; the typed chain watcher tracks per-trigger handled markers.

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
grep '^data: .*status=failed' namespaces/default/events/*.event
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
- `run_id` (string) - Owning run ID; empty only for explicit pre-run ingress
- `timestamp` (ISO8601) - When event was emitted
- `processed` (boolean) - Whether event has been handled
- `data` (string) - Additional context; may be empty

**Optional fields:**
- lowercase extension fields used by typed diagnostic producers

## Related

- [File-Based Event System](/architecture/file-events)
- [Event-Driven Architecture](/concepts/event-driven-architecture)
- [Agent Chains](/concepts/agent-chains)
