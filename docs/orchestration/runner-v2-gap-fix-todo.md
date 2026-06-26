# runner-v2 gap fix todo

status: draft
scope: runner-v2 switch blockers discovered while reviewing FEAT-019 failures

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
