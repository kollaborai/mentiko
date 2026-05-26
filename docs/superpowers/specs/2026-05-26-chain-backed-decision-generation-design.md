# Chain-Backed Decision Generation Design

> For agentic workers: this is a design/spec, not an implementation plan.
> Do not start coding from this file until Marco approves the follow-up plan.

## Goal

Move decision AI generation off the ad hoc background job runner and onto
Mentiko's own chain execution system, so every decision round has a run trail:
`run.json`, `chain.json`, agent sessions, logs, events, and importable artifacts.

The decision UI should stay guided and interactive. The backend generation
primitive should change from "spawn one CLI through stdin/stdout and parse
whatever came back" to "run a core Mentiko chain that writes a typed decision
artifact and imports it."

## Why

The current route-level job model is fragile:

- `/web/app/api/decisions/[id]/research/route.ts` creates a `decision_research`
  job, launches `lib/job-runner.mjs`, parses stdout, and patches the decision.
- `/web/app/api/decisions/[id]/guided/options/route.ts` does the same for round 2.
- `/web/app/api/decisions/[id]/guided/plan/route.ts` does the same for round 3.
- `/web/app/api/jobs/[id]/complete/route.ts` contains a second auto-apply path
  for decision jobs, so decision state updates are split across route handlers.

That path has weak provenance. When generation fails, users see a stuck decision
or an error, but they do not get the normal Mentiko run evidence: agent session,
artifacts, event files, chain transitions, and replayable output.

Chains already provide the missing audit surface. `lib/chain-runner.mjs` creates
runs, writes artifacts, emits events, exposes `ARTIFACTS_DIR`, `EVENTS_DIR`, and
`MENTIKO_RUN_ID`, and records agent completion in `run.json`. Decision generation
should use that machinery instead of bypassing it.

## Non-Goals

- Do not remove the existing job runner immediately. It still powers other
  generation jobs and is the safe fallback during rollout.
- Do not make one giant chain that performs all guided rounds without user input.
  The user must still answer tradeoff questions, select options, and approve.
- Do not require MCP tools for decision-writing agents. The chain agent should
  have a tiny CLI/import contract, not a huge MCP tool surface.
- Do not expose arbitrary import paths. Decision imports must validate namespace,
  org, decision ID, stage, schema, and artifact location.

## Recommended Architecture

Use core hidden chains as the decision generation backend:

- `core/decision-research.chain.json`
- `core/decision-guided-questions.chain.json`
- `core/decision-guided-options.chain.json`
- `core/decision-guided-plan.chain.json`
- optional later: `core/decision-retrospective.chain.json`

Each chain has one primary generator agent at first. Multi-agent research can be
added later, but the initial win is provenance, not more agents.

Each decision stage starts a chain run instead of a job:

1. API route builds the same prompt/context it builds today.
2. API route creates a run through the chain-run API with a deterministic
   `runId` and decision metadata.
3. Decision is updated with `activeRunId`, `activeStage`, and stage status.
4. Chain agent writes a typed JSON artifact to `$ARTIFACTS_DIR`.
5. Agent runs `mentiko decision import --file <artifact> --decision-id <id>
   --stage <stage>`.
6. Importer validates and applies the artifact using shared decision services.
7. Chain emits `decision-imported` or `decision-import-failed`.
8. UI shows the normal decision state plus a link to the source run.

The import command is the primary path. A run-complete artifact scan is the
backup path, so a valid artifact still gets imported if the agent forgets the
CLI step.

## Data Model Changes

Extend `Decision` with run provenance:

```ts
activeRunId?: string;
activeStage?: "research" | "questions" | "options" | "plan" | "retrospective";
generationRuns?: Array<{
  stage: string;
  runId: string;
  artifactPath?: string;
  importedAt?: string;
  status: "running" | "imported" | "failed";
  error?: string;
}>;
```

Keep `activeJobId` during the migration. The UI should support both until all
decision stages are chain-backed.

## Artifact Contract

Decision agents write one JSON artifact with this envelope:

```json
{
  "kind": "mentiko.decision.import",
  "version": 1,
  "decisionId": "uuid",
  "stage": "research",
  "runId": "run-...",
  "payload": {}
}
```

`payload` is stage-specific:

- `research`: same shape currently expected from `decision_research`
  (`title`, `priority`, `category`, `brief`, `context`, optional options).
- `questions`: `{ "questions": [...] }`.
- `options`: `{ "options": [...], "recommendation": {...} }`.
- `plan`: execution plan shape currently stored in `guidedFlow.round3.plan`.
- `retrospective`: retrospective shape currently stored on `decision.retrospective`.

The importer must reject:

