# Generation Job Core-Chain Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for implementation tasks and superpowers:systematic-debugging for the nudge investigation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every AI generation/job-runner endpoint that produces user-facing generated data onto saved core chains, so `/runs` shows the audit trail and the generated payload is imported through the Mentiko CLI/import endpoints.

**Architecture:** Routes still create a `Job` with the existing job type and response shape, but they launch the saved core chain through `startGenerationChainRun` or `startDecisionChainRun` instead of `launchJobRunner`. The core chain writes an artifact JSON file and calls `mentiko generation import` or `mentiko decision import`, which completes the job/decision through the existing server-owned import routes.

**Tech Stack:** Next.js route handlers, TypeScript, Jest route tests, Mentiko core-chain installers, `startChainRun`, `mentiko generation import`, `mentiko decision import`.

---

## Current Baseline

- `task-generation` is already migrated:
  - `web/app/api/tasks/generate/route.ts`
  - `web/app/api/mentiko-mcp/ops/tasks/generate/route.ts`
- `decision-research`, `decision-guided-questions`, `decision-guided-options`, and `decision-guided-plan` are already chain-backed.
- `web/processes.dev.json` is runtime state. Do not stage it.

## Migration Rules

- Keep route response shape compatible. If a route currently returns `{ jobId, status }`, keep it and add `runId` only when useful.
- Do not delete jobs. Routes still call `createJob(...)` so old polling and notifications keep working.
- Replace `launchJobRunner(...)` with the existing dispatch service:
  - generation jobs: `startGenerationChainRun({ request, namespaceId, orgId, kind, job, prompt, workspacePath, taskId?, metadata? })`
  - decision jobs: `startDecisionChainRun({ request, namespaceId, orgId, decision, phase, prompt, workspacePath, selectedOptionId? })`
- Preserve the existing job type in `createJob(...)`. Example: webhook inbound should still create `job.type === "webhook_inbound"`, even if it launches the `"webhook"` core chain kind.
- Preserve existing task metadata keys:
  - chain analysis: `analysis_job_id`, `analysis_status`
  - chain generation: `generation_job_id`, `generation_status`
  - task generation provenance must stay under `task_generation_*`
- Add or update route tests for every migrated endpoint:
  - route creates the same job type as before
  - route calls `startGenerationChainRun`/`startDecisionChainRun`
  - route no longer imports/calls `launchJobRunner`
  - response keeps the previous shape and includes `runId` only where callers can tolerate it
- Do not create per-request chain definitions. Use the saved core chains only.
- Do not add environment-specific profile ids, CLI names, or model names.
- Do not write directly to task, chain, link, agent, webhook, artifact, or decision storage from chain agents. Agents import via the CLI.

## Shared Files

- `web/lib/generation-core-chains.ts`
  - owns saved generation core chain definitions.
  - extend this only when a remaining generation kind has no core chain.
- `web/lib/generation-chain-dispatch.ts`
  - maps generation kinds to core chain ids and starts runs.
- `web/lib/decision-core-chains.ts`
  - owns saved decision core chain definitions.
  - extend for `synthesis` and `retrospective`.
- `web/lib/decision-chain-dispatch.ts`
  - maps decision phases to core chain ids and starts runs.
- `web/app/api/jobs/[id]/complete/route.ts`
  - remains the server-owned completion/import application point.
  - do not bypass it.
- `lib/mentiko-cli-generation.mjs`
  - CLI wrapper for generation imports.
- `web/app/api/decisions/[id]/import/route.ts`
  - CLI target for decision imports.

## Integration Inventory

