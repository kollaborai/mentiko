# Database-backed lifecycle specification

Status: proposed implementation contract.
Date: 2026-09-05.
Source baseline: 6389fab on main.
Scope: the public Mentiko platform.

This document specifies the agreed task, workflow, step, run and event model.
It does not claim that the database migration or runtime changes are implemented.
Existing behavior remains authoritative until a namespace completes the cutover
defined below.

## 1. Objective and decisions

Mentiko must answer, from durable records:

- What outcome is this task trying to achieve?
- Which steps are complete, running, eligible or waiting, and why?
- Which execution attempt produced each result?
- Who can act next: a worker, a human or an explicitly authorized AI?
- What evidence caused a transition, and what happens after a restart?

The invariant is:

~~~text
current state + validated event + applicable policy
  -> next state + commands to execute
~~~

The selected design is:

1. Store authoritative lifecycle state in the existing namespace SQLite database.
2. Separate tasks, workflow instances, step occurrences, runs and events.
3. Preserve agent attempts beneath runs; a chain run can contain many agents.
4. Store state changes, accepted events and resulting commands atomically.
5. Keep artifacts and transcripts on disk, with verified references in the database.
6. Route manual actions, automation and external triggers through the same
   authorization, transition and launch contracts.
7. Keep the existing typed runner, PTY manager, monitor and worker boundaries.
   Extend the current lifecycle reducer and storage adapters.

This work does not introduce another container, a generic workflow platform,
an arbitrary-code workflow DSL or an event-sourcing requirement to rebuild all
current state by replaying history. Database rows describe current state; events
explain its history. Historical imports will not have a complete original event log.

## 2. Terms and ownership

### Task

A task is a requested outcome with acceptance criteria, business status,
dependencies and ownership. Preserve existing task IDs and task relationships.
A task may have several workflow instances over its lifetime.

A successful run does not automatically close its task. Closure requires an
accepted outcome evaluation or an explicit authorized manual close.

### Workflow instance

A workflow instance is one execution of a versioned lifecycle definition.
It records progress across steps, waits, decisions and retries.

The subject task is optional: task generation occurs before its output tasks
exist. A decision workflow can be linked to a subject task and a decision record.
An ad hoc chain run can belong to a workflow without a task.

Task generation creates tasks with source-run and output-item provenance.
Generation, task fulfillment and decision resolution are linked workflows, not
one task record with an ever-growing status string.

### Step occurrence

A step is a logical action: analyze a task, select a chain, execute a chain,
evaluate an outcome, select an option or apply a selection.

A definition's step can be visited repeatedly. Each visit is a distinct
occurrence, identified by workflow, step key, visit number and expansion key.
Retries of the same action belong to that occurrence; revised inputs or another
logical pass create a new occurrence.

A step has dependencies, an input contract, completion evidence, an actor policy,
a retry policy and explicit next-step rules. A human action can complete a step
without an agent run. A deterministic handler can also complete a step without
pretending to be an agent.

### Run and agent attempt

A run is an execution attempt of an automated step. It may execute a chain
containing several agent attempts. An ad hoc execution receives an explicit
execute-chain step so it follows the same lifecycle contract.

Distinguish:

- Redelivery of a launch command: the same run and launch identity.
- Retrying a failed step: a new run with an incremented attempt number.
- Retrying one agent inside a chain: a new AgentAttempt inside the same run,
  governed by the existing runner contract.
- Repeating work with changed inputs: a new step occurrence.

Preserve the typed AgentAttempt phases, instruction receipts, PTY identity,
workspace baseline, routing, join and cleanup semantics. Workflow steps are
above chain nodes; do not create a second scheduler for the chain's internal graph.

### Event and command

An event records an observed or accepted fact. A command requests an action.
For example, run.completed is a fact; start_outcome_summary is a command.

Appending an observation does not make it valid completion evidence. Only the
transition service can accept it into lifecycle state after validating identity,
scope, evidence and the current revision.

Events are append-only. Delivery state belongs to commands, not a shared
processed flag on an event. Multiple consumers may act on the same event through
separate, deduplicated commands.
If validation happens after receipt, append a separate acceptance or rejection
event referring to the observation; do not rewrite the original event.

## 3. Keep independent dimensions separate

Every step occurrence records these dimensions separately:

~~~text
kind:           select_chain
status:         waiting
actor_policy:   human
waiting_reason: selection_required
trigger_kind:   webhook
~~~

- Kind says what work is required.
- Status says where that work stands.
- Actor policy says who may perform or resolve it.
- Trigger provenance says why this workflow was requested.
- Waiting reason says what specifically must change before progress is possible.

Use stable machine identifiers and consistent human-readable labels.
Do not encode combinations such as manual_webhook_chain_selection as new statuses.
Workflow status summarizes its durable frontier; one current-phase string is
insufficient when multiple steps are active.

Step statuses:

~~~text
pending -> ready -> running -> succeeded
                    |    |
                    |    +-> waiting -> ready or running
                    +------> ready              (permitted retry)
                    +------> failed             (no retry remains)

pending or ready -> skipped                     (validated branch/bypass)
nonterminal -> cancelled                       (cancellation settled)
~~~

An interactive step enters waiting directly when its dependencies are satisfied.
Authorized input completes it through the transition service. Running means a
handler is working; waiting means the required input, capacity or dependency is
absent. Neither means failure.

