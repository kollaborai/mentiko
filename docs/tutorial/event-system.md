understanding the event system
===============================================================================

events are how agents communicate and chains progress.
master events, master chains.

overview
------------------------------------------------------------
the event system is file-based, simple, and forgiving.

flow:
```
agent A completes
  ↓
writes event file to agents/events/
  ↓
monitor detects new file
  ↓
complete-agent parses event
  ↓
finds agents with matching trigger
  ↓
launches next agent(s)
```

why files?
  - durable (survives crashes)
  - inspectable (just read the file)
  - simple (no message queue needed)
  - debuggable (see exactly what happened)

event file format
------------------------------------------------------------
the parser is intentionally forgiving.
ai agents write events in many formats.

all of these work:

yaml style:
```
event: research-complete
source: researcher
timestamp: 2026-02-25T10:00:00Z
processed: false
data: findings written to workspace/research/findings.md
```

json style:
```json
{
  "event": "research-complete",
  "source": "researcher",
  "timestamp": "2026-02-25T10:00:00Z",
  "processed": false,
  "data": "findings written to workspace/research/findings.md"
}
```

markdown style:
```markdown
### AGENT EVENT: research-complete

**source:** researcher
**timestamp:** 2026-02-25T10:00:00Z
**data:** findings written to workspace/research/findings.md
```

minimal:
```
event: research-complete
```

the parser extracts:
  - event name (required)
  - source (optional, inferred from agent)
  - timestamp (optional, defaults to file mtime)
  - data (optional, any text)
  - processed status (defaults to false)

event lifecycle
------------------------------------------------------------
┌─────────┐     ┌──────────────┐     ┌───────────┐     ┌──────────┐
│ created │ ──▶ │ unprocessed  │ ───▶ │ processed │ ───▶ │ archived │
└─────────┘     └──────────────┘     └───────────┘     └──────────┘
                     │
                     ▼
                triggers next agent

state transitions:
  - created: file written by agent
  - unprocessed: detected by monitor, not yet handled
  - processed: handled, next agent(s) launched
  - archived: moved to agents/events/archive/ after chain complete

event fields
------------------------------------------------------------
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
field        type        required    description
────────────────────────────────────────────────────────────────────────────
event        string      yes         name of the event
source       string      no          agent id that emitted
timestamp    string      no          iso timestamp when emitted
processed    boolean     no          whether event was handled
data         string      no          additional context
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

event

the name that triggers will match against.

conventions:
  - use kebab-case: research-complete, build-failed, tests-passed
  - use past-tense for completions: done, complete, finished
  - use descriptive names: not "result" but "approval-decision"

examples:
  - research-complete
  - draft-ready
  - tests-failed
  - approval-decision
  - chain-complete

source

who emitted this event.

if not specified, inferred from:
  - event filename pattern
  - agent that was running when file created

timestamp

when the event was emitted.

if not specified, file modification time is used.

data

free-form text with additional context.

used by:
  - conditional branching (pattern matching)
  - human inspection (debugging)
  - audit trail (what happened)

example:
```
data: 3 issues found in src/api.ts: lines 42, 57, 103
```

emitting events
------------------------------------------------------------
from agent prompt (chain.json):

```json
{
  "prompt": "When done:\n1. Write event file to agents/events/\n   event: research-complete\n   source: researcher\n   data: findings written to workspace/research/findings.md\n2. Output AGENT_COMPLETE"
}
```

from spec file (.agent.md):

```yaml
playbooks:
  3-emit-event:
    - write file to agents/events/researcher-complete.event
    - contents:
        event: research-complete
        source: researcher
        timestamp: (current time)
        processed: false
    - output AGENT_COMPLETE
```

programmatic emission:

```bash
mentiko emit research-complete researcher
```

triggers
------------------------------------------------------------
triggers connect events to agents.

in chain.json:
```json
{
  "agents": [
    {
      "id": "writer",
      "triggers": ["research-complete"]
    }
  ]
}
```

in spec file:
```yaml
triggers:
  - event: research-complete
```

trigger matching:
  - exact match (case-insensitive)
  - "research-complete" matches "research-complete"
  - "Research-Complete" also matches

special triggers:
  - manual-start: agent starts when chain begins

parallel triggers
------------------------------------------------------------
multiple agents can trigger on the same event.

```json
{
  "agents": [
    {
      "id": "reviewer1",
      "triggers": ["draft-complete"],
      "role": "Review for accuracy"
    },
    {
      "id": "reviewer2",
      "triggers": ["draft-complete"],
      "role": "Review for style"
    },
    {
      "id": "synthesizer",
      "triggers": ["review-complete"],
      "role": "Combine reviews"
    }
  ]
}
```

flow:
  draft-complete → reviewer1, reviewer2 (parallel)
  both complete → synthesizer

multiple triggers per agent:
```json
{
  "id": "fixer",
  "triggers": ["tests-failed", "lint-error", "build-failed"]
}
```

conditional routing
---------------------------------------------------------------
use branches to route events based on conditions.