| # | integration | current endpoint | job type | target core chain | dispatch kind/phase | status |
|---|-------------|------------------|----------|-------------------|---------------------|--------|
| 01 | task generation | `web/app/api/tasks/generate/route.ts` | `task` | `task-generation` | `task` | done |
| 02 | mcp task generation | `web/app/api/mentiko-mcp/ops/tasks/generate/route.ts` | `task` | `task-generation` | `task` | done |
| 03 | generic chain recommendation | `web/app/api/jobs/route.ts` | `recommend` | `chain-recommendation` | `chain_recommendation` | done |
| 04 | generic chain generation | `web/app/api/jobs/route.ts` | `generate` | `chain-generation` | `chain_generation` | done |
| 05 | task analyze/generate chain | `web/app/api/chains/recommend/route.ts` | `generate` | `chain-generation` | `chain_generation` | done |
| 06 | agent generation | `web/app/api/agents/registry/generate/route.ts` | `agent` | `agent-generation` | `agent` | done |
| 07 | agent edit | `web/app/api/agents/registry/edit/route.ts` | `agent_edit` | `agent-edit` | `agent_edit` | done |
| 08 | artifact template generation | `web/app/api/artifact-templates/generate/route.ts` | `artifact` | `artifact-generation` | `artifact` | done |
| 09 | webhook generation | `web/app/api/webhooks/generate/route.ts` | `webhook_inbound`/`webhook_outbound` | `webhook-generation` | `webhook` | done |
| 10 | event trigger generation | `web/app/api/events/triggers/generate/route.ts` | `event_trigger` | `event-trigger-generation` | `event_trigger` | done |
| 11 | agent link generation | `web/app/api/links/generate/route.ts` | `link` | `link-generation` | `link` | done |
| 12 | link run summary | `web/app/api/links/runs/[runId]/generate-summary/route.ts` | `link_summary` | `run-summary-generation` | `run_summary` | done |
| 13 | template test | `web/app/api/generation-templates/test/route.ts` | `template_test` | `template-test` | `template_test` | done |
| 14 | decision preference synthesis | `web/app/api/decisions/[id]/guided/synthesize/route.ts` | `preference_synthesis` | `decision-preference-synthesis` | `synthesis` | done |
| 15 | decision retrospective | `web/app/api/decisions/[id]/retrospective/route.ts` | `decision_retrospective` | `decision-retrospective` | `retrospective` | done |

## Worker Assignments

Live roster:

| worker | agent | status | owns |
|--------|-------|--------|------|
| a | Meitner `019e67af-7246-7bb1-8f0e-27c3c7cc8f3d` | done | integrations 03-05 |
| b | Anscombe `019e67af-9fc5-72a1-9fd5-d5be7203d1b7` | done | integrations 06-07 |
| c | Fermat `019e67af-d1e5-7e73-8f39-9b9d4b6924dc` | done | integrations 08, 13 |
| d | Lagrange `019e67b0-03d5-7603-92b8-b247b8fa9eb1` | done | integrations 09-10 |
| e | Volta `019e67b0-31e0-7443-9a67-7245e3ad9237` | done | integrations 11-12 |
| f | Mendel `019e67b0-6199-76f3-b566-bee493adcf5e` | done | integrations 14-15 |
| nudge | Jason `019e67b1-e643-7db3-9b6b-e67381553a37` | done with concerns | nudge investigation |

### worker a: chain recommendation and chain generation

Files:
- Modify: `web/app/api/jobs/route.ts`
- Modify: `web/app/api/chains/recommend/route.ts`
- Test: `web/__tests__/jobs-generation-chain-dispatch.test.ts` or nearby existing route tests

Requirements:
- `POST /api/jobs` with `type: "recommend"` starts `chain-recommendation`.
- `POST /api/jobs` with `type: "generate"` starts `chain-generation`.
- `/api/chains/recommend` starts `chain-generation`.
- Preserve atomic task metadata behavior in `/api/chains/recommend`.
- Keep response shape compatible.

### worker b: agent generation and agent edit

Files:
- Modify: `web/app/api/agents/registry/generate/route.ts`
- Modify: `web/app/api/agents/registry/edit/route.ts`
- Test: add focused route tests under `web/__tests__/` or colocated route tests

Requirements:
- `agent` jobs start `agent-generation`.
- `agent_edit` jobs start `agent-edit`.
- Keep auth, workspace authorization, template resolution, and response shape.

