# runner-v2 gap fix todo

status: draft
scope: runner-v2 switch blockers discovered while reviewing FEAT-019 failures

note: `web/lib/runner-v2/phase-plan.ts`, referenced in the completed items
below, was deleted in `0ac3f84` — the same commit that landed the shared
payload contract. Those file lists are a record of what the work touched at the
time, not current paths.

todo:
  ☑ make generation import authoritative for core generation completions
    files:
      - web/lib/runner-v2/completion-runner.ts
      - web/lib/runner-v2/completion-entrypoint.ts
      - web/lib/runner-v2/phase-plan.ts
      - web/lib/runner-v2/adapters.ts
    fix:
      - when a core generation run reaches completion without its declared emit,
        check for an importable generation payload before failing the run.
      - if the payload imports, mark the generation job complete and terminally
        complete or route according to the chain's stop behavior.
      - only allow this salvage path for coreGenerationChain/generationKind runs
        whose agent reached the completion handler.
    tests:
      - no-emit core generation run with valid generation-result.json imports.
      - no-emit normal multi-agent routing run still fails or retries.
      - quality gate failure still blocks import.

  ☑ wire runner-v2 generation import into the real completion entrypoint
    files:
      - web/lib/runner-v2/completion-entrypoint.ts
      - web/lib/runner-v2/executor.ts
      - web/lib/runner-v2/adapters.ts
    fix:
      - phase-plan currently models generation-import, but completion-entrypoint
        does not call it.
      - add typed executor effects for generation-import and generation-failed.
      - execute generation import through the existing CLI/import API path with
        run-scoped token handling.
    tests:
      - completion-entrypoint plans and applies generation-import before routing.
      - adapter dry-run reports generation-import without mutating.
      - import failure marks generation job failed and stops routing.

  ☑ remove mandatory emit wording for core generation chains
    files:
      - lib/chain-runner.sh
      - web/lib/runner-v2/agent-bootstrap-plan.ts
      - web/lib/generation/generation-core-chains.ts
    fix:
      - keep mandatory mentiko emit for normal routing agents.
      - for core generation chains, make emit optional or omit the emit footer.
      - keep AGENT_COMPLETE as the terminal marker.
    tests:
      - rendered core generation instructions do not contain mandatory
        "mentiko emit".
      - rendered normal chain agent instructions still require mentiko emit.

  ☑ strip prompt text from recommendation chain catalog
    files:
      - web/lib/chains/chain-utils.ts
      - web/lib/__tests__/chain-utils.test.ts
    fix:
      - buildChainSummary should include chain identity, description, agents,
        triggers, emits, and artifacts.
      - do not include prompt/prompt_hint text in the catalog used by
        chain_recommendation.
    tests:
      - chain catalog no longer contains "prompt_hint".
      - core generation import instructions do not appear inside
        {{CHAIN_CATALOG}}.

  ☑ tighten generation payload compatibility
    files:
      - lib/mentiko-cli-generation.mjs
      - tests/node/generation-salvage.test.mjs
    fix:
      - require chain_recommendation payloads to have a valid recommendation
        object or recognizable recommendation action.
      - keep canonical generation-result.json priority.
      - accept salvage sources only after compatibility validation.
    tests:
      - valid chain_recommendation imports.
      - unrelated JSON artifact is rejected for chain_recommendation.
      - transcript/raw-output salvage still works for valid payloads.

  ☑ add first-class already-satisfied recommendation convergence
    files:
      - web/lib/tasks/task-chain-recommendation.ts
      - web/app/api/tasks/auto-run/route.ts
      - web/lib/generation/generation-template-storage.ts
      - web/lib/__tests__/task-chain-recommendation.test.ts
      - web/app/api/tasks/auto-run/route.test.ts
    fix:
      - add action "no_action_needed" or "already_satisfied".
      - update the recommendation template to allow this state with evidence.
      - auto-run should clear/disable auto_run and move task to human review
        instead of launching more recommendation jobs.
    tests:
      - already-satisfied recommendation stops auto_run.
      - task metadata records evidence/reason.
      - use_existing and generate_new behavior is unchanged.

  ☑ recover pruned/missing generation jobs from run artifacts
    files:
      - web/app/api/tasks/auto-run/route.ts
      - web/app/api/tasks/auto-run/route.test.ts
    fix:
      - when generation_job_id is missing from job storage, inspect
        generated_chain_run_id artifacts before marking generation_status
        missing.
      - if a valid generated chain is recovered, save/assign it through the same
        path as a complete job.
    tests:
      - missing generation job with valid run artifact recovers.
      - missing generation job without artifact increments retry as today.

  ☑ add runner-v2 switch-readiness blockers for these gaps
    files:
      - web/lib/runner-v2/switch-readiness.ts
      - web/lib/runner-v2/switch-readiness.test.ts
      - docs/orchestration/contracts/runner-v2-contract.json
    fix:
      - block switch readiness until no-emit generation salvage is covered.
      - block switch readiness until phase-plan generation import is wired into
        completion-entrypoint.
      - block switch readiness until core generation prompts no longer require
        mandatory emit.
    tests:
      - readiness fails before fixes.
      - readiness passes only when proof fixtures include these cases.

