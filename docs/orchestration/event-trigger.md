# Runner event lifecycle

This path is retained for inbound documentation links. The active event system
is TypeScript-owned; no runtime path sources a shell event-lifecycle library.

See also:

- [chain-watcher.md](./chain-watcher.md) for cross-chain event triggers.
- [completion-entrypoint.md](./completion-entrypoint.md) for completion routing.

## Active components

- `web/lib/runner-v2/events.ts` defines strict raw-file validation, normalized
  records, and canonical serialization.
- `web/lib/runner-v2/event-emitter.ts` owns timestamps, filenames, validation,
  and atomic no-clobber writes.
- `web/lib/runner-v2/event-lifecycle.ts` owns strict scans, completion lookup,
  processed mutation, and scoped archival.
- `web/lib/runner-v2/event-lifecycle-cli.ts` exposes the typed lifecycle to
  shell process boundaries through the compiled
  `lib/runner-event-lifecycle.js` entrypoint.
- `web/lib/runner-v2/chain-watcher-service.ts` watches the configured event root
  and launches matching chains.

## Event format

Runner events are canonical lowercase `key: value` lines:

```text
event: agent-complete
source: agent-id
run_id: run-1784102007562-bb990ff5
timestamp: 2026-03-12T10:00:00-07:00
processed: false
data: result written to the workspace
```

Every raw file must contain `event`, `source`, `run_id`, `timestamp`,
`processed`, and `data` exactly once. Optional extension fields must be
lowercase, unique, and non-colliding. JSON, aliases, duplicate fields, missing
fields, noncanonical key casing, and filename-derived ownership fail closed.

The authoritative root is the configured absolute `{runtimeRoot}/events` for
the active namespace, organization, and project. Callers must pass that root;
the lifecycle does not guess a provider or workspace path.

## Emitting events

Agents and operators use the public command:

```bash
mentiko emit "build-complete" "builder" "status=success"
```

Run scope is the default and requires `MENTIKO_RUN_ID` or `RUN_ID`. Intentional
runless ingress must be explicit:

```bash
mentiko emit --scope ingress "custom-event" "operator"
```

Both paths invoke the typed emitter. No shell boundary constructs event bytes.

## Listing events

The public listing command invokes typed lifecycle `list`:

```bash
mentiko events
mentiko events --unprocessed
```

Invalid physical files are reported as invalid and never normalized into
operational records.

## Completion lookup and consumption

Runtime completion callers invoke the compiled typed CLI with an explicit
configured root and nonempty run identity.

Lookup:

```bash
node "$MENTIKO_CODE_ROOT/lib/runner-event-lifecycle.js" find \
  --events-dir "$EVENTS_DIR" \
  --run-id "$RUN_ID" \
  --expected-event "$EXPECTED_EVENT" \
  --agent-id "$MENTIKO_AGENT_ID" \
  --session-name "$MENTIKO_SESSION_ID" \
  --all-agent-id "$MENTIKO_AGENT_ID"
```

Consumption:

```bash
node "$MENTIKO_CODE_ROOT/lib/runner-event-lifecycle.js" consume \
  --events-dir "$EVENTS_DIR" \
  --run-id "$RUN_ID" \
  --source "$MENTIKO_AGENT_ID" \
  --triggered "$TRIGGERED_EVENT" \
  --session-name "$MENTIKO_SESSION_ID" \
  --all-agent-id "$MENTIKO_AGENT_ID"
```

Callers pass every chain agent ID as a repeated `--all-agent-id` argument. That
full identity set prevents prefix-sharing siblings from being mistaken for the
current owner.

Completion planning first captures the direct active trigger's exact raw-byte
hash, normalized-record hash, and stable file-generation token before any
downstream launch. `consume` then operates under the shared event-lifecycle
claim:

1. Resolve the explicit trigger as a direct canonical `.event` child of the
   configured root.
2. Require the live file to match that exact accepted fingerprint, then strictly
   validate the requested run, guarded owner, and optional expected event.
3. Strictly scan remaining active files and archive only owned siblings with the
   same exact nonempty `run_id` and guarded agent/session ownership. Any sibling
   failure leaves the exact trigger active as the retry token.
4. Prepare the trigger's `processed: true` archive representation without first
   mutating or removing the active source, and claim its archive destination
   without overwriting an existing basename.
5. Claim an immutable version-2 JSON receipt at
   `.event-receipt-<sha256(sourceFilename + NUL + runId)>-<fileGenerationToken>-<sha256(acceptedRawBytes)>.json`,
   binding role, monotonic occurrence, source filename, run ID, destination,
   file-generation token, accepted raw hash, accepted normalized-record hash,
   and processed archive hash.
6. Re-read the exact trigger, require its bytes and file generation to remain
   unchanged, and unlink it last.
7. Leave sibling-agent, other-run, runless-ingress, and invalid files in place.

Repeated consumption is idempotent only when the caller carries the exact
pre-launch file-generation token plus accepted raw and normalized hashes. That
identity selects one receipt, which must also validate the requested run, owner,
optional expected event, destination hash, and strict processed body. An older
same-path receipt cannot authorize different content, and unlinking/recreating
byte-identical content creates a new occurrence token. Completion discovery
remains active-file-only; receipts never fabricate a later attempt's success.
This ordering lets a retry finish safely after a receipt claim while preserving
the trigger whenever launch, synchronous-effect, or owned-sibling cleanup fails.
Once that exact trigger is already archived, replay returns immediately; it does
not scan or consume later live files that happen to share the run and owner.

## Chain-watcher behavior

The typed chain watcher scans canonical active events, evaluates
`config.event_triggers`, and records one durable handled marker per trigger. A
handled marker is separate from the completion lifecycle's `processed` field.
The watcher does not archive completion events.

## Historical shell helper

`lib/event-trigger.sh` previously exposed emission, listing, processed mutation,
and archive helpers. It is not an active compatibility path and is not sourced
by the runner, monitor, completion handler, CLI, watcher, or watchdog. The old
global archive sweep remains useful only as the historical bug that the scoped
typed lifecycle must never reintroduce.

## Troubleshooting

Event not triggering a chain:

- Run `mentiko events --unprocessed` and confirm the file is valid.
- Verify the event name matches the chain trigger.
- Inspect the event's per-trigger handled marker and chain-watcher status.
- Check background-worker and chain-watcher logs.

Completion not finding an event:

- Confirm `EVENTS_DIR` is the configured absolute runtime event root.
- Confirm the body contains the exact active `run_id`.
- Confirm `source` identifies the completing agent or session.
- Do not hand-write files or rely on the filename for provenance.
