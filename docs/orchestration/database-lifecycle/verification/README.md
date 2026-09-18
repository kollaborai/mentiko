# Verification harness

`run-reference-model.mjs` is intentionally small and local. It loads the
machine-readable fixture and example, validates their schemas, creates a fresh
temporary namespace database under a temporary directory, executes the complete
happy path through a reference transition model, verifies the artifact digest,
and removes the temporary namespace and artifact root.

Run it from the repository root:

```bash
node docs/orchestration/database-lifecycle/verification/run-reference-model.mjs
```

The scenario suite is currently contract-only outside the complete fixture. Its
shape, stable acceptance IDs, negative assertions, and coverage are checked by
the same command. Passing output is evidence that the package is internally
consistent; it is not production runtime, migration, PTY, or deployment proof.
