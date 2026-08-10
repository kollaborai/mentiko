# Graph Execution Requirements

status: proposed roadmap requirement set  
last updated: 2026-08-01  
scope: requirements only; this is not an implementation architecture spec

## purpose

Mentiko needs a graph-execution capability that makes a workflow's declared
topology, actual runtime path, and recovery state agree. The capability must
extend the typed runner-v2 contract and the existing event-driven chain model.
It must not create a second shell-owned execution engine or require Mentiko to
adopt an external workflow vendor.

This document states what the capability must guarantee. It intentionally does
not prescribe module boundaries, storage technology, database schema, UI
composition, or a vendor implementation.

## problem statement

Mentiko already supports JSON chains, event triggers, conditional branches,
fan-out/fan-in, retries, PTY-backed agents, file events, `run.json`, typed
`AgentAttempt` state, and a durable external-effect outbox. The current model
still has a split between declared chain topology and runtime facts. In
particular, mutually exclusive branches cannot be joined correctly from static
`emits` declarations alone because the runtime does not yet persist and pass
the actually fired event set into every routing decision.

The graph capability must close that gap without losing Mentiko's useful
properties: local-first operation, readable artifacts, isolated PTY sessions,
event-driven adaptation, and fail-closed runtime truth.

## hypothesis

The right abstraction is a three-part contract:

1. a versioned graph definition describes what may happen;
2. a durable execution ledger records what did happen; and
3. a durable frontier identifies what may happen next.

If those three surfaces are authoritative and correlated by stable run,
occurrence, event, attempt, and effect identities, Mentiko can support
conditional graphs, recovery, inspection, replay, and human waits without
pretending that PTY liveness or static chain declarations are execution truth.

## research-derived decisions

The requirements incorporate these patterns from current systems:

- LangGraph treats checkpointed graph state as the basis for fault tolerance,
  human interruption, time travel, and forked runs. Its persistence model also
  preserves successful parallel writes when another node in the same step
  fails.
- Temporal treats ordered event history as the source of truth, replays control
  decisions, isolates external work behind activity boundaries, and requires
  explicit versioning for long-running executions.
- Restate uses a log-first durability boundary for steps, state, timers,
  promises, and effects; idempotency keys and fencing prevent duplicate or
  stale attempts from becoming authoritative.
- State-machine systems make choice, wait, map, parallel, retry, and catch
  behavior explicit instead of leaving it implicit in an edge or status field.
- OpenTelemetry's semantic-convention model supports a common vocabulary for
  spans, events, metrics, and resource identity without putting high-cardinality
  payloads into metric names.

These are requirements inputs, not a decision to embed LangGraph, Temporal,
Restate, Step Functions, or any other external runtime.

Current Mentiko grounding:

- [runner-v2 architecture](../RUNNER_V2_ARCHITECTURE.md) — typed ownership,
  attempts, routing, effects, recovery, and the known OR-merge gap;
- [chain schema](../../lib/schemas/chain.schema.json) — current chain fields
  and generated-chain contract;
- [orchestration reference](./README.md) — event files, run records,
  fan-out/fan-in, retries, and watcher/watchdog ownership.

## terminology

- graph definition: the immutable, versioned declaration of nodes, edges,
  policies, contracts, and graph metadata.
- graph run: one execution instance of one exact graph-definition version.
- node occurrence: one logical visit to a node in a graph run. A loop visit,
  fan-out item, or dynamic expansion must have a distinct occurrence identity.
- attempt: one physical execution attempt for one node occurrence. Retries are
  new attempts, not new logical occurrences.
- transition: a recorded movement or decision between graph states, including
  an event-triggered route, a join decision, a wait, a retry, or a terminal
  outcome.
- event ledger: the ordered, durable record of accepted ingress, emitted
  events, consumed events, transition decisions, and their provenance.
- frontier: the durable set of node occurrences that are eligible, blocked,
  waiting, retrying, or otherwise actionable next.
- checkpoint: a durable recovery boundary containing enough state to resume a
  graph run without guessing from process output or array order.