Workflow statuses are pending, running, waiting, completed, failed and cancelled.
Completed means its required outputs and terminal policy were satisfied; it does
not necessarily mean a linked task was closed.
The persisted frontier is the set of step occurrences and dependency receipts.
The workflow is running while any handler is active or work is ready, waiting
when all unfinished work awaits a named condition, and completed only when its
required terminal outputs are accepted. Failed and cancelled require the
definition's failure/cancellation policy to settle affected active work.

Retain the current runner status vocabulary during the first migration:
pending, running, blocked, completed, failed, stopped, cancelled and stalled.
Require a structured reason, retry classification and terminal-evidence reference
alongside it. Never infer retry eligibility from blocked or stopped alone.
Stalled or an unreachable PTY transport is uncertainty, not proof of agent death.
Terminal corrections follow the explicit recovery rule in section 8.

## 4. Required lifecycle definitions

Definitions are registered typed data with validated handler keys, dependency
rules and schemas. Persist the definition version, digest and snapshot on each
workflow instance. Pin policy and selected chain versions as well.

Running instances retain their definition. Unsupported versions block with an
actionable compatibility reason. Intentional upgrades record a migration event;
editing a template does not silently rewrite active instances.

Every registered step contract must declare its input/output schema versions,
handler version, actor policy, dependency conditions, completion validator,
timeout/retry policy and transitions for success, failure, waiting and cancellation.
Conditions are registered typed predicates. Missing schemas, unknown handlers,
unreachable required steps, unbounded automatic cycles and unsupported joins
fail definition validation before dispatch.

### 4.1 Task creation

Manual creation validates and inserts the task, records task.created, and creates
the task-fulfillment workflow in one transaction when requested by its automation
policy. It creates no synthetic agent run. With auto-run off, execution waits for
an explicit action.

Generated creation follows:

~~~text
generation request
  -> generate_tasks                     agent run
  -> validate_and_create_tasks          deterministic import
  -> zero or more task workflows       according to each task's policy
~~~

Each generated output item has a stable output key. Retrying import returns the
same created tasks. A valid empty result is explicit; malformed or missing output
does not count as successful generation.

### 4.2 Task fulfillment

~~~mermaid
flowchart TD
  T["Task created"] --> A["Analyze and recommend"]
  A --> S["Select chain: human or automatic"]
  S --> G{"Generation required?"}
  G -->|Yes| C["Generate and validate chain"]
  G -->|No| E["Execute chain"]
  C --> E
  E --> O["Summarize and evaluate outcome"]
  O -->|Acceptance satisfied| F["Close task"]
  O -->|Retry permitted| E
  O -->|Decision required| D["Linked decision workflow"]
  D --> R["Apply selection and resume or create follow-ups"]
~~~

Required kinds are analyze_task, select_chain, generate_chain, execute_chain,
summarize_outcome and finalize_task. Recommendation is part of analyze_task in
the default definition; it may have internal agent nodes without adding another
top-level lifecycle owner.

An explicitly supplied, authorized and validated chain may bypass analysis and
generation. Persist skipped occurrences and the bypass reason. Human chain
selection creates no agent run; AI-assisted selection records its run.
Selection of a generated chain binds the validated output and exact version.

Execution failure may take the existing bounded retry path before summary.
Preserve the current default of two execution retries, meaning three execution
attempts total. Analysis/generation retries and command redeliveries do not
consume this execution budget. The summary-requested retry uses the same execution
budget, so alternating failures and summaries cannot reset it.
The execution budget belongs to the fulfillment workflow, not an individual
step visit. Changing the chain, repeating analysis or returning from a decision
does not reset it. Only an explicit authorized new-work or budget-change action
can establish a new budget, with provenance.

Outcome evaluation must cite the source run, accepted result revision,
acceptance-criteria revision and artifact evidence. A summarizer's own successful
run does not establish the original task's success.

Accepted verdicts are close, retry and decision. Missing or contradictory evidence
cannot produce close. The finalizer revalidates the verdict against current inputs.
If the summary step itself fails, use its bounded retry policy, then leave an
actionable failure or decision wait; never close by default.

### 4.3 Decision resolution

~~~text
decision requested
  -> analyze_decision
  -> prepare_options
  -> select_option                     human or authorized AI
  -> prepare_plan
  -> apply_selection
  -> resume parent, create follow-ups, or finish with an explicit outcome
~~~

Existing research, guided questions, guided options and guided plan phases map
to registered steps. Preserve required human steering inputs as explicit waits.
Passive decision tasks remain excluded from ordinary task-execution admission.

The parent waits on the decision's accepted application result, not merely an
options-generation run. Follow-up task dependencies remain explicit. Completion
releases only affected dependency-linked successors; it does not enqueue a
full-organization auto-run scan.

### 4.4 Gates and AI authority

A gate can protect chain selection, execution, external actions or finalization.
Definitions do not add a gate to every step by default.

Gate policy records:

~~~text
actor_policy: human | ai_advisor | ai_decider
allowed_actions and option constraints
delegating actor and authority scope
policy version and revocation reference
advisor profile and optional intent-skill version/digest
attempt budget, deadline and fallback actor
~~~

Human is the default for a decision requiring selection. An AI advisor produces
a recommendation; it does not satisfy the gate. An AI decider can select only
under explicit delegated policy, within the allowed actions and existing
authorization boundary. Using a skill, a high confidence score or an internal
trigger grants no additional authority.

Record alternatives, rationale, evidence and the selecting actor. Selection is
conditional on the current options digest, input revision and unresolved gate
version. Concurrent human and AI selections cannot both win.