- missing or unsupported `kind`/`version`
- decision ID mismatch
- stage mismatch
- artifact path outside the current run's artifact directory
- payload that fails the same validations used by the current job completion path

## Importer Service

Create a shared service, likely `web/lib/decision-import.ts`, that owns all
stage application logic.

Inputs:

- namespace ID
- org ID
- decision ID
- stage
- payload
- source run ID
- source artifact path
- workspace path if known

Responsibilities:

- load the decision
- validate current stage is allowed
- validate payload shape
- apply state changes currently duplicated between decision routes and
  `/api/jobs/[id]/complete`
- append generation run provenance
- write system/audit log entry
- return updated decision

This service becomes the only place that mutates decision AI-generation results.
Existing job completion can call it too, which cleans up the current split-brain.

## CLI Contract

Add a narrow CLI command:

```bash
mentiko decision import \
  --file "$ARTIFACTS_DIR/decision-import.json" \
  --decision-id "$MENTIKO_DECISION_ID" \
  --stage research \
  --run-id "$MENTIKO_RUN_ID"
```

The command should call an internal API endpoint or invoke the same import module
directly, depending on what is cleanest for the existing CLI boundary.

Required env passed to the chain:

- `MENTIKO_DECISION_ID`
- `MENTIKO_DECISION_STAGE`
- `MENTIKO_RUN_ID`
- `ARTIFACTS_DIR`
- `EVENTS_DIR`
- existing namespace/org/root env from chain runner

Do not expose MCP. The agent needs one small command and a file path, not the
whole ops tool catalog.

## Run-Complete Safety Scan

Add a fallback scan after chain completion:

1. Read run artifacts.
2. Find files with `kind === "mentiko.decision.import"`.
3. Ignore artifacts already imported.
4. Validate artifact belongs to that run.
5. Import exactly one artifact for the expected stage.
6. If multiple valid artifacts exist, fail loudly and link the run.

This should live close to chain completion or a small decision-import reconciler.
It should not depend on the schedule file-trigger loop for the primary path.

## File Trigger Role

File triggers already exist through `schedule-file-triggers.ts` and the scheduler
dispatch path. They are useful for optional "dropbox" workflows:

- monitor `decisions/imports/*.json`
- import externally generated decision JSON
- run a validation/report chain on bad imports

They should not be the core decision-generation mechanism. The core path should
be run-bound and deterministic, because each generated decision stage belongs to
one known decision and one known chain run.

## UI Changes

Decision detail should show generation provenance:

- current stage status
- `activeRunId` when a chain is running
- source run link after import
- import failure with artifact path and validation error
- existing guided flow controls unchanged

The user should be able to open the run from the decision detail and inspect:

- agent output
- generated JSON artifact
- event file
- import result

## Rollout Plan

Phase 1: shared importer

- Extract current decision result application logic into `decision-import.ts`.
- Route existing job completion through that service.
- Add tests for research/questions/options/plan imports.

Phase 2: one chain-backed stage

- Implement `decision-research` chain backend behind a feature flag.
- Add CLI import command.
- Add run provenance to `Decision`.
- UI links decision to source run.

Phase 3: guided rounds

- Move questions, options, and plan to core chains.
- Keep per-round user gates exactly as they work today.
- Remove duplicate phase-2 job polling/application paths once stable.

Phase 4: fallback and cleanup

- Add run-complete safety scan.
- Add optional file-trigger/dropbox import path.
- Deprecate decision job types when all stages are chain-backed.

## Acceptance Tests

- Starting research creates a chain run and stores `activeRunId` on the decision.
- The chain writes a `mentiko.decision.import` artifact.
- CLI import updates the decision to `briefed` and records source run/artifact.
- Invalid payload fails import without corrupting the decision.
- If CLI import is skipped but a valid artifact exists, run-complete scan imports it.
- If multiple artifacts exist for the same stage, import fails with a clear error.
- Guided options and plan still pause for user selection/approval between rounds.
- The decision UI links to the source run and no longer appears stuck with no trail.

## Open Implementation Questions

- Whether the CLI import should call an API route or import a node module directly.
  Prefer the route if auth/internal token handling is already clean; prefer module
  direct-call if this runs inside the trusted server process.
- Whether core chains should live under `chains/core/` in data root or be seeded
  from repo templates at boot. Prefer seeded core chains so users can inspect them
  but the app can update defaults.
- Whether the run-complete safety scan belongs inside `chain-runner.mjs` or in the
  web completion/reconciler layer. Prefer the web layer if it needs typed decision
  imports and namespace-aware services.

## Recommendation

Build this. It aligns decisions with Mentiko's main product model, gives users
the audit trail they expect, and reduces dependence on brittle stdout parsing.
Keep the existing job runner as a fallback during migration, but make chains the
default backend for decision generation.