- external effect: any notification, webhook, plugin, task mutation, API call,
  file mutation outside the run's owned artifacts, or other action whose
  result is not committed atomically with local graph state.

## requirement language

`MUST` is a release-blocking requirement. `SHOULD` is required unless a written
trade-off rejects it. `MAY` is optional scope that must not weaken a `MUST`.

## requirements

### graph definition and compatibility

#### GE-001 — stable graph identity (MUST)

Every graph definition MUST have a stable graph identifier, human-readable
name, explicit version, immutable content digest, and source/provenance
metadata. Two definitions with different execution semantics MUST NOT share a
content identity.

#### GE-002 — explicit node contract (MUST)

Every node MUST declare a stable node identifier, executor capability, accepted
input contract, produced output/artifact contract, timeout policy, retry
policy, and authorization/approval class. A node identifier MUST NOT be reused
for two different logical nodes in the same definition.

#### GE-003 — explicit edge semantics (MUST)

Every edge MUST declare its control meaning. Supported meanings MUST include,
at minimum, unconditional transition, event transition, conditional
transition, join, error route, timeout route, loop transition, and wait/resume
transition. A runtime MUST NOT infer an AND join, OR join, loop, or error route
from a plain string or from a node's static `emits` field.

#### GE-004 — graph termination (MUST)

The definition MUST identify valid start and terminal behavior. Validation MUST
reject graphs that can reach neither a terminal state nor an explicitly
bounded wait, and MUST distinguish a deliberate infinite service from an
accidental cycle.

#### GE-005 — current-chain compiler (MUST)

Existing Mentiko `chain.json` definitions MUST compile into the graph contract
without silently changing their meaning. The compiler MUST preserve, or emit a
diagnostic for, current `triggers`, `emits`, `branches`, fan-out/fan-in,
`on_error`, `on_timeout`, retry, schedule, webhook, and chain-completion
behavior.

The compiler MAY derive explicit graph edges from legacy fields, but the
compiled result MUST make the derived semantics inspectable and testable.

#### GE-006 — machine-readable validation (MUST)

Graph validation MUST reject or clearly classify:

- duplicate node or edge identifiers;
- unknown node, event, artifact, or handler references;
- malformed branch, join, retry, timeout, or wait policies;
- unreachable nodes and unresolvable terminal paths;
- ambiguous joins, especially OR/AND ambiguity;
- unbounded cycles without an explicit loop policy;
- incompatible input/output contracts;
- unsupported executor capabilities;
- generated graphs that violate the generated-chain delivery contract.

Validation results MUST include stable error codes, locations, and actionable
messages. An invalid graph MUST NOT start a run.

### run identity and runtime truth

#### GE-010 — definition pinning (MUST)

A graph run MUST pin the exact graph-definition version and digest at run
creation. Later edits MUST NOT silently change the behavior of an in-flight
run.

#### GE-011 — occurrence and attempt identity (MUST)

Every node occurrence MUST be uniquely identified by graph run, node, logical
visit, and any fan-out item or expansion key. Every physical attempt MUST have
its own stable attempt identity and provenance. A retry MUST NOT overwrite the
identity or terminal reason of the previous attempt.

#### GE-012 — actual transition ledger (MUST)

The runtime MUST durably record the actual event or condition that caused each
accepted transition, including run identity, source occurrence, target
occurrence, event identity, timestamp, graph digest, and causal parent.
Static `emits` declarations MAY describe possible outcomes, but MUST NOT be
used as proof that an outcome happened.

#### GE-013 — durable frontier (MUST)

The current actionable frontier MUST be durable and queryable. It MUST include
at least eligible, running, waiting, retrying, blocked, terminal, and
unknown/reconciliation-required states. A restart MUST recover the frontier
from durable state rather than choosing the first pending array entry.

#### GE-014 — strict event ownership (MUST)

Lifecycle, completion, handoff, timeout, recovery, and watchdog events MUST be
bound to a non-empty graph-run identity. Explicit pre-run ingress MAY be
global, but it MUST be distinguishable from an in-run lifecycle event. An event
from another run, another graph, or an invalid physical file MUST NOT complete
or route the current run.

