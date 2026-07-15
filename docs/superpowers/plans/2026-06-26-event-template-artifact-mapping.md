# Event Template Artifact Mapping Implementation Plan

> Historical plan snapshot. Shell completion paths and source labels below
> describe the pre-cutover implementation; current completion and quality-gate
> provenance is owned by `web/lib/runner-v2/completion-entrypoint.ts`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

## Goal

Build a runner-native event-to-template-to-artifact/action layer so Mentiko can react to hook events, quality-gate failures, and chain outcomes without hardcoding every recovery path.

The first slice is intentionally narrow:

- `quality_gate.failed` only.
- Bash runner and runner-v2 both emit the same normalized quality-gate event.
- A run-attached triage artifact is created under the failing run's real artifacts directory.
- Follow-up child tasks are drafted, not auto-launched.
- A manual apply path imports approved draft tasks through the existing generated-task importer and pauses the parent task.

The Generation page remains prompt/template truth. The Artifacts surface remains artifact/schema truth. This feature maps events to those existing objects and records what happened.

## Architecture

Do not build a sidecar event runner in slice one. The runner/job/artifact contract is the source of truth.

Flow:

```text
runner quality gate fails
  -> shared quality_gate.failed payload
  -> event artifact phase/effect
  -> mapping lookup
  -> triage artifact under run artifacts
  -> execution ledger entry
  -> draft child tasks
  -> manual apply imports tasks
  -> parent task waiting_on_children
```

Important constraints:

- No public `/api/event-artifacts/execute` route in MVP.
- No new `event_artifact` job type in MVP.
- No `start_chain`, `message_agent`, or `assign_review` side effects in MVP.
- No artifact path from payload is trusted.
- No duplicate child tasks on retry.
- Human review is required before mutating tasks.

## Reviewer Verdict

Three independent reviews said revise before implementation.

Fixes applied to this plan:

- Event handling is now integrated into runner-v2 phases/effects and bash completion, not a loose endpoint.
- The MVP avoids new job types unless the full `/api/jobs`, job-store, dispatch, and complete path are extended later.
- `create_tasks` now means draft first, then manual apply through `generated-task-import.ts`.
- Data-root and run-artifact boundaries are explicit.
- Dedupe, approval, and execution state are first-class.
- `code.changed` becomes a future `work.changed` / `artifact.changed` family so Mentiko is not code-only.

## File Structure

Create:

- `web/lib/event-artifacts/event-template-map.ts`
  - File-backed mapping registry, default mappings, validation, lookup.
- `web/lib/event-artifacts/event-artifact-runner.ts`
  - Pure runner library that evaluates mappings and writes artifacts/ledger.
- `web/lib/event-artifacts/event-artifact-ledger.ts`
  - Durable idempotency ledger under run artifacts.
- `web/lib/event-artifacts/event-artifact-actions.ts`
  - Draft/apply helpers for safe actions.
- `web/lib/event-artifacts/event-payload.ts`
  - Normalizes run/task/quality-gate data into stable payloads.
- `web/lib/event-artifacts/__tests__/event-template-map.test.ts`
- `web/lib/event-artifacts/__tests__/event-artifact-runner.test.ts`
- `web/lib/event-artifacts/__tests__/event-artifact-ledger.test.ts`
- `web/lib/event-artifacts/__tests__/event-artifact-actions.test.ts`
- `docs/orchestration/event-template-artifact-contract.md`

Modify:

- `web/lib/runner-v2/phase-plan.ts`
  - Add event-artifact phase after quality-gate failure is known, before final terminal stop.
- `web/lib/runner-v2/completion-entrypoint.ts`
  - Pass run/task/gate context into event-artifact runner.
- `web/lib/runner-v2/adapters.ts`
  - Apply typed event/effect for event-artifact handling.
- `web/lib/runner-v2/quality-gate.ts`
  - Provide source payload for `quality_gate.failed`.
