# Mentiko data shape catalog

The browsable catalog is the source map for Mentiko data persisted by the server and execution runtime.

- UI: `/docs/data-shapes`
- API: `GET /api/data-shapes`
- Registry: `web/lib/data-shapes/catalog.ts`
- Runtime inspector: `web/lib/data-shapes/runtime-catalog.ts`
- Canonical JSON Schemas: `lib/schemas/*.schema.json`

The API requires the `view_audit` permission because it inspects the current namespace and organization data roots. It returns structure, counts, source ownership, and validation results. It never returns persisted values. Sensitive stores such as auth, secrets, email, profiles, and PTY ownership expose only safe field or SQLite column metadata.

## Scope

Included:

- JSON, JSONL, key-value, SQLite, text, and mixed runtime stores
- global, namespace, organization, project, run, and external scopes
- schema/type/validator provenance
- writers and readers that own each persisted contract
- live artifact counts, observed field paths, field types, and drift evidence
- runner-v2 attempts, pending handoffs, ledgers, state overlays, and run artifacts

Excluded on purpose:

- ephemeral in-memory values
- browser-only Zustand and localStorage preferences
- arbitrary user workspace/source files whose content is intentionally open
- transient health probes and read-only derived exports
- source files that do not persist data

The registry has an explicit exclusion list for persistence-shaped modules and production writers that fall outside the server/runtime boundary. Its coverage tests scan store/storage/state modules plus filesystem and SQLite writes across `web/lib` and `web/app/api`, so newly added persistence must map to a catalog entry or carry a reviewed exclusion reason.

## Root hierarchy

Mentiko intends this hierarchy:

```text
global
└── namespace
    └── organization
        └── project
            └── run
```

The default organization collapses into the namespace root for backward compatibility. The default project can also collapse into the organization root. Several current run/job stores resolve through namespace or organization paths, so the catalog describes actual paths and notes scope mismatches instead of presenting the intended hierarchy as current behavior.

`web/lib/runner-v2/runtime-paths.ts` is the typed owner of this hierarchy and its contract-directory creation; `runtime-paths-cli.ts` emits the fixed shell export projection. `lib/config.sh` is source-only: it locates that checked-in bundle and evaluates its shell-quoted primitive exports. It does not derive paths or create directories.

## Confidence levels

- `enforced`: a writer, runtime validator, or database schema actively constrains the shape.
- `drift-checked`: a JSON Schema is checked against every matching current artifact when the catalog loads.
- `typed`: producers/readers have a code-level contract, but persisted artifacts are not schema-gated.
- `observed`: the catalog derives structure from current artifacts without claiming a canonical contract.
- `open`: arbitrary producer output is intentional, as with general run artifacts.

Live evidence status is separate from confidence:

- `valid`: all sampled records match the selected canonical schema.
- `drift`: at least one artifact is invalid or unreadable.
- `observed`: artifacts exist and their structure was inspected without a canonical schema.
- `absent`: no matching artifact exists in the current context.
- `unavailable`: the store is external or cannot be sampled through approved roots.

## Physical event contract

Runner events are physical `.event` files containing line-oriented `key: value` fields. They are not JSON. `web/lib/runner-v2/events.ts` normalizes them into the contract in `lib/schemas/event.schema.json`. Event names remain open because chains define handoff vocabulary; the schema documents known system events without closing the set.

## Run and runner-v2 contract

`lib/schemas/run.schema.json` covers the current `run.json` envelope plus runner-v2 attempt history, process evidence, instruction ledgers, transition history, stuck events, and pending routed handoffs.

Runner-facing shapes also carry explicit lineage from `web/lib/data-shapes/runner-lineage.ts`:

- `Runner v2`: only runner-v2 code currently reads or writes the persisted shape.
- `Shared`: runner v2 and the legacy shell runner both read or write it.
- `Legacy shell`: the persisted shape is still shell-only.
- `Typed %`: named lifecycle surfaces owned by runner v2 divided by all mapped surfaces. The denominator is declared behavior, not files, lines of code, or observed artifacts.

Each mapped surface names its current owner and evidence paths. The legacy-equivalent note states what the typed contract replaced or, when no persisted predecessor existed, says so directly.

