# Database lifecycle package

This folder is the design and verification package for the proposed
database-backed Mentiko lifecycle. It is not a migration, a production schema,
or proof that the current runtime already has database authority.

## authority and artifact roles

- `spec.md` is the canonical proposed contract. Its 22 acceptance cases are
  the source requirements; section 5.2 intentionally keeps one database column
  per Markdown table row.
- `schemas/` contains proposed machine-readable shapes for example records and
  scenarios. These shapes are design artifacts until an implementation adopts
  them.
- `examples/` contains concrete records and a complete end-to-end lifecycle
  trace. Each file labels proposed schema choices separately from current
  runtime observations.
- `fixtures/` contains deterministic scenario inputs, expected transitions,
  durable commands, final state, and explicit negative assertions.
- `contracts/` maps stable requirement IDs to the 22 acceptance cases, the
  scenarios that exercise them, and the evidence required before implementation
  can be called complete.
- `verification/` runs the reference model and validates the package in an
  isolated temporary namespace, SQLite database, and artifact root. A passing
  harness proves fixture/model consistency only; it does not prove production
  runtime parity.
- `verification/design-gaps.md` records the implementation and proof gaps
  exposed by comparing the package with the current task store, reducer and
  typed runner.

The current runtime remains authoritative until namespace cutover. Existing
typed lifecycle and runner contracts are linked from `spec.md` and are used as
compatibility constraints, not silently treated as implementation of this
proposal.

## validation

From the repository root:

```bash
node docs/orchestration/database-lifecycle/verification/run-reference-model.mjs
```

The command is deterministic, uses no live tenant data, and deletes only the
temporary directory it created after the checks finish.