- `lib/chain-runner-complete.sh`
  - Call the same Node helper/adapter for bash quality-gate failures.
- `web/lib/tasks/generated-task-import.ts`
  - Reuse for approved child task import.
- `web/lib/tasks/task-store.ts`
  - Add or reuse helper to mark parent as `waiting_on_children` and disable parent auto-run.
- `web/lib/system/platform-events.ts`
  - Add catalog entry for `quality_gate.failed`; leave broader events documented but disabled.
- `lib/schemas/event.schema.json`
  - Add the real event schema.
- `web/lib/__tests__/engine-event-contract.test.ts`
  - Guard event contract drift.
- `web/lib/system/artifact-template-storage.ts`
  - Reference artifact schema contracts without conflating them with generation prompt templates.

Do not modify in MVP:

- `/generation` UI.
- `/artifacts` UI.
- peer review execution.
- worktree execution.
- generic hook editor.
- public execute API.

## Contracts

### Event name

MVP event:

```ts
type EventArtifactEventName = "quality_gate.failed";
```

Future names should stay workflow-neutral:

- `work.changed`
- `artifact.changed`
- `run.needs_triage`
- `review.requested`

Avoid `code.changed` as a generic primitive.

### Mapping

Store:

```text
orgPath(namespaceId, orgId, "event-artifact-mappings.json")
```

MVP mapping:

```ts
export interface EventTemplateMapping {
  id: string;
  event: "quality_gate.failed";
  enabled: boolean;
  generationTemplateId: string;
  artifactTemplateId: string;
  artifactSchema: "generated-tasks/v1";
  outputArtifact: "triage-result.json";
  actions: ["draft_tasks"];
  maxChildren: number;
  requireHumanReview: true;
  dedupeKey: string;
}
```

Default:

```json
{
  "id": "quality-gate-failed-draft-tasks",
  "event": "quality_gate.failed",
  "enabled": true,
  "generationTemplateId": "failure_triage",
  "artifactTemplateId": "generated_tasks",
  "artifactSchema": "generated-tasks/v1",
  "outputArtifact": "triage-result.json",
  "actions": ["draft_tasks"],
  "maxChildren": 3,
  "requireHumanReview": true,
  "dedupeKey": "{{namespace.id}}:{{org.id}}:{{task.id}}:{{run.id}}:quality_gate.failed"
}
```

### Payload

```ts
export interface QualityGateFailedPayload {
  event: {
    name: "quality_gate.failed";
    source: "runner-v2" | "chain-runner-complete";
    timestamp: string;
  };
  namespace: {
    id: string;
  };
  org: {
    id: string;
  };
  run: {
    id: string;
    chainId?: string;
    chainName?: string;
    status: string;
    artifactsDir: string;
  };
  task?: {
    id: string;
    title: string;
    status: string;
    type?: string;
    priority?: number;
    parentTaskId?: string;
    acceptanceCriteria?: string;
  };
  qualityGate: {
    status: "partial" | "failed";
    agentId?: string;
    reason: string;
    summaryPath?: string;
    findings: string[];
    risks: string[];
    nextActions: string[];
  };
  evidence: {
    changedFiles: string[];
    liveSessions: string[];
    artifacts: string[];
  };
}
```

Rules:

- `run.artifactsDir` must be resolved by runner context, never accepted from untrusted JSON.
- `summaryPath` must be under `run.artifactsDir` or omitted.
- `outputArtifact` must be a basename and resolved under `run.artifactsDir`.
- Missing task context still generates an artifact but cannot draft child tasks.

### Ledger

Store:

```text
<run.artifactsDir>/event-artifact-executions.jsonl
```

Entry:

```ts
export interface EventArtifactExecutionRecord {
  id: string;
  mappingId: string;
  event: string;
  evaluatedDedupeKey: string;
  status:
    | "artifact_pending"
    | "artifact_generated"
    | "actions_planned"
    | "awaiting_review"
    | "actions_applied"
    | "blocked_on_children"
    | "deduped"
    | "failed";
  artifactPath?: string;
  draftTaskPath?: string;
  actionResults?: unknown[];
  error?: string;
  createdAt: string;
  updatedAt: string;
}
```