Failure, ambiguity or an out-of-policy choice follows the saved fallback policy,
normally a human wait. Policy revocation is checked before selection and before
applying its effects even though the workflow retains its original policy snapshot.
Changed options or intent invalidate an unconsumed selection explicitly.
The definition must also set a finite automatic decision-round budget and
deadline. Exhaustion follows its saved fallback; creating a child decision
workflow cannot silently reset the parent workflow's budget.

### 4.5 Trigger adapters

Manual UI/API, CLI, auto-run, email, external webhook, internal webhook, schedule
and chain-event adapters submit scoped lifecycle commands through the same service.
They authenticate and normalize inputs; they do not own launch or recovery rules.

Idempotency identities are source-specific:

- Manual/API: a request key reused only for retries of the same user action.
- Schedule: schedule identity plus the intended scheduled occurrence time.
- Webhook: authenticated subscription/source plus its stable delivery ID.
- Email: receiving account/mailbox plus the provider's stable message identity.
- Internal event: source event plus target workflow/step occurrence.

When a source has no trustworthy delivery ID, the adapter must expose that
limitation. Identical text or payload hashes alone must not suppress intentional
repeated actions. Reusing an idempotency key with different inputs is a conflict.

## 5. Storage contract

### 5.1 Database boundary

Use the same namespace database currently backing tasks:

~~~text
<globalRoot>/namespaces/<namespaceId>/data/tasks.db
~~~

Extract a shared connection/transaction boundary from the task store. Lifecycle
tables, task mutations, events and commands participating in one transition must
use the same connection and transaction. Keep the existing filename for v1.
Do not place lifecycle rows in the authentication database or a separate database
and claim cross-database atomicity.

Use WAL, foreign keys, bounded busy handling and short write transactions.
The target durability setting is synchronous=FULL. Validate the bundled SQLite
version on supported platforms before rollout. No transaction waits on an LLM,
HTTP call, PTY, filesystem scan or user input.