#### GE-015 — evidence hierarchy (MUST)

Graph status MUST be derived from durable run state, validated events,
accepted attempts, artifacts, and effect receipts. PTY existence, terminal text,
process liveness, UI labels, and tracker state MAY be supporting evidence but
MUST NOT independently prove readiness, completion, delivery, or success.

### planning, routing, and joins

#### GE-020 — authoritative frontier planning (MUST)

Every routing decision MUST evaluate the graph definition, actual transition
ledger, durable node/attempt state, policies, and active claims. The planner
MUST return the reason a node is eligible, blocked, skipped, or waiting.

#### GE-021 — explicit join policy (MUST)

Each join MUST declare whether it waits for all required predecessors, any
eligible predecessor, a quorum, first success, first terminal outcome, or an
explicit custom policy. The runtime MUST distinguish mutually exclusive
branches from concurrent required branches.

#### GE-022 — OR-merge correctness (MUST)

For a diamond or equivalent mutually exclusive branch, the join MUST become
eligible when the actually fired branch satisfies the declared policy. It MUST
NOT deadlock waiting for an untaken branch and MUST NOT launch the join twice
when duplicate branch events arrive.

#### GE-023 — fan-out/fan-in durability (MUST)

Fan-out expansion MUST record the complete member set or an explicit expansion
cursor before dependent fan-in evaluation. Partial branch completion MUST
survive a worker or process crash. A completed member MUST NOT be rerun solely
because another member failed or the join process restarted.

#### GE-024 — dynamic expansion (SHOULD)

The graph model SHOULD support runtime expansion over a bounded set of items.
Each expanded item MUST receive a stable occurrence identity, inherit the
parent's graph-run and policy context, and be visible in the frontier and
lineage. Zero-item expansion MUST have an explicit result rather than hanging.

#### GE-025 — loop semantics (MUST)

A loop MUST declare its re-entry condition, visit identity, maximum visits or
other termination budget, and behavior when the budget is exhausted. A later
visit to a completed node MUST be distinguishable from a duplicate completion
of the earlier visit.

#### GE-026 — deterministic control decisions (MUST)

Given the same graph-definition digest, ordered ledger, inputs, and policy
versions, the planner MUST produce the same control decision. LLM output,
terminal output, wall-clock time, random values, and external responses MUST
be recorded as inputs/results or isolated behind an effect boundary before they
can influence replay.

#### GE-027 — concurrency claims (MUST)

Only one live claim MAY own a node occurrence's dispatch decision at a time.
Claims MUST expire or reconcile safely. Multiple planner or watcher processes
MUST converge on one outcome without double-launching a node or consuming an
event twice.

### durability and recovery

#### GE-030 — durable recovery boundary (MUST)

The runtime MUST persist enough information to recover a graph run after a
worker crash, process crash, host restart, or watcher restart. The recovery
boundary MUST include the graph digest, frontier, transition/event identities,
node occurrences, attempts, waits/timers, claims, artifact references, and
external-effect states.

#### GE-031 — completed-work preservation (MUST)

Recovery MUST NOT rerun a node occurrence whose completion evidence and local
state commit are already durable. When parallel work partially completes, the
successful records MUST remain available to the join after recovery.

#### GE-032 — dispatch ambiguity (MUST)

If the runtime cannot prove whether a target was launched, it MUST record an
explicit `delivery_unknown` or equivalent reconciliation state. It MUST NOT
report delivery, completion, or event consumption merely because a child
process was requested.

#### GE-033 — acceptance before consumption (MUST)

For event-driven routing, the parent event or transition MUST remain recoverable
until the target's durable acceptance is proven. Acceptance MUST include the
target occurrence, run identity, attempt/session evidence, and an actionable
running or blocked state. Replay of an accepted target MUST suppress a second
launch.

#### GE-034 — stale-attempt fencing (MUST)