Retry behavior:

- If the same `evaluatedDedupeKey` already has `awaiting_review`, return it.
- If it has `actions_applied` or `blocked_on_children`, do nothing.
- If it has `failed`, create one retry record with a `retryOf` pointer.
- Ledger writes must be atomic enough for runner retries: write temp file, rename.

## Tasks

### Task 1: Contract Tests First

Files:

- `web/lib/event-artifacts/__tests__/event-template-map.test.ts`
- `web/lib/event-artifacts/__tests__/event-artifact-ledger.test.ts`
- `web/lib/event-artifacts/__tests__/event-artifact-runner.test.ts`
- `web/lib/__tests__/engine-event-contract.test.ts`

Steps:

- [ ] Add tests for default mapping lookup.
- [ ] Add tests for invalid mapping JSON returning defaults plus a warning.
- [ ] Add tests for disabled mapping producing no action.
- [ ] Add tests for path traversal in `outputArtifact` being rejected.
- [ ] Add tests for invalid `artifactsDir` being rejected.
- [ ] Add tests for duplicate dedupe key returning existing record.
- [ ] Add tests for retry after `failed`.
- [ ] Add tests for no task context producing artifact only.
- [ ] Add event schema test for `quality_gate.failed`.

Verification:

```bash
cd web && npm test -- --runTestsByPath \
  lib/event-artifacts/__tests__/event-template-map.test.ts \
  lib/event-artifacts/__tests__/event-artifact-ledger.test.ts \
  lib/event-artifacts/__tests__/event-artifact-runner.test.ts \
  lib/__tests__/engine-event-contract.test.ts
```

Expected: tests fail because implementation does not exist yet.

### Task 2: Mapping Registry

Files:

- `web/lib/event-artifacts/event-template-map.ts`

Steps:

- [ ] Implement default mapping for `quality_gate.failed`.
- [ ] Validate `generationTemplateId` as a known/default/custom generation template id.
- [ ] Validate `artifactTemplateId` against artifact template storage.
- [ ] Allow only MVP action `draft_tasks`.
- [ ] Clamp `maxChildren` to `1..5`.
- [ ] Force `requireHumanReview: true`.
- [ ] Reject path separators in `outputArtifact`.
- [ ] Read custom mappings from `orgPath`.
- [ ] Write support can exist as a library function, but no public update route in MVP.

Verification:

```bash
cd web && npm test -- --runTestsByPath lib/event-artifacts/__tests__/event-template-map.test.ts
```

### Task 3: Ledger

Files:

- `web/lib/event-artifacts/event-artifact-ledger.ts`
- `web/lib/event-artifacts/__tests__/event-artifact-ledger.test.ts`

Steps:

- [ ] Resolve ledger path from a trusted run artifacts dir.
- [ ] Reject artifacts dirs outside namespace/project data root.
- [ ] Read JSONL records.
- [ ] Write JSONL records through temp-file rename.
- [ ] Find latest record by evaluated dedupe key.
- [ ] Return deduped result for already pending/applied records.
- [ ] Support retry record when previous status is `failed`.

Verification:

```bash
cd web && npm test -- --runTestsByPath lib/event-artifacts/__tests__/event-artifact-ledger.test.ts
```

### Task 4: Payload Builder

Files:

- `web/lib/event-artifacts/event-payload.ts`
- `web/lib/runner-v2/quality-gate.ts`

Steps:

- [ ] Build `QualityGateFailedPayload` from runner-v2 completion context.
- [ ] Build equivalent payload from bash completion context.
- [ ] Normalize findings, risks, and next actions to bounded arrays.
- [ ] Strip or omit absolute paths not under run artifacts.
- [ ] Keep payload workflow-neutral; no code-only assumptions.