All direct database writers must be on the same host. Remote execution reports
through authenticated APIs rather than mounting the database. A multi-host writer
deployment requires a separate database decision.
These constraints follow SQLite's [WAL documentation](https://sqlite.org/wal.html)
and [transaction model](https://sqlite.org/lang_transaction.html); the durability
setting follows [synchronous](https://sqlite.org/pragma.html#pragma_synchronous).

### 5.2 Logical records

Each database column has its own row below. These are proposed logical column
names expanded from the field groups in this spec; executable SQL types,
nullability and migration details follow during implementation.

Namespace comes from the selected database and remains explicit on API and
worker command envelopes. Shared columns are listed once and inherited where
applicable. Immutable events use their explicit occurrence and recording times.
The namespace column is an envelope identity even though the v1 database file
already provides the namespace boundary.

#### Shared columns

| Column | Purpose and rules |
| --- | --- |
| `namespace_id` | Namespace identity carried on API and worker envelopes; the selected database is still the storage boundary. |
| `org_id` | Organization scope; present on every organization-owned record. |
| `created_at` | Creation time for mutable records. |
| `updated_at` | Last committed update time for mutable records. |
| `version` | Incrementing revision used for conditional writes to mutable records. |

#### `tasks`

The existing task table retains its current columns and relationships. These are the lifecycle additions and identity relevant to this spec; lifecycle metadata becomes a compatibility projection.

| Column | Purpose and rules |
| --- | --- |
| `id` | Existing task identity; preserve it through migration. |
| `workspace_id` | Authorized workspace scope used by task reads, writes and execution admission. |
| `source_run_id` | Optional run that generated this task. |
| `source_output_key` | Stable output-item key within the generating run; prevents duplicate task creation. |
| `acceptance_criteria_revision` | Revision of the criteria used when evaluating the task's outcome. |
| `active_workflow_id` | Optional link to the current fulfillment workflow. |

#### `workflow_instances`

One execution of a versioned lifecycle definition. Owns progress and budgets across step visits.

| Column | Purpose and rules |
| --- | --- |
| `id` | Workflow instance identity. |
| `kind` | Lifecycle kind, such as task generation, task fulfillment or decision resolution. |
| `definition_version` | Version of the registered lifecycle definition. |
| `definition_digest` | Digest identifying the exact definition. |
| `definition_snapshot` | Definition retained for this instance. |
| `policy_snapshot` | Policy retained for this instance, including authority and fallback rules. |
| `subject_task_id` | Optional task whose outcome this workflow serves. |
| `decision_id` | Optional associated decision record. |
| `parent_workflow_id` | Optional workflow that created this workflow. |
| `parent_step_id` | Optional parent step that requested this workflow. |
| `workspace_id` | Optional authorized workspace association. |
| `authority_epoch` | Ownership epoch checked on every command and transition; changes at a rehearsed cutover or revocation boundary. |
| `status` | Current workflow status. |
| `input_revision` | Revision of the workflow inputs. |
| `input_digest` | Digest of those inputs. |
| `execution_retry_budget` | Maximum execution retries allowed for this fulfillment workflow. |
| `execution_retries_used` | Execution retries already consumed; persists across step visits. |
| `decision_round_budget` | Maximum automatic decision rounds allowed. |
| `decision_rounds_used` | Automatic decision rounds already consumed. |
| `deadline` | Deadline governed by the workflow's saved policy. |
| `trigger_provenance` | Initiating trigger kind, source and occurrence identity. |

#### `workflow_steps`

One occurrence of a logical action. Owns eligibility, waits and accepted output; human and deterministic actions need no synthetic agent run.

| Column | Purpose and rules |
| --- | --- |
| `id` | Step occurrence identity. |
| `workflow_id` | Workflow containing this occurrence. |
| `step_key` | Stable step key in the lifecycle definition. |
| `visit` | Logical visit number for repeated steps. |
| `expansion_key` | Normalized identity for an expanded or parallel item. |
| `kind` | Action kind, such as select_chain or summarize_outcome. |
| `status` | Current step status. |
| `actor_policy` | Who may execute or resolve the step. |
| `trigger_kind` | Provenance dimension for this occurrence, separate from action kind and status. |
| `input_refs` | References to the step's inputs. |
| `input_digest` | Digest binding execution to the accepted inputs. |
| `output_refs` | References to accepted outputs. |
| `output_digest` | Digest binding downstream work to those outputs. |
| `waiting_reason` | Specific condition preventing progress when waiting. |
| `deadline` | Deadline governed by the step's policy. |
| `retry_policy` | Retry conditions and limits for this step kind. |
| `retry_counters` | Durable counters for the applicable step retry categories. |
| `current_run_id` | Optional current execution attempt. |
| `result_revision` | Revision of the accepted step result. |

#### `step_dependencies`

Conditions required before a target occurrence can proceed. Dependency satisfaction is tied to an accepted source-result revision.

| Column | Purpose and rules |
| --- | --- |
| `workflow_id` | Workflow containing the dependency. |
| `source_step_id` | Source step occurrence. |
| `target_step_id` | Dependent step occurrence. |
| `condition` | Registered predicate required for the dependency to be satisfied. |
| `accepted_source_result_revision` | Source-result revision accepted as satisfying this dependency. |
| `join_requirement` | Join rule governing how this dependency combines with other arrivals. |

#### `runs`

One automated execution attempt of a step. A step retry creates another run; run completion alone does not establish task success.

| Column | Purpose and rules |
| --- | --- |
| `id` | Run identity. |
| `step_id` | Step occurrence being executed. |
| `attempt_number` | Attempt number within the step occurrence. |
| `retry_of_run_id` | Optional previous run being retried. |
| `chain_id` | Identity of the selected chain. |
| `chain_version` | Selected chain version. |
| `chain_digest` | Digest of the exact chain executed. |
| `workspace_identity` | Authorized execution workspace identity and target context. |
| `status` | Current runner status, retaining the existing vocabulary during migration. |
| `status_reason` | Structured reason for the current status. |
| `execution_classification` | Evidence-based classification used for terminal and retry decisions. |
| `accepted_result_revision` | Revision of the accepted execution result. |
| `started_at` | Time execution started, when known. |
| `completed_at` | Time the execution settled, when known. |
| `cancel_requested_at` | Time cancellation was requested, when applicable. |
| `cancellation_request` | Cancellation actor, reason and requested scope. |

#### `agent_attempts`

One physical agent attempt inside a run. Preserve the typed runner contract; retries never overwrite previous attempts.

| Column | Purpose and rules |
| --- | --- |
| `id` | Existing typed AgentAttempt identity. |
| `run_id` | Containing run. |
| `node_occurrence_id` | Chain-node occurrence this agent attempt executes. |
| `phase` | Current typed attempt phase. |
| `instruction_receipt` | Durable instruction intent and submission evidence. |
| `pty_daemon_id` | Exact daemon identity used for the attempt. |
| `pty_session_id` | Agent PTY session identity. |
| `monitor_session_id` | Companion monitor session identity. |
| `process_pid` | Recorded process ID, when allocated; not sufficient identity evidence by itself. |
| `workspace_identity` | Attempt workspace, baseline and isolation context from the typed contract. |
| `evidence_refs` | References supporting phase changes, completion and cleanup. |

#### `lifecycle_events`

Append-only observations and accepted lifecycle facts. Later acceptance or rejection references the original observation; delivery state belongs to commands.

| Column | Purpose and rules |
| --- | --- |
| `event_id` | Stable event identity. |
| `sequence` | Monotonic recorded order within the namespace database. |
| `type` | Event type. |
| `schema_version` | Version of the event payload contract. |
| `aggregate_type` | Kind of lifecycle record this event concerns. |
| `aggregate_id` | Identity of that record. |
| `aggregate_version` | Associated record revision, where applicable. |
| `workflow_id` | Optional workflow link; ingress may precede a workflow. |
| `step_id` | Optional step occurrence link. |
| `run_id` | Optional run link; required for in-run lifecycle events. |
| `attempt_id` | Optional agent-attempt link. |
| `actor` | Identity of the actor responsible for the action or observation. |
| `source` | Originating producer or authenticated source. |
| `source_event_id` | Producer's stable occurrence identity, when available. |
| `causation_id` | Event or command that directly caused this event. |
| `correlation_id` | Identity linking related work across the lifecycle. |
| `occurred_at` | Reported occurrence time. |
| `recorded_at` | Time the database recorded the event. |
| `payload` | Validated event data. |
| `evidence_refs` | Evidence associated with the observation or accepted fact. |
| `validation_outcome` | Outcome known when this event was appended; later validation creates another event. |

#### `lifecycle_commands`

Durable requests for work and their delivery state. Workers claim commands through leases; redelivery retains the same semantic action identity.

| Column | Purpose and rules |
| --- | --- |
| `command_id` | Stable command identity. |
| `action_key` | Semantic action key used to deduplicate delivery. |
| `idempotency_key` | Durable request or delivery identity whose replay returns the recorded result; conflicting input under the same key is rejected. |
| `kind` | Registered command handler kind. |
| `principal` | Authenticated actor or worker identity that requested the command. |
| `scope` | Authorization scope evaluated for the command. |
| `authority_epoch` | Ownership/policy epoch required before claim, dispatch and result acceptance. |
| `target_identities` | Typed identities of the target workflow, step, run, attempt or domain record. |
| `expected_input_revision` | Input revision required before the command may apply. |
| `expected_result_revision` | Source-result revision required before the command may apply. |
| `payload` | Validated command inputs. |
| `status` | Current delivery state. |
| `waiting_reason` | Explicit reason for a waiting command, such as `unknown_delivery` or `capacity_unavailable`. |
| `available_at` | Earliest time the command is eligible for delivery. |
| `delivery_count` | Number of delivery attempts, separate from execution retries. |
| `lease_owner` | Current claiming worker, while leased. |
| `lease_generation` | Monotonically increasing ownership generation. |
| `lease_expires_at` | Expiry of the current command lease. |
| `result_ref` | Optional reference to the accepted command result. |
| `last_error` | Most recent delivery or acceptance error. |

#### `workflow_decisions`

A decision gate, its selection and the result of applying it. Selection and authority are bound to the current options and input revisions.

| Column | Purpose and rules |
| --- | --- |
| `id` | Preserved decision identity. |
| `workflow_id` | Decision workflow identity. |
| `gate_step_id` | Step occurrence whose gate this decision resolves. |
| `question_revision` | Revision of the question being decided. |
| `options_revision` | Revision of the available options. |
| `input_revision` | Revision of the decision inputs. |
| `actor_policy` | Human, advisor or delegated decision-making policy. |
| `selection_status` | Pending, accepted, rejected or superseded state for the gate selection. |
| `selection_idempotency_key` | Stable identity for a selection request; replay is inert and conflicting input is rejected. |
| `authority_epoch` | Policy epoch checked before accepting and applying a selection. |
| `selected_option_id` | Optional accepted option selection. |
| `rationale` | Reasoning recorded for the selection. |
| `evidence_refs` | Evidence supporting the recommendation or selection. |
| `source_run_id` | Optional originating analysis or decision run. |
| `application_result` | Accepted result of applying the selection. |
| `lifecycle_payload` | Remaining lifecycle-owned decision data, including question, options and plan content. |

#### `artifact_refs`

Verified references to output stored on disk. Accepted references bind evidence to its producer and immutable bytes.

| Column | Purpose and rules |
| --- | --- |
| `id` | Artifact reference identity. |
| `run_id` | Producing run. |
| `attempt_id` | Optional producing agent attempt. |
| `kind` | Logical artifact kind. |
| `storage_path` | Path relative to the authorized storage root. |
| `digest` | Digest of the accepted artifact bytes. |
| `size_bytes` | Artifact size. |
| `schema_version` | Version of the artifact's payload contract. |
| `validation_result` | Validation outcome recorded when accepting the artifact. |

#### `execution_reservations`

Capacity admission and release for physical execution. Expiry of a command lease does not release a live agent's reservation.

| Column | Purpose and rules |
| --- | --- |
| `run_id` | Run associated with the capacity reservation. |
| `attempt_id` | Agent attempt associated with the reservation, where applicable. |
| `capacity_domain` | Scope and capacity class in which this reservation is counted. |
| `queue_order` | Durable FIFO admission order. |
| `owner` | Owner of the reservation. |
| `generation` | Reservation ownership generation. |
| `status` | Active, released, cancelled or reconciliation_required capacity state. |
| `released_at` | Time the reservation was released after physical execution and cleanup evidence. |
| `admission_evidence` | Evidence supporting admission and allocation. |
| `release_evidence` | Evidence required to release the reservation. |

Keep routing/frontier, fan-in claims, launch jobs and workspace cleanup journals
as validated database-owned runtime records under the existing typed adapters.
Their detailed fields remain governed by runner and graph contracts. They may
start as versioned JSON records, but fields used to claim, admit, deduplicate,
filter or establish ownership need explicit indexed columns and constraints.
Do not retain an authoritative copy in a file after database cutover.

Existing job IDs remain stable through an alias mapping to step/run records.
The job API projects those records; it cannot independently mark execution
successful because it found an artifact.

### 5.3 Required constraints and queries

Enforce:

- Organization-scoped foreign keys for relationships, including task links.
  Add compatible parent unique keys to existing tables where required.
- One active fulfillment workflow per task unless an explicit versioned policy
  allows parallel work.
- Unique step occurrence by workflow, step key, visit and normalized expansion key.
- Unique run attempt number within a step occurrence.
- One unsettled execution run per ordinary step occurrence. Parallel work uses
  explicit occurrences; chain-level agent parallelism stays inside a run.
- Unique generated task by originating run plus output-item key.
- Unique source event identity and unique semantic command action key per org.
- One accepted selection for a gate/options revision.
- Conditional writes against current version and lease generation.

An event with a run link must have a matching workflow, step, organization and
attempt lineage. Explicit ingress events may precede a workflow/run. A missing
run ID cannot be accepted as an in-run completion.

Index the actionable frontier, due commands, expiring leases, active capacity,
task-to-workflow history, step attempts and event timelines. Status-list APIs must
query indexed records rather than scan all run directories.

The namespace sequence orders local recorded events; external occurred_at values
and IDs do not establish causal order. Consumers use causal IDs and revisions.

### 5.4 Artifacts and projections

Finalize and validate an artifact before accepting its reference. The reference
binds its run, attempt, kind, schema, digest and authorized storage root. A crash
after file creation but before database commit leaves an unreferenced artifact
that can be inspected or cleaned later; it must not complete a step.
Accepted artifact bytes are immutable. Revised output gets a new reference and
result revision. Revalidate required references before consuming a result; missing
or changed bytes produce an explicit evidence error.

Transcripts, terminal bytes, generated files and large logs remain on disk.
Do not append an event for every terminal frame or monitor poll. Store meaningful
transitions and diagnostics; coalesce heartbeat observations.

After cutover, run.json, job JSON, decision JSON and lifecycle metadata are
read-only compatibility projections with source version and authority epoch.
A delayed projector cannot overwrite a newer projection. Projection failure is
visible but does not roll back an accepted database transition. Exported state
never becomes an independent input writer.

Canonical runner event emission writes through the database transition/ingress
boundary. Any retained legacy event-file ingress must use one explicit importer
with a durable occurrence receipt, scoped identity validation and loop prevention
for exported events. A filename or content hash alone is not an occurrence ID.
Database unavailability never activates an implicit file-state fallback.

## 6. Transition and delivery protocol

The transition service is the only semantic writer of lifecycle state.
It is a shared library used by authorized processes, not a new network service.
Request handlers translate HTTP; background jobs and CLIs call the service or
its compiled entrypoint with an explicit principal and scope.

For a lifecycle command:

1. Authenticate, authorize and validate its envelope.
2. Begin a short write transaction; load the current scoped state.
3. Check authority epoch, idempotency key, expected version, active attempt,
   input/result revision, policy and evidence references.
4. Run the pure typed reducer/transition rule.
5. Persist state, task/dependency changes, accepted event and resulting commands
   in the same transaction. Reserve run/attempt identity before queuing launch.
6. Commit and return the durable identities and new version.
7. Workers claim due commands and execute external actions outside the transaction.
8. Apply the result through another checked transition.

Duplicate requests return the recorded result. Stale or conflicting inputs return
a typed conflict; missing permission returns an authorization failure. An internal
caller cannot bypass these checks by importing a service.

Commands support queued, leased, waiting, completed, failed and cancelled states.
Waiting includes an explicit reason such as unknown_delivery; it is not a
permission to retry automatically. Lease claims use atomic compare-and-swap and
a monotonically increasing generation. A stale worker cannot commit completion
after another owner acquired the command.

A command lease is not an execution-capacity reservation. Lease expiry does not
prove that its PTY or external action stopped. Renew leases during legitimate
work and validate ownership immediately before dispatch and result acceptance.

Database transitions and command creation are atomic; external effects have
at-least-once delivery with idempotent acceptance where supported. No exactly-once
claim is made for arbitrary external services. Pass stable idempotency keys to
providers that support them. If dispatch may have succeeded but acknowledgement
was lost, reconcile by external identity or wait for review before repeating an
action that cannot safely be repeated.

The event log has no global consumed bit. For asynchronous consumers, derive a
unique command key from event ID, consumer and target occurrence. Side effects,
imports and task propagation each retain their own delivery receipt.

## 7. Restart-safe execution

Persist launch identity and instruction intent before the external operation.
Use deterministic session identities bound to namespace, organization, run and
agent attempt.

On redelivery or restart:

- Reattach to a proven matching live attempt; do not launch a second one.
- If no process was created and exact absence is proven, continue the same
  reserved launch.
- If instructions may already have been submitted, recover the existing attempt
  or wait for review. Do not send the instructions again based on a timeout.
- Release capacity only after terminal/cleanup evidence satisfies the runner
  contract. Worker death alone cannot release an agent's reservation.

Persist cancellation intent separately. Stop new dependent launches immediately,
request exact-session termination, and settle cancellation only after physical
execution and required cleanup have been checked. Late evidence remains in history.
An authorized manual task close records that business action and handles active
execution under this cancellation policy; it does not fabricate a successful run.

Keep existing FIFO capacity, protected workspaces, fan-out/fan-in, routed launch
acceptance and compare-and-swap publication behavior. A stale join arrival,
duplicate event or retry cannot activate a downstream occurrence twice.

## 8. Recovery ownership and outcome integrity

Monitors observe individual attempts. Watchdog and reconcilers discover evidence
or drift. They submit recovery commands to the same transition service; they
do not independently write terminal run/task/decision state.

Recovery classifies at least:

- Matching live execution: repair observation or pointers.
- Completed execution with missing import: replay the import, not the execution.
- Proven absent execution: apply the reason-specific failure/retry policy.
- Unavailable transport or conflicting identity: wait for reconciliation.
- Human/AI gate wait: preserve the wait; age alone does not fail it.

Terminal history is retained. A late authoritative event can correct an erroneous
terminal classification only through an explicit recovery transition that
revalidates the exact attempt, current task claim and dependent results.
Record the prior verdict and correction. If a replacement run, summary, selection
or external action has already consumed the old result, block automatic correction
until the affected outcomes can be invalidated or compensated safely.

A result from an older run cannot complete the current step. A stale summary
cannot close a task with revised criteria. A previous option selection cannot
authorize a plan generated for different options. Summary, gate and import
deduplication keys include the source run and accepted-result/input revision.

Existing errors and retry limits remain visible. Preserve the distinction between
execution retries, generation retries, decision recovery attempts and command
delivery retries. Each has a separate durable counter and a bounded policy.
Default values other than the existing two execution retries are carried forward
from the relevant current handler during migration, not silently reset.

## 9. Operator and API requirements

Existing task, run, job and decision screens/API contracts gain their state from
database-backed adapters. Preserve IDs and compatibility response fields during
migration. Add a workflow inspection representation before redesigning screens.

Every workflow view must show:

- Subject and initiating trigger.
- All current step occurrences and why each is ready, running or waiting.
- Who may act, with an actionable input request where applicable.
- Run attempts, their distinct outcomes and supporting artifacts.
- Retry budget, dependency/decision waits and next eligible steps.
- Chronological accepted transitions, recovery actions and delivery failures.

Display waiting for a human, waiting for capacity, failed and unable to verify
execution distinctly. A process being alive or a generated file existing is not
enough to display completion.

Health separates HTTP liveness from automation readiness. Report worker heartbeat,
oldest due command, blocked deliveries, unresolved execution reservations and
database write failures. A running website cannot imply that automation is ready.

No new public write endpoint accepts arbitrary status assignments. Selection,
retry, cancellation, import and completion remain typed actions validated against
current state. Namespace, organization, workspace and delegated authority apply
to both reads and writes. Event payloads exclude credentials and raw auth tokens.

## 10. Migration and rollback

### 10.1 Repository seams

Current source checked for this specification:

- [Task database and migrations](../../../web/lib/tasks/task-store.ts):
  namespace tasks.db, WAL, foreign keys and busy timeout.
- [Lifecycle types](../../../web/lib/orchestration/task-lifecycle-types.ts),
  [reducer](../../../web/lib/orchestration/task-lifecycle-reducer.ts),
  [service](../../../web/lib/orchestration/task-lifecycle-service.ts) and
  [metadata adapter](../../../web/lib/orchestration/task-lifecycle-metadata.ts):
  existing post-execution transition and effect rules.
- [Web launch](../../../web/lib/runs/chain-run-service.ts),
  [direct runner](../../../web/lib/runner-v2/direct-run.ts),
  [scheduler](../../../web/lib/schedules/scheduler-service.ts),
  [auto-run service](../../../web/lib/runs/auto-run-service.ts) and
  [event watcher](../../../web/lib/runner-v2/chain-watcher-service.ts):
  entry-point convergence.
- [Run state](../../../web/lib/runner-v2/run-state.ts),
  [agent attempts](../../../web/lib/runner-v2/agent-attempt.ts),
  [completion](../../../web/lib/runner-v2/completion-entrypoint.ts),
  [external effects](../../../web/lib/runner-v2/external-effects.ts) and
  [launch jobs](../../../web/lib/runner-v2/launch-job-runner.ts):
  runtime storage and durable delivery.
- [Job records](../../../web/lib/runs/job-record.ts) and
  [job store](../../../web/lib/runs/job-store.ts): file records and status reconciliation.
- [Decision storage](../../../web/lib/decisions/decision-storage.ts),
  [auto-advance](../../../web/lib/decisions/decision-auto-advance.ts) and
  [resolution](../../../web/lib/decisions/decision-resolution.ts): selection, generation,
  import and follow-up ownership.
- [Worker](../../../web/server/background-worker.ts),
  [run reconciler](../../../web/lib/runs/run-reconciler.ts),
  [watchdog](../../../web/lib/runner-v2/watchdog.ts) and
  [task reconcile route](../../../web/app/api/tasks/reconcile/route.ts):
  recovery convergence.

The implementation inventory must also cover task generation/analysis/run/summary
routes, manual creation/close, all guided decision routes, jobs completion, MCP,
email/webhooks, batch runs, generated-chain delivery, compiled CLIs, event readers,
capacity claims, workspace journals, status APIs and UI projections. No remaining
file-based writer may mutate a database-owned namespace.

### 10.2 Delivery stages

1. Define executable schemas, registered step contracts and transition tests.
   Extract the namespace transaction API; add migrations without enabling new
   lifecycle ownership. Preserve existing reducer behavior as fixtures.
2. Prove manual creation and task-generation/import in an isolated test namespace.
   Exercise workflow/step/run/event/command identity, transactions and restart
   recovery with the existing typed runner.
3. Implement all required lifecycle definitions and database adapters. Convert
   lifecycle-owned decision payloads and claims along with run/job/task state.
   Keep transitional file exports as one-way projections.
4. Import a quiescent snapshot for comparison. Record legacy IDs, provenance,
   status, timestamps, metadata, retries, pending effects and evidence. Do not
   invent missing AgentAttempts or historical events; use imported.snapshot
   events and explicit unknown/reconciliation-required records.
5. Rehearse a whole-namespace ownership cutover and rollback before enabling it.
   Compare task/run/job/decision APIs, dependency behavior and queue/capacity state.
6. Enable database authority for a namespace only after all producers and
   consumers pass the acceptance gate. Retire compatibility writers after the
   supported export readers have migrated.

Shadow imports are comparison-only. They do not dispatch commands, execute
recovery or write back to the live source. Do not mix independently authoritative
file and database engines inside one namespace/capacity domain.

### 10.3 Cutover protocol

- Establish a namespace maintenance boundary across every ingress path.
- Stop admitting new work and allow active attempts and in-flight writers to
  settle. Preserve data and sessions; do not terminate them to force cutover.
- Verify that all participating executables support the new authority epoch.
  Stop legacy workers/monitors only after their work has settled; an old binary
  cannot be trusted to honor a new database flag.
- Take a consistent database and artifact snapshot, including pending deliveries,
  waits, retry counters and decision selections.
- Import and validate foreign keys, identities, counts, payloads and receipts.
  Waiting human gates can remain waiting if fully represented.
- Commit the authority epoch, activate compatible workers, verify all adapters
  read the database, and reopen ingress.

If any required active state cannot be represented faithfully, defer cutover.
Compiled runtime bundles must include the new storage boundary; source-only
changes are insufficient.

### 10.4 Rollback

Before authority switches, disable the inert comparison path without touching
the legacy owner.

After authority switches, prefer a compatible application rollback that retains
database ownership. Reverting to file ownership requires another maintenance
boundary, a validated reverse export at one consistent revision, completed writer
shutdown and a new authority epoch. Never flip a feature flag while both writers
are live, or restore a pre-cutover snapshot over newer accepted work.
If the older representation cannot preserve a new gate, policy, occurrence or
delivery receipt, reject reverse export and retain database authority.

Use SQLite's supported backup mechanism or a proven quiescent snapshot procedure;
copying only a live .db file can omit committed WAL content. Backups include
referenced artifacts and schema/definition versions. Restore validation suspends
dispatch until previously delivered external effects have been reconciled, because
an older snapshot may lack their receipts.

## 11. Acceptance and evidence

The specification is implemented only when the following cases pass against
temporary databases and real worker/runner boundaries, then a packaged namespace.
Test outputs must identify workflow, step, run, attempt, event and command IDs.

1. Manual task creation produces a task and the requested workflow, with no
   synthetic agent run. Auto-run off waits for an explicit action.
2. A generation workflow with no subject task produces several tasks. Replaying
   its import 100 times creates exactly one task per output key.
3. Manual selection and AI selection converge on the same validated chain
   binding. Supplied chains skip only eligible steps with recorded reasons.
4. UI/API, CLI, auto-run, email, internal/external webhook, schedule and chain-event
   launches share scope, admission and identity checks. Duplicate deliveries
   reuse one launch; distinct schedule occurrences remain distinct.
5. Failed execution consumes the configured execution budget once per new
   execution attempt. Analysis failures and command redelivery do not consume it.
   Alternating execution failure, summary retry, chain changes and decision
   round-trips cannot reset the workflow budget.
6. A completed run leaves the task open until an accepted outcome closes it.
   Missing evidence, stale criteria and a failed summary cannot close it.
7. Human gates survive restarts without an active agent. An advisor cannot select.
   An authorized AI decider can select; revoked/out-of-policy authority cannot.
8. Concurrent human/AI selections yield one accepted choice. Changed options
   reject stale selection and plan results. Applying a selection twice creates
   no duplicate tasks, dependencies or external actions.
9. Kill the transition process before commit and after commit/before dispatch.
   State, event and commands are all absent or all committed; committed work
   remains recoverable.
10. Kill a dispatcher before PTY creation, after PTY creation, after instruction
    submission and before acknowledgement. Recover the same attempt or block
    uncertainty; never duplicate instructions or leak capacity.
11. Two workers compete for the same command. Only the current lease generation
    accepts its result; expired ownership does not release a live agent's slot.
12. Lose acknowledgement of an external action. Reconcile by receipt/idempotency
    identity or enter unknown_delivery; do not silently repeat unsafe effects.
13. Worker downtime, database contention, disk-full errors and unavailable PTY
    transport produce explicit degraded/waiting/error evidence, never success.
14. Late completions, old summaries and replaced run pointers cannot advance the
    current occurrence. Explicit terminal correction preserves prior history and
    blocks when already-consumed results require compensation.
15. Preserve existing fan-out/fan-in and workspace-isolation acceptance, including
    the 30-target routed launch restart case, FIFO capacity and cleanup receipts.
16. Cancellation suppresses new dependent launches, settles exact active
    execution, and preserves late evidence. Manual task closure invents no run
    success.
17. Reads, writes, commands, evidence and selections reject cross-organization,
    namespace or unauthorized workspace references, including colliding IDs.
18. A stale compatibility projector cannot overwrite a newer export. A legacy
    executable cannot write after the rehearsed namespace cutover.
19. Historical import preserves IDs, retries, waits and pending effects without
    inventing completion evidence. Re-running import is idempotent and inert.
20. Backup/restore and application rollback retain accepted state and prevent
    blind redispatch of effects whose receipts may be newer than the snapshot.
21. Task, run, job and decision views agree with database state after restarts.
    Workflow inspection explains every wait and exposes the actual eligible
    frontier. Verify changed UI at 390px, 820px and desktop widths.
22. On the existing representative workload, measure frontier-query latency,
    write contention, command latency and event volume against a recorded
    baseline. No directory scan occurs in database-backed status-list queries,
    and no unexpected SQLITE_BUSY failure escapes the bounded retry policy.

Before rollout, run applicable typed lifecycle, routing, event, admission,
decision, job, summary and generated-bundle parity checks. Build the tracked
runtime bundles and prove the packaged code uses database adapters. Report
untested launch surfaces explicitly rather than labeling the migration complete.

## 12. Relationship to existing contracts

This spec extends the
[task lifecycle reducer contract](../task-lifecycle-reducer-spec.md) into
pre-execution admission, explicit step occurrences and transactional persistence.
Its current code expressly leaves admission outside the reducer; that boundary
changes only as the corresponding migration stage is implemented.

It supplies persistence and lifecycle ownership for the transition ledger and
durable frontier required by
[graph execution requirements](../graph-execution-requirements.md).
It preserves the execution-isolation obligations in
[run workspace graph execution](../run-workspace-graph-execution-spec.md).
Neither a database row nor a completed agent bypasses integration or publication
gates.

During implementation, update these documents, the typed runner contract,
data-shape schemas/catalog and affected public API documentation when their
ownership changes. Until then, this document describes the target and the
existing documents describe their current contracts.