Late completion, timeout, heartbeat, or effect messages from a superseded
attempt MUST be rejected or recorded as stale. A stale message MUST NOT mutate
the current occurrence, frontier, graph-run terminal state, or effect result.

#### GE-035 — artifact references (MUST)

Large prompts, transcripts, model outputs, files, and generated artifacts MUST
remain in the existing artifact/file surfaces or an explicit blob store. The
execution ledger MUST carry bounded metadata and stable references, not
unbounded payloads. Secrets and raw credentials MUST never be copied into the
ledger, telemetry attributes, or graph definition.

### failures, retries, and external effects

#### GE-040 — failure taxonomy (MUST)

The runtime MUST distinguish at least retryable failure, permanent failure,
startup failure, readiness failure, blocked/human action, timeout, canceled,
stale, and delivery/effect-unknown outcomes. A generic `failed` label MUST NOT
erase the reason needed for recovery or human action.

#### GE-041 — bounded retry policy (MUST)

Every retryable node or effect MUST have a bounded retry policy with maximum
attempts, delay/backoff, timeout, and exhaustion behavior. Retry decisions MUST
be durable and auditable. Retry exhaustion MUST route, stop, or wait according
to explicit graph policy.

#### GE-042 — stable effect identity (MUST)

Every external effect MUST have a stable idempotency key tied to its logical
occurrence, not only its process attempt. The effect lifecycle MUST expose
pending, dispatching, dispatched/succeeded, failed, and unknown states with
timestamps and provenance.

#### GE-043 — honest delivery semantics (MUST)

The runtime MUST state whether each effect is locally atomic, deduplicated,
at-least-once, at-most-once, or unknown. External systems that do not share a
transaction with Mentiko MUST be treated as at-least-once or unknown unless
they acknowledge and enforce the supplied idempotency key. The product MUST
NOT claim universal exactly-once external side effects.

#### GE-044 — event idempotency (MUST)

Emission, matching, claim, consumption, and archival of an event MUST be
idempotent by event identity plus occurrence/consumer identity. Duplicate,
late, malformed, and cross-run events MUST be observable and harmless.

#### GE-045 — cancellation and cleanup (MUST)

Canceling or terminating a graph run MUST have distinct semantics from failure
and pause. The runtime MUST record the request, stop or release owned work
according to executor capability, preserve evidence, and prevent late work from
reviving the run. Cleanup failures MUST remain visible and retryable.

### waits, human gates, and time

#### GE-050 — durable waits (MUST)

The runtime MUST support durable waiting for at least a human decision, an
external event/webhook, and a timer/deadline. A wait MUST survive process and
worker restarts without polling a terminal surface as its source of truth.

#### GE-051 — resumable human gates (MUST)

A human gate MUST expose a versioned, bounded, redacted request payload,
allowed decisions, owner/authorization context, and a stable resume identity.
Resume, reject, edit, and cancel operations MUST be idempotent and MUST record
the resulting transition.

#### GE-052 — time semantics (MUST)

The graph MUST distinguish node timeout, attempt timeout, wait deadline, graph
run timeout, and scheduler delay. Time-based decisions MUST record the clock
value or timer identity used so recovery does not silently reinterpret a past
deadline.

### versioning, replay, and migration

#### GE-060 — in-flight version safety (MUST)

Existing graph runs MUST continue against their pinned definition and policy
versions unless an explicit migration operation is invoked. A new definition
MUST apply only to new runs by default.

#### GE-061 — migration eligibility (SHOULD)

The system SHOULD be able to report whether an in-flight run can migrate to a
new graph version. An unsafe migration MUST be rejected with a reason rather
than silently changing future routing.

#### GE-062 — replay and fork (SHOULD)

Operators SHOULD be able to inspect a prior checkpoint, replay control
decisions without repeating external effects, and fork a new run from a
checkpoint with explicit input changes. The original run and ledger MUST remain
immutable.

#### GE-063 — legacy compatibility (MUST)

Existing chain runs, event files, `run.json` records, artifacts, and task links
MUST remain inspectable during migration. A graph rollout MUST provide a
clear compatibility result for chains that cannot be compiled losslessly.

