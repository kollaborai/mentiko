# Event Template Artifact Contract

## Purpose

Mentiko can map runtime events to generation templates and artifact contracts.
The first implementation handles one event:

```text
quality_gate.failed
```

This is not a public execute API. The runner owns the first event source.

## First Slice

Flow:

```text
quality gate fails
  -> runner builds quality_gate.failed payload
  -> event artifact runner checks mappings
  -> triage-result.json is written under run artifacts
  -> draft-child-tasks.json is written under run artifacts
  -> event-artifact-executions.jsonl records idempotency state
  -> human/manual apply imports child tasks
```

## Template Roles

Generation template:

- controls prompt/input instructions.
- lives in generation template storage.

Artifact template:

- controls output/display/schema expectations.
- lives in artifact template storage.

Event mapping:

- connects an event to both template concepts.
- owns dedupe, max children, and allowed actions.

## Safety Rules

- payload paths never decide write locations.
- output artifacts must be basenames.
- writes stay under the trusted run artifacts directory.
- task creation is a manual apply step.
- task import uses `importGeneratedTaskTree` with a stable generation job id.
- retries must not create duplicate child tasks.
- event-artifact failure must not hide the original run failure.

## Ledger States

```text
artifact_pending
artifact_generated
actions_planned
awaiting_review
actions_applied
blocked_on_children
deduped
failed
```

## Future Events

Keep generic workflow events separate from code-only events:

- `work.changed`
- `artifact.changed`
- `run.needs_triage`
- `review.requested`

Code review and worktree behavior should be implemented as policies on top of
those generic events, not baked into the event substrate.
