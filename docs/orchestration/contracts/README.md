# runner contracts

these files are the migration source of truth for runner-v2.

rules:
  - contracts describe actual runtime behavior, not aspirational schemas.
  - each shell function copied into typescript needs a matching contract entry.
  - runner-v2 may only become default after parity tests cover the contract.
  - every contract change should name the shell file and function it came from.

current files:
  - runner-v2-contract.json: cross-cutting launch, monitor, watcher, watchdog,
    run.json, and event-file invariants for the first side-by-side v2 pass.
  - chain-runner.contract.json: launch/admission/session/startup contract for
    lib/chain-runner.sh.
  - chain-runner-complete.contract.json: completion/routing/artifact contract for
    lib/chain-runner-complete.sh.
  - monitor.contract.json: monitor latch, idle, advisor, and diagnostics contract
    for lib/agent-functions.sh and lib/monitor-completion.sh.
  - run-event.contract.json: run.json and event-file mutation contract for
    lib/run-lib.sh and lib/event-trigger.sh.
  - watcher-watchdog.contract.json: daemon, watcher, watchdog, and scheduler
    polling contracts for lib/chain-event-watcher.sh and lib/watchdog.sh.