### observability and operator truth

#### GE-070 — declared and actual topology (MUST)

The operator view MUST distinguish the declared graph from the actual path
taken by a specific run. It MUST show untaken branches, skipped nodes, waiting
nodes, retries, failures, and current frontier state rather than collapsing
them into one generic status.

#### GE-071 — causal lineage (MUST)

An operator MUST be able to trace ingress -> event/condition -> transition ->
node occurrence -> attempt -> artifact/effect -> terminal outcome. Every link
MUST carry stable IDs and enough timestamps/provenance to explain why the next
node was or was not selected.

#### GE-072 — blocker explanation (MUST)

For every non-terminal frontier item, the runtime MUST expose a machine-readable
and human-readable reason: waiting on a predecessor, join policy, lease,
capacity, timer, human input, retry delay, missing evidence, external effect,
or reconciliation.

#### GE-073 — bounded telemetry (SHOULD)

Graph, run, node, occurrence, attempt, event, and effect telemetry SHOULD use
consistent semantic names and low-cardinality attributes. High-cardinality
payloads, prompts, transcripts, and secrets MUST remain references or redacted
artifacts.

#### GE-074 — truth-preserving status (MUST)

UI, CLI, API, logs, and summaries MUST derive status from the same durable
execution state. A status such as `running`, `ready`, `delivered`, `complete`,
or `healthy` MUST have a documented evidence rule and MUST not be decorative.

### security, capacity, and execution boundaries

#### GE-080 — namespace and workspace boundaries (MUST)

Graph definitions, runs, artifacts, events, secrets, and effects MUST resolve
through Mentiko's namespace/organization/project hierarchy. A graph run MUST
not read or write another tenant, organization, project, or workspace unless
the graph explicitly declares an authorized capability.

#### GE-081 — executor independence (MUST)

Graph semantics MUST not depend on PTY text rendering. PTY, direct process,
SSH, Docker, and future executors MUST report typed attempt evidence through a
common boundary. The graph runtime MUST remain usable in Mentiko's local-first
mode without requiring a hosted workflow service.

#### GE-082 — capacity and backpressure (MUST)

Fan-out, dynamic expansion, retries, and cross-chain triggers MUST respect
durable concurrency limits, quotas, and backpressure. A capacity block MUST be
distinguishable from readiness, authorization, human-action, and graph-invalid
states.

#### GE-083 — safe deletion and retention (SHOULD)

Retention and deletion policies SHOULD distinguish active runs, terminal runs,
audit evidence, artifacts, checkpoints, and secrets. Deleting a display record
MUST NOT silently destroy the evidence needed to reconcile an active effect or
prove a terminal outcome.

### migration and verification

#### GE-090 — one lifecycle owner (MUST)

The graph capability MUST have one authoritative typed lifecycle owner. It MUST
not add a second watcher, watchdog, shell parser, or fallback engine beside
runner-v2. Compatibility boundaries may invoke typed primitives but may not
own graph state or routing decisions.

#### GE-091 — parity before behavior change (MUST)

Before graph execution becomes the default path, Mentiko MUST prove parity for
linear chains, event-triggered chains, retries, fan-out/fan-in, error routing,
schedules, cross-chain triggers, and task-linked runs. Unsupported semantics
MUST fail closed with an explicit diagnostic.

#### GE-092 — conformance suite (MUST)

The requirements MUST be enforced by a conformance suite covering definition
validation, compilation, routing, event ownership, attempts, checkpoints,
effect claims, reconciliation, and status projections. Tests MUST exercise the
producer -> physical artifact -> validator -> reducer -> side-effect path, not
only already-hydrated in-memory state.

#### GE-093 — crash-injection suite (MUST)

The suite MUST inject failure at every durable boundary that can create
ambiguity, including before and after event claim, before and after target
launch, before and after checkpoint, before and after effect dispatch, during
fan-in, during wait resume, and during cleanup. Each scenario MUST converge to
one truthful state after reconciliation.