No registered shape names a `.sh` file as a writer, reader, type source, or validator. `dataShapeShellSources()` returns empty for every entry, and the catalog test `has no documented data shape with a direct shell contract owner` fails the suite if that stops being true. Shell files still appear as surface *evidence* — `lib/chain-runner.sh`, `lib/session-transport.sh`, `lib/run-lib.sh`, `lib/retry-utils.sh`, and peers — but only on surfaces whose owner is runner-v2, where shell forwards primitive arguments into a compiled typed CLI or invokes the external agent/PTY binary that is the product behavior. Shell owns no data contract and no orchestration decision.

Every mapped lifecycle surface in `runner-lineage.ts` is currently owned by runner-v2; no surface carries the `legacy-shell` owner, so every mapped shape reports `Typed % = 100`. `pty-daemon-session-projection` is the only shape still labelled `Shared`, and both of its surfaces are runner-v2-owned: the typed PTY socket client owns daemon identity and readiness projection, while the shell boundary forwards primitive transport commands and invokes the external PTY CLI. The `Legacy shell` label remains in the type union but currently matches no shape and no surface.

`runner-v2-pending-handoff` shows how a retired contract is recorded. It maps two surfaces, both runner-v2-owned — `typed-handoff-cleanup` reads and clears pre-cutover evidence, `typed-handoff-reconciliation` retires live legacy records. Its predecessor was not shell: earlier typed completion code in `web/lib/runner-v2/adapters.ts` wrote these receipts around detached routed launches. Routed launch now proves delivery synchronously, verifying run agent, session, and AgentAttempt state before consuming the parent event, so no new pending handoff receipt is ever written. The shape persists only so reconciliation can clear pre-cutover records.

Catalog tests require every direct `web/lib/runner-v2/*` or runner shell source reference to have lineage, verify the ownership label against current readers and writers, and existence-check every lineage evidence path.

`GET /api/data-shapes` and `web/lib/data-shapes/catalog.ts` are the count of record; the registry holds 110 shapes as of this commit. Do not treat any count written into this page as current.

A one-time drift repair ran on 2026-07-14 against one developer's local default namespace. Those figures are a dated observation of that machine, not a standing property of the system, and the local namespace has since grown well past the run count sampled below:

- `run.json`: 38 of 38 records matched `run.schema.json` at that time. Two orphaned blocked/stopped job-route test fixtures were moved intact out of the live runs root, and that test now uses an isolated temporary data root plus canonical run fixtures.
- generated task definitions: 3 of 3 sampled `draft-child-tasks.json` artifacts matched `task.schema.json`. The event-artifact producer now emits an epic parent with newline-delimited acceptance criteria, validates before the atomic write, and validates again before import.

The schemas were not weakened. The repair command is dry-run by default, requires exact expected counts before applying, keeps sibling backups for normalized task drafts, and quarantines leaked test-run directories without deleting them:

```bash
cd web
npm run repair:data-shape-drift
npm run repair:data-shape-drift -- --apply --expect-runs=2 --expect-tasks=3
```

## Adding or changing persisted data

1. Add or update the registry entry with exact storage, scope, format, source type, validators, writers, and readers.
2. Add a sample pattern only when the runtime inspector can read it without exposing values.
3. Add or update a canonical JSON Schema when the artifact is intended to be closed and validated.
4. Run the catalog coverage and runtime tests.
5. Load `/docs/data-shapes` against a real namespace and inspect the evidence status.
6. If live artifacts drift, fix the producer or perform an explicit migration. Do not relax the contract solely to hide drift.

## Verification

Targeted tests:

```bash
cd web
npx jest --runInBand \
  lib/__tests__/data-shapes-catalog.test.ts \
  lib/__tests__/data-shapes-runtime.test.ts \
  app/api/data-shapes/route.test.ts \
  lib/data-shapes/__tests__/clipboard.test.ts \
  components/docs/__tests__/runner-lineage.test.tsx \
  lib/__tests__/engine-event-contract.test.ts
```

Auth coverage:

```bash
cd ..
node scripts/check-auth-coverage.mjs
```