Verification:

```bash
cd web && npm test -- --runTestsByPath lib/event-artifacts/__tests__/event-artifact-runner.test.ts
```

### Task 5: Event Artifact Runner

Files:

- `web/lib/event-artifacts/event-artifact-runner.ts`
- `web/lib/event-artifacts/event-artifact-actions.ts`
- `web/lib/event-artifacts/__tests__/event-artifact-runner.test.ts`

Steps:

- [ ] Accept trusted execution context: namespaceId, orgId, runId, taskId, run artifacts dir.
- [ ] Load enabled mappings for `quality_gate.failed`.
- [ ] Evaluate dedupe key from payload.
- [ ] Check ledger before doing work.
- [ ] Render/generate artifact using the mapped generation template.
- [ ] Write `triage-result.json` under run artifacts only.
- [ ] Validate artifact shape as `generated-tasks/v1`.
- [ ] Convert generated tasks to draft child-task import payload.
- [ ] Write `draft-child-tasks.json`.
- [ ] Mark ledger `awaiting_review`.
- [ ] Return planned action summary.

MVP side effects:

- allowed: write run artifacts, write ledger.
- not allowed: create tasks, start chains, message agents, assign reviewers.

Verification:

```bash
cd web && npm test -- --runTestsByPath lib/event-artifacts/__tests__/event-artifact-runner.test.ts
```

### Task 6: Manual Apply Path

Files:

- `web/lib/event-artifacts/event-artifact-actions.ts`
- `web/lib/tasks/generated-task-import.ts`
- `web/lib/tasks/task-store.ts`
- `web/app/api/runs/[runId]/event-artifacts/[executionId]/apply/route.ts`

Steps:

- [ ] Add internal/authenticated apply route, not a generic execute route.
- [ ] Require existing permission that can mutate tasks; if no exact permission exists, add one deliberately.
- [ ] Load execution record by run id and execution id.
- [ ] Require status `awaiting_review`.
- [ ] Read `draft-child-tasks.json` under run artifacts.
- [ ] Import tasks via `generated-task-import.ts` with stable idempotency key.
- [ ] Mark parent task `waiting_on_children`.
- [ ] Disable parent `auto_run`.
- [ ] Add parent comment/metadata pointing to child task ids and triage artifact.
- [ ] Mark ledger `blocked_on_children` or `actions_applied`.
- [ ] A second apply call must return existing results, not duplicate tasks.

Verification:

```bash
cd web && npm test -- --runTestsByPath lib/event-artifacts/__tests__/event-artifact-actions.test.ts
cd web && npx tsc --noEmit
```

### Task 7: Runner-v2 Integration

Files:

- `web/lib/runner-v2/phase-plan.ts`
- `web/lib/runner-v2/completion-entrypoint.ts`
- `web/lib/runner-v2/adapters.ts`
- `web/lib/runner-v2/quality-gate.ts`

Steps:

- [ ] Add event-artifact effect after quality gate evaluates failed/partial.
- [ ] Ensure terminal quality-gate stop still happens after artifact handling.
- [ ] Pass trusted artifacts dir and task/run context.
- [ ] Record event-artifact outcome in run metadata/artifact manifest.
- [ ] On event-artifact failure, do not hide the original quality-gate failure.
- [ ] On event-artifact success, run remains failed/blocked but has triage artifact ready.

Verification:

```bash
cd web && npm test -- --runTestsByPath \
  lib/runner-v2/__tests__/phase-plan.test.ts \
  lib/event-artifacts/__tests__/event-artifact-runner.test.ts
cd web && npx tsc --noEmit
```

### Task 8: Bash Runner Integration

Files:

- `lib/chain-runner-complete.sh`
- helper script if needed under `web/scripts/`

Steps:

- [ ] Add a Node helper invoked with explicit args: run id, chain file, namespace id, org id, artifacts dir.
- [ ] Do not call shell script with no args in tests.
- [ ] Invoke helper when quality gate summary is `partial` or `failed`.
- [ ] Use same payload builder/runner as runner-v2.
- [ ] Preserve existing completion/failure semantics.

Verification:

```bash
bash lib/chain-runner-complete.sh --help
```

Add an arg-based shell fixture test that creates:

- temporary namespace root
- valid chain file
- run dir with artifacts
- quality gate summary

Expected:

- `triage-result.json` exists under run artifacts.
- ledger exists under run artifacts.
- original run still reflects quality gate failure.

### Task 9: Platform Event Catalog And Schema

Files:

- `web/lib/system/platform-events.ts`
- `lib/schemas/event.schema.json`
- `web/lib/__tests__/engine-event-contract.test.ts`
- `docs/orchestration/event-template-artifact-contract.md`

Steps:

- [ ] Add `quality_gate.failed` to catalog and JSON schema.
- [ ] Document future disabled event families: `work.changed`, `artifact.changed`, `run.needs_triage`, `review.requested`.
- [ ] Document mapping lifecycle and ledger states.
- [ ] Document why templates are split:
  - generation template: prompt/input.
  - artifact template: output/schema/display contract.
  - mapping: when to connect them.

Verification:

```bash
cd web && npm test -- --runTestsByPath lib/__tests__/engine-event-contract.test.ts
```

### Task 10: Full Verification

Run:

```bash
cd web && npm test -- --runTestsByPath \
  lib/event-artifacts/__tests__/event-template-map.test.ts \
  lib/event-artifacts/__tests__/event-artifact-ledger.test.ts \
  lib/event-artifacts/__tests__/event-artifact-runner.test.ts \
  lib/event-artifacts/__tests__/event-artifact-actions.test.ts \
  lib/__tests__/engine-event-contract.test.ts
cd web && npx tsc --noEmit
```

Then inspect a real or fixture failed run:

- quality gate failure still visible.
- `triage-result.json` exists.
- `event-artifact-executions.jsonl` exists.
- duplicate completion does not create duplicate tasks.
- apply path creates children once.
- parent auto-run is disabled and parent is waiting on children.

## Deferred Slices

### Slice 2: UI

- Show event-artifact state on run page.
- Add review/apply controls for draft child tasks.
- Show parent task waiting on children.
- Add read-only mapping view to `/generation` and `/artifacts`.

### Slice 3: Editable Mappings

- Add mapping editor after runtime path is proven.
- Include validation preview.
- Include dry-run against a selected run payload.
- Keep writes behind explicit permission.

### Slice 4: Peer Review And Worktrees

- Add `review.requested`.
- Add worktree policy per epic/task.
- Add draft review assignment artifact.
- Add manual apply for peer review assignment.

### Slice 5: Generic Hooks

- Allow hooks to emit typed events.
- Map arbitrary event payloads to generation/artifact templates.
- Keep action permissions scoped and explicit.

## Implementation Notes

- Use existing repo patterns before creating new abstractions.
- Do not add a public execute endpoint until the internal runner path is green.
- Do not add a new job type unless `JobType`, `/api/jobs`, dispatch, complete route, and import path are all updated together.
- Keep runner-v2 and bash runner behavior in parity.
- Avoid code-only assumptions in names and payloads.
- Prefer draft artifacts plus manual apply over auto-mutation.
- Every side effect needs an idempotency key.

## Review Checklist

- [ ] All event-artifact writes stay under trusted run artifacts dir.
- [ ] No path from payload controls write location.
- [ ] No generic public execute endpoint exists.
- [ ] No duplicate tasks on retry.
- [ ] Parent task is paused only after child task import succeeds.
- [ ] Original run failure remains visible.
- [ ] Runner-v2 and bash runner both use the same adapter/helper.
- [ ] Generation templates and artifact templates remain separate concepts.
- [ ] Typecheck passes.
- [ ] Targeted tests pass.