#### GE-094 — acceptance evidence (MUST)

Release evidence MUST include focused tests, type checks, a fresh local runtime
run, inspected run/event/artifact/effect records, and a regression sweep of
existing runner-v2 paths. Committed proof snapshots MUST not substitute for a
fresh runtime proof.

## acceptance scenarios

The following scenarios are release gates, not illustrative examples.

### A. linear compatibility

Given a current two-agent chain with one event trigger, when it is compiled and
run, the graph path, event file, `run.json`, `AgentAttempt` records, artifacts,
and terminal summary MUST agree. A restart after the first completion MUST
continue with the second agent exactly once.

### B. mutually exclusive diamond

Given `investigator -> remover OR repointer -> verifier`, when only `remover`
emits its branch event, `verifier` MUST become eligible once, and the run MUST
not wait for `repointer`. The same run MUST remain correct if the branch event
is duplicated or arrives after a watcher restart.

### C. parallel fan-out crash

Given a fan-out to three members with an all-join, when one member completes and
the worker crashes before the other two finish, recovery MUST preserve the
completed member, relaunch only missing work, and trigger the join once after
all required members complete.

### D. ambiguous launch

Given a parent completion whose child process may have started before the
launcher died, the run MUST enter `delivery_unknown` or reconciliation rather
than consuming the parent event and reporting delivery. Reconciliation MUST
either prove the accepted target or produce a bounded retry/terminal outcome.

### E. side effect crash window

Given a webhook or plugin dispatch that succeeds remotely before Mentiko writes
its local receipt, recovery MUST retry with the same idempotency key and expose
the effect as at-least-once/unknown until the receiver or operator resolves it.

### F. human gate

Given a graph waiting for approval, the wait MUST survive process restart and
remain visible with its request payload and allowed actions. A repeated approve
request MUST not launch the next node twice; reject, edit, timeout, and cancel
MUST have distinct recorded outcomes.

### G. loop re-entry

Given a node that may revisit itself up to three times, the second successful
visit MUST be a new occurrence, while a duplicate completion for the first
visit MUST remain a duplicate. The fourth visit MUST be rejected or routed by
the declared exhaustion policy.

### H. graph version change

Given a run started on graph digest A, when graph digest B is published, the
existing run MUST continue using A. A new run MUST use B. An explicit migration
request MUST produce an eligibility decision before changing any frontier item.

### I. late and cross-run events

Given a late completion event from a superseded attempt or another run, the
runtime MUST record it as stale/foreign and MUST NOT mutate current completion,
routing, fan-in, or task outcome state.

### J. dynamic expansion limits

Given a runtime expansion over zero, one, and many items, zero MUST complete by
declared policy, one MUST produce one stable occurrence, and many MUST obey
concurrency/backpressure limits. A crash during expansion MUST not lose or
duplicate an item.

### K. cancellation and cleanup

Given a run with active parallel attempts, cancellation MUST stop or release
owned work according to executor capability, preserve evidence, prevent late
completion from reviving the run, and expose any cleanup failure for retry.

## non-goals and guardrails

- This is not a GraphRAG, knowledge-graph, or vector-retrieval requirement.
- This does not require replacing agents, prompts, models, or artifact formats.
- This does not require replacing pty-manager; PTY remains one executor boundary.
- This does not commit Mentiko to Temporal, Restate, LangGraph, Step Functions,
  Airflow, or another external runtime.
- This does not promise exactly-once behavior for arbitrary external systems.
- This does not make a visual graph editor the first deliverable.
- This does not allow UI state, issue state, process liveness, or terminal text
  to become a substitute for durable execution evidence.
- This does not permit a second shell-owned watcher, watchdog, parser, or
  routing engine during migration.

## phased release gates

### phase 0 — contract and compatibility

Deliver the graph-definition contract, chain compiler, validator, graph digest,
run pinning, and read-only topology projection. No new runtime behavior is
allowed to become default in this phase.

Exit gate: current chains compile or fail with explicit diagnostics; invalid
graphs cannot start; the existing runner-v2 test and runtime proof remains
green.

