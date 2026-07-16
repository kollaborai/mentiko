# Hybrid Orchestration

TypeScript owns every runtime data contract and every orchestration decision.
Shell survives in two narrow roles: as a minimal boundary that forwards
primitive arguments into compiled typed code, and as the thing that executes an
external CLI which is itself the product behavior.

## The rule

Shell must never own a data contract or an orchestration decision. It may
remain only to:

1. exec into compiled typed code, passing primitives and returning its result, or
2. invoke an external command (the agent CLI, `pty-mgr`, `git`, `diff`, `rclone`)
   where running that command *is* the product behavior.

There are no shell fallbacks. If the typed runtime is missing, the boundary
fails closed rather than reimplementing the contract in bash.

The measurable consequence: `lib/chain-runner.sh` and `lib/agent-functions.sh`
contain zero `jq` calls. No shell file in the orchestration path parses or
serializes chain, run, or event JSON.

## Where the line falls

TypeScript (`web/lib/**`, compiled to `lib/runner-*.js`) owns:

- chain validation, agent and profile resolution, command compilation
- run record creation and every locked `run.json` mutation
- event serialization, validation, lookup, processed mutation, archival
- completion capture, routing, retries, fan-in/fan-out, run completion
- concurrency admission, retry policy and circuit state, approval gates
- the chain watcher and watchdog, as long-running services under
  `web/server/background-worker.ts`

Shell owns:

- sequencing the launch and starting the agent in a PTY session
- forwarding primitive arguments to a typed CLI

## What a boundary actually looks like

The whole of `lib/run-record-client.sh` is the seam through which every run
operation passes:

```bash
_run_record_cli() {
  local cli="${MENTIKO_CODE_ROOT:?MENTIKO_CODE_ROOT must be configured}/lib/runner-run-record.js"
  if ! command -v node >/dev/null 2>&1; then
    echo "  mentiko: node is required for typed run records" >&2
    return 1
  fi
  if [[ ! -f "$cli" ]]; then
    echo "  mentiko: typed run-record bundle missing: $cli" >&2
    return 1
  fi
  node "$cli" "$@"
}
```

`lib/run-lib.sh` then reads as pure forwarding — no JSON, no fallback:

```bash
# args: <run-id> <status> [status_message]
update-run-status() {
    local run_id="$1"
    local status="$2"
    local status_message="${3:-}"

    local args=(set-status --runs-dir "$RUNS_DIR" --run-id "$run_id" --status "$status")
    [[ -n "$status_message" ]] && args+=(--message "$status_message")
    _run_record_cli "${args[@]}" >/dev/null
}
```

`lib/validate.sh` is 14 lines and does nothing but invoke
`runner-chain-validation.js`. `lib/routing-lib.sh` is 40 lines of one-line
forwards, with a comment stating it must never parse chain routing JSON itself.

## Compiled bundles

Typed code reaches shell as esbuild bundles in `lib/`, because these processes
start outside the Next.js module graph. `lib/` holds 43 of them.
`tests/runner-typed-bundle-parity.test.mjs` rebuilds 28 from source and fails if
any has drifted. The remaining 15 — including `runner-run-record.js` and
`runner-event-emitter.js` — have no parity guard. Never edit a bundle by hand;
change the TypeScript source and rebuild.

## Why shell remains at all

Not because bash is good at JSON — it is not, and it no longer does any. The
launch path is a process boundary: fork a PTY, set an environment, exec a CLI,
exit. That is what a shell is for, and rewriting it in TypeScript would buy
nothing while adding a runtime hop in front of every agent start.

Everything above that boundary — anything that reads a contract, decides what
runs next, or writes state — is TypeScript, because those are exactly the places
where bash's lack of types, its silent error paths, and its untestability caused
real incidents.

## Known rough edge

`lib/chain-runner.sh` is 1902 lines. It parses no JSON and owns no contract, but
it is still a large amount of shell sequencing the launch. It is the strongest
remaining candidate for further typed migration.

## Not a loop

`chain-runner.sh` launches ONE agent and exits. It does not iterate over a
dependency graph. When an agent finishes, its companion monitor invokes the
typed completion entrypoint, which decides what runs next and durably accepts
the target before consuming the parent event. This is what keeps a crash in one
agent from cascading, and it is why there is no `for agent in ...` loop anywhere
in the runner.

## Related

- [Single-Machine Deployment](/architecture/without-kubernetes)
- [PTY Sessions](/architecture/pty-sessions)
- [File-Based Events](/architecture/file-events)
- [Agent Chains](/concepts/agent-chains)