verify:
  ☑ run npm test -- runner-v2 targeted set
  ☑ run node tests/node/generation-salvage.test.mjs
  ☑ run targeted auto-run tests
  ☑ replay a no-emit core generation run in dry-run runner-v2 mode
  ☑ check switch-readiness report
  ☑ audit saved/generated chains for dead branch fan_out wiring

remaining:
  ☐ runtime verify a fresh generated fan_out chain launches a fan-group in
    parallel instead of serial handoff.
  ☐ decide whether to migrate existing dirty saved chains. audit found 38
    chain/run chain.json files under ~/.mentiko/namespaces/default with branch
    keys no agent emits or branch targets that no saved agent id/ref matches.

open blockers (found 2026-07-08 reviewing TASK-097 — a completed recommendation
chain re-runs on every scan; auto-run "fix" left this half-closed):

  ☑ make the recommendation auto-accept consumer envelope-aware (parity with generation)
    context:
      - job-store hydration (readCompletedRunResult, web/lib/runs/job-store.ts)
        recovers a completed recommend/generate job by wrapping the run artifact
        as { output: "<json string>" }. isGenerationArtifactJob matches BOTH
        "generate" AND "recommend", so recommend jobs hydrate to this envelope too.
      - the generation consumer unwraps it: extractGeneratedChain parses
        result.output (auto-run/route.ts ~402). the recommendation consumer does
        NOT: case 3 tests `job.result?.recommendation` (auto-run/route.ts ~638),
        which is undefined for the { output } envelope. control falls through to
        case 4 (startAnalysisJob) and launches a fresh chain_recommendation run
        every scan — the "chains running that already completed" symptom.
      - this DEFEATS the "already-satisfied recommendation stops auto_run"
        convergence item above (line ~83): the terminal action is never read, so
        it can never fire.
      - unwrapAgentJsonOutput (web/lib/tasks/agent-json-output.ts) is the right
        tool and already exists, but is wired only into the outcome-summary write
        (jobs/[id]/complete/route.ts ~446), not into this auto-accept path.
    files:
      - web/app/api/tasks/auto-run/route.ts
      - web/lib/runs/job-store.ts
      - web/lib/tasks/agent-json-output.ts
      - web/app/api/tasks/auto-run/route.test.ts
    fix:
      - before case 3's check, unwrap: payload = unwrapAgentJsonOutput(job.result);
        recommendation = payload?.recommendation ?? payload; then route as today
        through normalizeTaskChainRecommendation(recommendation).
    tests:
      - a hydrated recommend job (result = { output: "<recommendation json>" })
        auto-accepts instead of re-launching analysis.  <-- CURRENTLY UNCOVERED:
        every mockGetJob fixture uses the pre-unwrapped { recommendation } shape,
        which is why CI is green while prod loops.
      - normal { recommendation: {...} } shape still auto-accepts (no regression).

  ☑ bound the re-analysis loop with the retry ceiling
    context:
      - startAnalysisJob (case 4) never increments auto_run_retries, so
        MAX_AUTO_RUN_RETRIES cannot contain a repeating re-analysis — only the
        failure branches bump retries. combined with the envelope gap above this
        is an UNBOUNDED loop, not a 3-strike stop.
    files:
      - web/app/api/tasks/auto-run/route.ts
      - web/app/api/tasks/auto-run/route.test.ts
    fix:
      - increment auto_run_retries when re-entering analysis for a task that
        already had a completed analysis job this episode, so the ceiling trips
        even if the envelope fix regresses.
    tests:
      - repeated re-analysis on one task stops after MAX_AUTO_RUN_RETRIES.

  ☑ admission gate: presence-check chain_id, not truthiness (defense in depth)
    RESOLVED in working tree — verified 2026-07-08. this was documented as a live
    `&& chainId` truthiness bug, but the current code already fixed it: canAdmitAutoRun
    uses `chainId !== undefined` (web/lib/runs/auto-run.ts:325), not truthiness. so
    chain_id:"" (which task-transforms' String(metadata.chain_id||"") can produce) is a
    present-but-falsy key and STILL blocks re-admission of a completed execution, while a
    genuinely-absent chain_id (undefined) still passes through to the recommendation/
    generation phase unchanged.
    evidence:
      - guard: web/lib/runs/auto-run.ts:325 (`&& chainId !== undefined`)
      - test:  web/lib/__tests__/auto-run.test.ts:411 ("rejects a completed run when
        chain_id is present but empty") — passing.

  ☐ STRUCTURAL: one validated job-result shape across both consumer paths
    (this is the root cause behind the three tactical items above — audit 2026-07-08;
     shared-validator half landed, envelope + typing still open — recheck 2026-07-15)
    context:
      - the shared validator now EXISTS: web/lib/generation/payload-contract.ts
        owns isPayloadCompatibleWithKind, normalizeResultForKind,
        jobTypeToGenerationKind, and the GenerationKind union. It replaced
        lib/mentiko-cli-generation.mjs, deleted in ef34d30.
      - all three consumer doors now import it, so "two readers, two shapes, no
        shared parser" no longer holds:
          web/lib/runs/job-store.ts readCompletedRunResult (in-process hydration)
          web/lib/runner-v2/completion-entrypoint.ts (CLI import path)
          web/app/api/tasks/auto-run/route.ts
        readCompletedRunResult no longer trusts the file raw — it returns
        undefined when isPayloadCompatibleWithKind rejects the parsed payload.
      - STILL OPEN: the { output: "<json string>" } envelope survives.
        result.output is the raw text of generation-result.json, so consumers
        must still parse it, and normalizeResultForKind re-wraps bare objects the
        same way. This is now recorded as a catalog contract on the job-record
        shape, not an accident.
      - STILL OPEN: job.result is Record<string, unknown>
        (web/lib/runs/job-record.ts:22) — only the job envelope is typed, the
        sub-paths under input/result are unmodeled, so the compiler stays blind
        to producer/consumer drift.
      - the event-template-artifact-contract was meant to be the "schema
        expectations" home, but it is half-enforced: the quality_gate.failed
        triage flow is wired live (event-artifact-runner.ts, called from
        runner-v2 completion-entrypoint.ts), yet the runner never dereferences
        mapping.generationTemplateId/artifactTemplateId and never validates the
        emitted artifact against artifactSchema — it hardcodes the shape and
        stamps the schema id as an inert label. the /artifacts editor +
        artifact-template-storage.ts are wired to their own CRUD but are NOT read
        at runtime (orphaned as a source of truth). no event-mapping editor
        exists — mappings are code defaults (event-template-map.ts) only.
    fix:
      - ☑ extract the CLI validator/normalizer into a shared TS module
        (kind-aware) and route readCompletedRunResult (kind from job.type)
        through it, so in-process hydration and CLI import validate against the
        SAME contract. Landed as web/lib/generation/payload-contract.ts.
      - ☐ drop the { output } envelope from job.result so consumers drop the
        ad-hoc unwrap (auto-run's unwrapAgentJsonOutput +
        payload?.recommendation ?? payload).
      - ☐ give job.result a discriminated type per job kind + a schema test, so a
        producer/consumer shape drift is a compile/test failure, not a silent loop.
      - (contract) make event-artifact-runner consume the referenced artifact
        template and validate the emitted artifact against its schema, so the
        /artifacts editor becomes the real schema source of truth instead of an
        orphaned surface.
    note:
      - bigger than the TASK-097 hotfix. keep the tactical case-3 unwrap for now;
        this is the durable fix behind it.

scope note:
  none of the *.contract.json files own this behavior. that set is the shell->TS
  runtime layer (launch/monitor/completion/events). the task-lifecycle reducer
  spec explicitly keeps admission — analysis, chain generation, execution start —
  external in v1 (see "Execution admission (external in v1)"), so the reducer
  contract does not assert it either. auto-run admission + job-result hydration is
  owned by triggerAutoRun/reconcile and tracked HERE. if we want an enforced
  invariant, the home is a switch-readiness blocker (see line ~114) plus the
  route test above, not a new .contract.json.