### phase 1 — durable routing core

Deliver the actual transition ledger, durable frontier, explicit join policies,
OR-merge correctness, fan-out/fan-in recovery, occurrence identity, claims,
and launch-acceptance/reconciliation semantics.

Exit gate: scenarios A-D, I, and K pass with crash injection and fresh runtime
evidence.

### phase 2 — effects, waits, and bounded control

Deliver durable human/external/timer waits, retry and failure taxonomy,
idempotent effect receipts, dynamic expansion, loop budgets, and cancellation.

Exit gate: scenarios E-G and J pass without false delivery, duplicate launch,
or unbounded growth.

### phase 3 — versioning, replay, and operator surface

Deliver graph-version safety, migration eligibility, declared-vs-actual
topology, causal lineage, blocker explanations, checkpoint inspection, and
forked replay that never mutates the original run.

Exit gate: scenario H passes; operators can explain every frontier decision
from durable records alone.

### phase 4 — default rollout

Make graph execution the default only after parity across all supported
producers and consumers, live proof in local-first mode, and a documented
rollback path. Unsupported workspace or executor capabilities MUST remain
fail-closed and visible.

## research basis

Primary sources consulted on 2026-08-01:

- [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence)
  — checkpoints, thread-scoped state, fault tolerance, and preserved pending
  writes for partial parallel progress.
- [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)
  — durable human pauses, stable resume identity, and serialized interrupt
  payloads.
- [LangGraph time travel](https://docs.langchain.com/oss/python/langgraph/use-time-travel)
  — replay and fork from prior checkpoints without rerunning earlier nodes.
- [Temporal workflow execution](https://docs.temporal.io/workflow-execution)
  — durable execution, replay, workflow/run identity, open/closed states, and
  recorded state transitions.
- [Temporal workflow replay model](https://docs.temporal.io/workflows)
  — ordered event history as source of truth, deterministic control decisions,
  and isolation of external calls behind activities.
- [Temporal TypeScript versioning](https://docs.temporal.io/develop/typescript/workflows/versioning)
  — safe evolution of long-running workflow definitions.
- [Restate architecture](https://docs.restate.dev/references/architecture)
  — log-first durability, idempotency, committed step results, and fencing of
  superseded attempts.
- [Restate workflows](https://docs.restate.dev/tour/workflows)
  — durable promises, timers, loops, conditionals, and parallel operations.
- [AWS Step Functions state machines](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-statemachines.html)
  — explicit task, choice, wait, map, parallel, execution, and redrive
  concepts.
- [AWS Step Functions parallel state](https://docs.aws.amazon.com/step-functions/latest/dg/state-parallel.html)
  — branch output, join behavior, retry/catch policy, and the distinction
  between workflow failure and stopping external workers.
- [OpenTelemetry semantic conventions](https://opentelemetry.io/docs/specs/semconv/)
  — stable cross-signal naming and bounded attributes for observability.

## iteration record

This requirements set was refined through five passes:

1. **Iteration 1 — capability inventory:** identified graph definition,
   routing, state, recovery, effects, waits, versioning, observability,
   migration, and conformance as separate requirement families.
2. **Iteration 2 — Mentiko grounding:** mapped the families to `chain.json`,
   `run.json`, `.event` files, `AgentAttempt`, typed routing, fan groups,
   external effects, and the documented OR-merge gap.
3. **Iteration 3 — external pattern synthesis:** added checkpoint/pending-write,
   event-history, log-first, fencing, explicit state-machine, and telemetry
   requirements from the primary sources above.
4. **Iteration 4 — adversarial review:** added crash windows, duplicate and
   late events, delivery unknowns, loop identity, version drift, waits,
   cancellation, dynamic expansion, stale claims, and payload/security limits.
5. **Iteration 5 — scope and quality pass:** converted the draft to testable
   MUST/SHOULD requirements, separated phases from implementation design,
   removed universal exactly-once claims, and aligned sequencing with the
   runner-v2 go-live priority.
