# runner contracts

these files are the migration source of truth for runner-v2.

rules:
  - contracts describe actual runtime behavior, not aspirational schemas.
  - each ownership migration from shell to typescript needs a matching contract entry and binding evidence.
  - runner-v2 may only become default after parity tests cover the contract.
  - migration-history evidence may name the shell file/function it replaced;
    current ownership must name the typed owner and must not imply that a
    compatibility filename still owns lifecycle work.

## naming convention (read this before adding a file)

there are FOUR kinds of file here, distinguished by suffix. the dot vs dash
distinction is load-bearing — do not mix them:

  - `<name>.contract.json` (dot)  — ENFORCEABLE per-implementation contract.
    only its `owns` + `invariants` arrays are binding. loaded by
    `web/lib/runner-v2/contracts.ts` (`IMPLEMENTATION_CONTRACT_FILES`); every
    line is bound by the switch-readiness gate, so no requirement can be
    silently dropped. this is the canonical style — new contracts use it.
  - `runner-v2-contract.json` (dash) — the one CROSS-CUTTING enforceable
    contract. loaded by `contracts.ts` (`CONTRACT_PATH`); its
    `implementation_coverage` binds the per-implementation dot-files above.
    the dash here is historical, not a second convention to copy.
  - `<name>.design.json` — NON-enforceable design + migration rationale. prose:
    the why, the plan, the deletion gate. no code loads it; referenced only from
    source comments and docs. use this suffix for anything that is a narrative,
    not a checkable contract.
  - `runner-v2-*-proof.json` — live-run PROOF artifacts (not hand-authored).
    emitted by `web/scripts/runner-v2-*-proof.cjs` and consumed by
    `web/lib/runner-v2/switch-readiness.ts` as evidence the flagged path ran.

### the monitor-v2 pair (why there look like two)

monitor-v2 is the only concern with BOTH a design doc and an enforceable
contract, so its two files sit side by side and look like a duplicate. they are
not — they are a deliberate split:

  - `monitor-v2.design.json`   — design rationale + migration plan (the TASK-093
    split-brain fix, entrypoints, deletion gate). NOT enforced.
    (was `monitor-v2-contract.json` until 2026-07-14; renamed to end the
    dot/dash `.contract`-vs-`-contract` confusion.)
  - `monitor-v2.contract.json` — the enforceable owns/invariants, bound by the
    switch-readiness gate. this is the one code loads.

## current files

enforceable contracts (loaded by contracts.ts, bound by the switch gate):
  - runner-v2-contract.json: cross-cutting launch, monitor, watcher, watchdog,
    run.json, and event-file invariants for the first side-by-side v2 pass;
    `implementation_coverage` binds the per-implementation contracts below.
  - chain-runner.contract.json: typed direct launch/admission/session/startup
    contract. `lib/chain-runner.sh` is an invocation-only compatibility exec.
  - completion-entrypoint.contract.json: typed completion, strict event
    ownership, durable route acceptance, artifact, and terminal-state contract.
  - monitor.contract.json: typed monitor latch, idle, advisor, diagnostics,
    and session-cleanup contract. `agent-functions.sh` is only the manual
    monitor forwarding boundary and has no chain-monitor behavior.
  - monitor-v2.contract.json: enforceable owns/invariants for the typed chain
    monitor (web/lib/runner-v2/monitor*.ts). The shell monitor is retired.
  - run-event.contract.json: run.json mutation plus runner-event contract. typed
    code owns canonical emission, strict scans, completion lookup, processed
    mutation, and scoped archive lifecycle. shell process boundaries invoke the
    compiled typed CLIs and do not parse or mutate event files themselves.
  - watcher-watchdog.contract.json: active chain-watcher/watchdog ownership in
    web/lib/runner-v2/chain-watcher-service.ts, web/lib/runner-v2/watchdog.ts,
    and web/server/background-worker.ts. the retired shell files remain listed
    only as parity references; the scheduler invariant remains independently bound.
  - git-integration.contract.json: typed status/history/diff projection ownership
    for lib/git-integration.sh. Git remains the required external CLI; the shell
    file is only a primitive invocation boundary.
  - chain-version-control.contract.json: typed semver, snapshot, metadata,
    rollback, and comparison ownership in the typed runtime. The external
    diff command remains the only child-process product behavior.
  - audit-ship.contract.json: typed raw/normalized audit-entry validation,
    remote-key derivation, rclone retry, and failure-breadcrumb ownership;
    the audit writer launches its compiled owner directly.
  - notification-dispatch.contract.json: typed notification envelope,
    chain-started mapping, response validation, and HTTP dispatch ownership for
    lib/notification-dispatcher.sh.

design docs (rationale + migration plan, not enforced):
  - monitor-v2.design.json: historical rationale for the former shell-monitor
    migration (the TASK-093 liveness split-brain). It is not a current owner
    map; pairs with monitor-v2.contract.json above.
  - teammux-bridge.design.json: typed ownership of external team-mux agent/spec
    and memory records, with the shell invocation boundary and deletion gate.
  - chain-version-control.design.json: typed ownership of chain version,
    metadata, snapshot, rollback, and comparison records; external `diff`
    remains the only child-process behavior.
  - plugin-native-handlers.design.json: typed ownership of the non-Slack
    built-in GitHub PR, Linear, email notification, and email digest handlers.

proof artifacts (emitted by live runs, consumed by switch-readiness.ts):
  - runner-v2-runtime-proof.json: MENTIKO_RUNNER_V2 live launch proof.
  - runner-v2-watched-proof.json: watched side-by-side v2 run proof.