### worker c: artifact templates and template test

Files:
- Modify: `web/app/api/artifact-templates/generate/route.ts`
- Modify: `web/app/api/generation-templates/test/route.ts`
- Test: add focused route tests

Requirements:
- `artifact` jobs start `artifact-generation`.
- `template_test` jobs start `template-test`.
- Template test must still allow raw/non-JSON output in completion semantics.

### worker d: webhook and event trigger

Files:
- Modify: `web/app/api/webhooks/generate/route.ts`
- Modify: `web/app/api/events/triggers/generate/route.ts`
- Test: add focused route tests

Requirements:
- `webhook_inbound` and `webhook_outbound` keep their current job type but launch kind `webhook`.
- `event_trigger` launches `event-trigger-generation`.
- Preserve template selection for inbound vs outbound webhook.

### worker e: links and link run summary

Files:
- Modify: `web/app/api/links/generate/route.ts`
- Modify: `web/app/api/links/runs/[runId]/generate-summary/route.ts`
- Test: add focused route tests or update existing link summary route tests

Requirements:
- `link` jobs start `link-generation`.
- `link_summary` jobs start `run-summary-generation`.
- Link summary must still write `summary.json` through `/api/jobs/[id]/complete` after import.
- Preserve ACL/run validation and existing `already_exists` behavior.

### worker f: decision synthesis and retrospective

Files:
- Modify: `web/lib/decision-core-chains.ts`
- Modify: `web/lib/decision-chain-dispatch.ts`
- Modify: `web/app/api/decisions/[id]/guided/synthesize/route.ts`
- Modify: `web/app/api/decisions/[id]/retrospective/route.ts`
- Test: add focused route/dispatcher tests

Requirements:
- Add saved decision core chains:
  - `decision-preference-synthesis`, phase `synthesis`
  - `decision-retrospective`, phase `retrospective`
- Start those routes through `startDecisionChainRun`.
- Preserve phase-2 apply behavior when a `jobId` is posted.
- Preserve decision state fields:
  - `guidedFlow.round1.synthesisJobId`
  - `retroJobId`

## Validator Assignments

Run validators only after implementers finish.

### validator 1: integrations 03-04

Confirm worker a migrated generic jobs:
- `web/app/api/jobs/route.ts`

Checklist:
- no `launchJobRunner` import/call remains
- `recommend` starts `chain_recommendation`
- `generate` starts `chain_generation`
- task metadata still persists before run start
- tests prove response shape and dispatch call

### validator 2: integrations 05-06

Confirm worker a/b migrated:
- `web/app/api/chains/recommend/route.ts`
- `web/app/api/agents/registry/generate/route.ts`

Checklist:
- chain recommend route starts `chain_generation`
- chain recommend rollback boundary remains before dispatch
- agent generation starts `agent`
- both preserve job type and response shape

### validator 3: integrations 07-08

Confirm workers b/c migrated:
- `web/app/api/agents/registry/edit/route.ts`
- `web/app/api/artifact-templates/generate/route.ts`

Checklist:
- `agent_edit` starts `agent_edit`
- `artifact` starts `artifact`
- correct job types preserved
- no profile/model hardcoding
- tests cover both routes

### validator 4: integrations 09-10

Confirm worker d migrated:
- `web/app/api/webhooks/generate/route.ts`
- `web/app/api/events/triggers/generate/route.ts`

Checklist:
- `webhook_inbound` and `webhook_outbound` start `webhook`
- `event_trigger` starts `event_trigger`
- inbound/outbound webhook distinction preserved
- correct job types preserved

### validator 5: integrations 11-12

Confirm worker e migrated:
- `web/app/api/links/generate/route.ts`
- `web/app/api/links/runs/[runId]/generate-summary/route.ts`

Checklist:
- `link` starts `link`
- `link_summary` starts `run_summary`
- summary route preserves ACL and existing summary short-circuit
- summary job still produces `summary.json` through completion route
- response shape remains compatible