```json
{
  "branches": {
    "review-verdict": {
      "default": "fixer",
      "conditions": [
        {"if": "approved", "then": "deployer"},
        {"if": "needs-revision", "then": "editor"}
      ]
    }
  }
}
```

when reviewer emits "review-verdict":
  - event data contains "approved" → deployer starts
  - event data contains "needs-revision" → editor starts
  - otherwise → fixer starts

see docs/conditional-branching.md for details.

event patterns
---------------------------------------------------------------
common event naming patterns:

completion events:
  - {step}-complete: research-complete, draft-complete
  - {step}-done: build-done, tests-done
  - {step}-finished: analysis-finished

decision events:
  - {decision}: approved, rejected, needs-changes
  - {decision}-verdict: review-verdict, testing-verdict

error events:
  - {component}-error: build-error, runtime-error
  - {step}-failed: tests-failed, deployment-failed

status events:
  - {status}: started, stopped, paused
  - {agent}-{status}: researcher-started, writer-stopped

workflow events:
  - chain-complete
  - iteration-started
  - handoff-complete

example: content pipeline events
```
manual-start → researcher
researcher emits: research-complete → writer
writer emits: draft-complete → reviewer
reviewer emits: approved → publisher
reviewer emits: needs-revision → researcher (round 2)
publisher emits: published → chain-complete
```

monitor and events
---------------------------------------------------------------
the monitor ensures events are written.

when agent completes:
  1. monitor detects AGENT_COMPLETE in output
  2. checks for event file in agents/events/
  3. if missing, writes fallback event
  4. processes event to trigger next agent

fallback event:
```
event: agent-complete
source: {agent_id}
data: (event file not found, auto-generated)
```

this ensures chains don't stall if agent forgets to emit.

debugging events
---------------------------------------------------------------
list all events:
```bash
mentiko events
```

list unprocessed:
```bash
mentiko events --unprocessed
```

view specific event:
```bash
cat agents/events/researcher-research-complete.event
```

watch events in real-time:
```bash
watch -n 1 'ls -la agents/events/'
```

manual event emission:
```bash
mentiko emit custom-event my-agent
```

event not triggering?

1. check spelling (triggers are case-insensitive but must match otherwise)
2. verify agent has matching trigger
3. check event file is in agents/events/ (not subdirectory)
4. ensure processed: false (not already handled)

event file permissions:
```bash
ls -la agents/events/
# should be readable by the user running mentiko
```

webhook notifications
---------------------------------------------------------------
events can trigger webhooks.

configure in chain.json:
```json
{
  "config": {
    "webhooks": {
      "enabled": true,
      "urls": ["https://your-server.com/webhook"],
      "events": ["chain-started", "agent-complete", "chain-complete"]
    }
  }
}
```

webhook payload:
```json
{
  "event": "agent-complete",
  "agent": "researcher",
  "chain": "My Chain",
  "runId": "run-1740500000",
  "timestamp": "2026-02-25T10:00:00Z",
  "data": "findings written to workspace/research/findings.md"
}
```

see docs/webhook-setup.md for details.

event-driven workflows
---------------------------------------------------------------
pattern 1: linear pipeline

```
agent1 (emits step1-done) → agent2 (emits step2-done) → agent3 (emits step3-done)
```

pattern 2: fan-out

```
agent1 (emits data-ready) → [agent2, agent3, agent4] (all start)
```

pattern 3: fan-in

```
[agent1, agent2, agent3] (each emits done) → agent4 (waits for all)
```

pattern 4: iterative loop

```
agent1 (emits result) → agent2
agent2 (emits approved) → agent3
agent2 (emits needs-revision) → agent1 (round 2)
```

pattern 5: error handling

```
agent1 (emits success) → agent2
agent1 (emits error) → error-handler
```

example: complete event flow
---------------------------------------------------------------
chain: content creation with review loop

events timeline:
```
1. manual-start (system)
   ↓
2. research-started (researcher agent)
   ↓
3. research-complete (researcher agent)
   ↓
4. draft-started (writer agent)
   ↓
5. draft-complete (writer agent)
   ↓
6. review-started (reviewer agent)
   ↓
   7a. approved (reviewer agent) → publisher-started
   7b. needs-revision (reviewer agent) → research-started (round 2)
```

event files created:
```
agents/events/
├── researcher-research-started.event
├── researcher-research-complete.event
├── writer-draft-started.event
├── writer-draft-complete.event
├── reviewer-review-started.event
└── reviewer-review-verdict.event
```

best practices
---------------------------------------------------------------
1. use descriptive event names
   "approval-decision" not "result"

2. emit events at the end
   after all work is done

3. include useful data
   what was done, where outputs are

4. test trigger matching
   verify event name matches trigger exactly

5. handle error cases
   emit error events when things fail

6. document event flow
   comment in chain.json describing the sequence

7. use branches for routing
   not multiple agents with conditional logic

8. keep events simple
   strings, not complex data structures

9. archive old events
   prevent agents/events/ from growing huge

10. monitor event processing
   check agents/events/ for stuck events

next: web-ui-guide.md
