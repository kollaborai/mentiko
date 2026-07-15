understanding the event system
===============================================================================

events are how agents communicate and chains progress.
master events, master chains.

overview
------------------------------------------------------------
the event system is file-based, strict, and inspectable.

flow:
```
agent A completes
  ↓
invokes `mentiko emit` for its declared event
  ↓
typed emitter validates and atomically writes to the configured event root
  ↓
typed consumers parse the strict event
  ↓
completion routing and cross-chain triggers match the event
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
runner events use canonical lowercase `key: value` lines. every raw file must
contain each of the six fields below exactly once. optional extension fields must
be lowercase, unique, and non-colliding. json, markdown, duplicate fields,
missing fields, and noncanonical key casing are rejected.

canonical example:
```
event: research-complete
source: researcher
run_id: run-1784102007562-bb990ff5
timestamp: 2026-02-25T10:00:00Z
processed: false
data: findings written to workspace/research/findings.md
```

the typed emitter owns serialization, timestamp selection, filename selection,
validation, and atomic no-clobber persistence. shell-facing emit commands only invoke
that emitter; they do not construct event bytes themselves.

event lifecycle
------------------------------------------------------------
┌─────────┐     ┌──────────────┐     ┌────────────────────┐
│ created │ ──▶ │ unprocessed  │ ───▶ │ per-trigger handled │
└─────────┘     └──────────────┘     └────────────────────┘
                     │
                     ├──────────────▶ completion routing
                     └──────────────▶ shell lifecycle mark/archive

state transitions:
  - created: typed emitter atomically writes a validated event
  - unprocessed: available to strict typed consumers
  - handled: chain-watcher records a durable marker per trigger without changing
    the event's processed field
  - processed/archived: legacy `lib/event-trigger.sh` lifecycle helpers can mark
    or move owned events; this read/mutate shell surface remains pending migration

event fields
------------------------------------------------------------
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
field        type        required    description
────────────────────────────────────────────────────────────────────────────
event        string      yes         name of the event
source       string      yes         producer identity
run_id       string      yes         owning run id; may be empty for pre-run ingress
timestamp    string      yes         parseable date-time selected by the emitter
processed    boolean     yes         literal true or false
data         string      yes         additional context; may be empty
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

it is never inferred from the filename. provide it explicitly or set
`MENTIKO_AGENT_ID` when using `mentiko emit`.

run_id

which run owns this event. the runner exports it for in-run emission. an empty
value is permitted for intentional pre-run ingress; diagnostic events require a
non-empty run id.

timestamp

when the event was emitted.

the typed emitter supplies the timestamp. consumers do not fall back to file
modification time.

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
  "prompt": "When done:\n1. Run: mentiko emit research-complete researcher 'findings written to workspace/research/findings.md'\n2. Output AGENT_COMPLETE"
}
```

from spec file (.agent.md):

```yaml
playbooks:
  3-emit-event:
    - run: mentiko emit research-complete researcher "findings written to workspace/research/findings.md"
    - output AGENT_COMPLETE
```

programmatic emission:

```bash
mentiko emit research-complete researcher "findings written to workspace/research/findings.md"
```

do not hand-write `.event` files. the command routes through the canonical typed
emitter and inherits the configured event root and active run id.

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
the monitor observes completion evidence; it does not create successful handoff
evidence on the agent's behalf.

when agent completes:
  1. monitor detects authoritative completion evidence
  2. completion matches the strict event by declared name, agent, and run id
  3. if the declared event is missing, the agent/run fails closed
  4. a diagnostic agent-error may be emitted, but it never satisfies the success
     handoff matcher and no downstream route launches

the narrow core-generation backstop may import a compatible run/attempt-scoped
generation payload. it still does not fabricate the declared event.

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

the configured root is `{runtimeRoot}/events`. use the CLI to inspect it instead
of assuming a workspace-relative `agents/events/` directory.

manual event emission:
```bash
mentiko emit --scope ingress custom-event operator
```

Normal agent emission defaults to run scope and requires `MENTIKO_RUN_ID` or
`RUN_ID`. Runless ingress is never inferred; request it explicitly as above.

event not triggering?

1. check spelling (triggers are case-insensitive but must match otherwise)
2. verify agent has matching trigger
3. verify all six canonical fields exist exactly once
4. verify source and run_id match the intended owner
5. check `processed: false` and the chain-watcher handled marker state

malformed files are rejected rather than partially normalized.

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

event files created under `{runtimeRoot}/events/`:
```
events/
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
   use scoped lifecycle operations; never sweep another run's or sibling's events

10. monitor event processing
   use `mentiko events --unprocessed` and inspect handled-marker state

next: web-ui-guide.md
