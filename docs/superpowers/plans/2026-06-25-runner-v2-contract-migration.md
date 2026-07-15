# runner v2 contract migration

> Historical plan snapshot. The shell completion ownership described below was
> the state when this plan was written; that handler has since been deleted and
> `web/lib/runner-v2/completion-entrypoint.ts` is the active completion owner.

goal:
  migrate chain orchestration from fragmented bash authority to a side-by-side
  typescript controller that can be enabled by flag after parity validation.

constraints:
  - default behavior remains the current shell runner.
  - runner v2 is off unless MENTIKO_RUNNER_V2=1.
  - no shell logic is deleted during this phase.
  - contracts are extracted from actual scripts, not stale schemas.
  - run/event disk formats stay byte-compatible where agents and watchers rely on them.

phases:
  1. extract contracts for chain-runner, completion, monitor, run/event,
     watcher, watchdog, scheduler, and daemon/session boundaries.
  2. store contracts as machine-readable json with invariant checklists.
  3. add a typescript runner-v2 module beside existing web run launch code.
  4. wire only the initial web launch behind MENTIKO_RUNNER_V2.
  5. keep completion re-entry in shell until the completion contract is fully
     mirrored and tested.
  6. add parity tests proving flag-off preserves current command and flag-on
     selects v2 without replacing run.json/event semantics.

handoff boundaries:
  - web/lib/runs/chain-run-service.ts owns first launch selection.
  - web/lib/runner-v2 owns contracts, capability checks, and launch plan output.
  - lib/chain-runner-complete.sh remains the continuation owner until v2
    completion tests exist.

acceptance:
  - npm test -- runner-v2
  - npx tsc --noEmit --pretty false
  - npm run lint
  - watched runtime test with MENTIKO_RUNNER_V2=1 before making v2 default.