### validator 6: integrations 13-14

Confirm workers c/f migrated:
- `web/app/api/generation-templates/test/route.ts`
- `web/lib/decision-core-chains.ts`
- `web/lib/decision-chain-dispatch.ts`
- `web/app/api/decisions/[id]/guided/synthesize/route.ts`

Checklist:
- `template_test` starts `template_test`
- template test semantics remain compatible with raw/non-JSON completion
- `decision-preference-synthesis` installs idempotently
- synthesis route starts decision phase `synthesis`
- phase-2 `jobId` synthesis apply path still works

### validator 7: integration 15 plus final migration scan

Confirm worker f migrated retrospective and final source shape:
- `web/lib/decision-core-chains.ts`
- `web/lib/decision-chain-dispatch.ts`
- `web/app/api/decisions/[id]/retrospective/route.ts`

Checklist:
- `decision-retrospective` installs idempotently
- retrospective route starts decision phase `retrospective`
- phase-2 `jobId` retrospective apply path still works
- import phases match `web/app/api/decisions/[id]/import/route.ts`
- final scan shows no generation route still calling `launchJobRunner`

## Nudge Investigation Assignment

Background explorer only. Do not edit files unless explicitly reassigned.

Investigate:
- stale detection interval and threshold
- completion-event scoping by run id/session id
- why old completion events can suppress nudges
- whether active terminal hash changes are recorded per run or globally
- how advisor profile/default advisor is resolved

Files to inspect:
- `lib/monitor-completion.sh`
- `lib/chain-runner.sh`
- `lib/chain-runner.mjs`
- `web/lib/chain-run-service.ts`
- `tests/bash/test-monitor-completion.sh`
- recent run dirs under `~/.mentiko/namespaces/default/runs/` only if needed

Output:
- root cause hypotheses with evidence
- exact files/lines involved
- suggested failing tests
- no broad implementation unless asked

Result:
- Monitor interval remains 5s by default.
- Advisor nudge threshold remains 3 stable terminal-output checks by default.
- Completion events are scoped to expected emit, current agent id, and run id.
- Open concern: same-run stale completion events can still match before a current
  agent launch/round if the event is old but shares run id, agent id, and emit.
- Suggested next fix: add launch-time or round/session scoping to completion
  event checks, with tests proving old same-run events do not suppress nudges.
- Separate concern: heartbeat blocked-status detection still has Claude-specific
  status text matching; keep the monitor path CLI-agnostic if changing it.

## Validation Results

| validator | agent | status | proof |
|-----------|-------|--------|-------|
| 1 | Plato `019e67b4-cec4-7f20-b7d1-ee23625b6b6b` | approved | `npm test -- __tests__/jobs-generation-chain-dispatch.test.ts` passed 2 tests |
| 2 | Huygens `019e67b4-fbfb-7602-b73f-6b47ef8b281a` | approved | `chains-recommend` + `agents-registry-generation-chain` passed 9 tests |
| 3 | Faraday `019e67b5-26c4-7cb1-95ae-d3055d8c2b16` | approved | agent edit + artifact/template tests passed 5 tests |
| 4 | Franklin `019e67b5-4eca-7412-8d50-78004b91c8e0` | approved | webhook + event trigger tests passed 3 tests |
| 5 | Epicurus `019e67b5-77c3-7352-a2f0-87ab6fc535cd` | approved | link + run summary tests passed 3 tests |
| 6 | Hubble `019e67b5-b142-7723-a24d-d137ddfabb7a` | approved | template + decision tests passed 14 tests |
| 7 | Mencius `019e67b6-3c94-7642-aadb-d9acbdeec3ea` | approved | decision tests passed 12 tests and final scan found no API route launchers |

Final implementation scan:

```bash
rg -n "launchJobRunner\\(" web/app/api web/lib --glob '!**/*.test.ts' --glob '!**/*.test.tsx'
```

Expected result:

```text
web/lib/job-runner-launch.ts:48:export function launchJobRunner({
```

