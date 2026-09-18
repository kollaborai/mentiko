# Design gaps exposed by the package

These are deliberately explicit. They are not implementation tasks silently
marked complete by a green reference-model run.

## P1: database authority does not exist yet

Current task persistence is the namespace `tasks.db` with a `tasks` table and
task-specific migrations in [task-store.ts](../../../../web/lib/tasks/task-store.ts).
Current runner attempts are written into `run.json` by
[agent-attempt.ts](../../../../web/lib/runner-v2/agent-attempt.ts). The proposed
workflow, step, lifecycle-event, lifecycle-command, artifact-reference and
reservation records do not exist as production tables.

Required proof: an isolated namespace migration that preserves existing task,
run, job, decision and workspace identities, then a packaged runtime check that
all lifecycle writers use the database authority epoch.

## P1: the atomic transition seam is still a design boundary

The current reducer is pure and the current service applies injected effects;
the reducer explicitly leaves admission outside its v1 scope in
[task-lifecycle-reducer.ts](../../../../web/lib/orchestration/task-lifecycle-reducer.ts)
and [task-lifecycle-service.ts](../../../../web/lib/orchestration/task-lifecycle-service.ts).
The current task creation function writes the task record but does not also
commit proposed lifecycle events and commands in one transition.

Required proof: crash-injection tests before commit and after commit/before
dispatch using one SQLite connection, with no partial state and with committed
commands recoverable after restart.

## P1: runner identity remains file-backed

The existing typed runner has useful phase and identity rules, including launch
job and occurrence checks, but `createAgentAttempt` and
`transitionAgentAttempt` still mutate run-local state. The proposed database
model must adapt those records without creating a second attempt owner or
silently treating a command lease as proof that physical execution stopped.

Required proof: dispatcher crash probes before PTY creation, after PTY creation,
after instruction submission and before acknowledgement, including lease
generation and reservation cleanup assertions.

## P2: trigger and decision adapters are not yet one transition service

The target contract names manual/API, CLI, auto-run, email, webhooks, schedules,
chain events and guided decisions as convergent adapters. Current code still has
separate task, schedule, run, job and decision seams. The scenario suite records
the required identity and authority behavior, but those scenarios are contract
only until each producer is wired through the future service.

Required proof: duplicate delivery and concurrent selection tests through the
real adapters, not only direct reducer calls.

## P2: most acceptance cases are contract-only

`FIX-DBL-001` is executable and covers one complete task-fulfillment path. The
20 scenarios in `fixtures/scenario-suite.json` and all 22 stable acceptance IDs
are shape-validated, but cases involving worker crashes, PTY transport, fan-out,
cutover, backup/restore, UI frontier views and performance still need runtime or
packaged evidence.

Required proof: promote each scenario to the verification layer listed in
`contracts/verification-plan.json`; do not relabel a fixture pass as migration
readiness.

## P2: existing task metadata needs a migration mapping

The current task table keeps much lifecycle information in `metadata` and has a
nullable `workspace_id`. The proposed model promotes source provenance,
criteria revisions, workflow identity, retry counters and accepted result
revisions into queryable records. The package examples make those fields
explicit, but no mapping or backfill policy has been chosen for historical rows
with missing events or attempts.

Required decision: define the historical import vocabulary (`imported.snapshot`,
`reconciliation_required`, unknown delivery/evidence) and prove that rerunning
the import is inert before enabling any new writer.