## Live Dev Log Monitor

Source:
- tmux session is currently named `menitko-dev`.
- The user referred to `mentiko-dev`; `tmux list-sessions` showed the actual
  session spelling as `menitko-dev`.

Current findings:
- The app is serving routes from `/Users/malmazan/dev/platform/mentiko/web`.
- `/chains` and `/tasks` routes are responding.
- Log monitor found no current generation-migration-caused server errors.
- Repeated noisy runtime issue:
  - `[ioredis] Unhandled error event: AggregateError`
  - appears while `/api/runs`, `/api/jobs`, `/api/events`, and health polling run.
- Health endpoint also returns 503 after startup grace because disk is critically
  low at 4 percent free. This is an environment health signal, not currently
  attributed to the generation migration.
- One MCP stream `ECONNRESET` was observed and classified as a likely client
  disconnect, not a migration issue.

Assigned agents:
- Linnaeus `019e67c1-11ae-74d2-9fef-06baadffa927`
  - role: read-only tmux log monitor
  - scope: identify live errors and propose exact fix tasks
  - result: complete, no migration-caused log errors visible
- Erdos `019e67c1-fdf1-7722-a5dc-7fda7e725771`
  - role: Redis optional-dependency fix worker
  - scope: stop unhandled ioredis error spam when Redis is unavailable in dev,
    preserve health warning semantics, add focused tests if possible
  - result: complete; Redis now stays unconfigured in non-production unless
    explicitly configured, error events are handled, audit queue warns once
    and skips cleanly
- Beauvoir `019e67c4-70c6-7061-8ef9-548dffcd89c7`
  - role: MCP stream abort logging fix worker
  - scope: classify browser/client disconnects as normal stream cleanup while
    preserving real stream error logging
  - result: complete; abort-shaped `ECONNRESET` stream closes no longer log as
    scary server errors
- Boyle `019e67c7-822c-7073-946f-476a6c66c76a`
  - role: task chain provenance fix worker
  - scope: split recommendation/generation audit runs from actual assigned
    chain execution runs in task metadata and UI
  - result: running

Open fix queue:
- Verify Redis optional-dependency handling after dev process restart.
- Verify MCP stream abort logging against a live disconnect.
- Fix the task UI provenance disconnect where a recommendation audit run can be
  displayed as if it were an assigned-chain execution run.
- Keep disk health as a separate environment issue unless a code path is proven
  to misclassify it.

## Required Regression

Run after integration:

```bash
cd /Users/malmazan/dev/platform/mentiko/web
npm test -- --runInBand --runTestsByPath \
  __tests__/tasks-generate-chain.test.ts \
  __tests__/mentiko-mcp-tasks-generate.test.ts \
  app/api/jobs/[id]/complete/route.test.ts
```

Run all new route tests added by workers.

Run shell/runtime tests:

```bash
cd /Users/malmazan/dev/platform/mentiko
bash tests/bash/test-monitor-completion.sh
bash tests/bash/test-agent-profile-runtime.sh
node tests/chain-runner.test.mjs
```

Run type/lint:

```bash
cd /Users/malmazan/dev/platform/mentiko/web
npx tsc --noEmit --pretty false
npm run lint -- <changed files>
```

Final source scan:

```bash
cd /Users/malmazan/dev/platform/mentiko
rg -n "launchJobRunner\\(" web/app/api web/lib --glob '!**/*.test.ts' --glob '!**/*.test.tsx'
```

Expected after full migration:
- Only `web/lib/job-runner-launch.ts` should define legacy launch support.
- No generation UI/API route should still call `launchJobRunner`.
- Any intentionally unmigrated call must be listed in this doc before ship.

## Final Browser Proof

- Open `/chains` and confirm generation/decision core chains are visible.
- Trigger analyze task / chain recommendation and confirm `/runs` shows `Chain Recommendation`.
- Trigger one non-task generation flow and confirm `/runs` shows the matching core chain.
- Confirm generated result imports back into the existing UI/job result.
