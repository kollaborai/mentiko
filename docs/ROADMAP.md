# Mentiko Roadmap

status: working product roadmap  
last updated: 2026-08-01  
tracking: repo-local; no GitHub issues are created by this roadmap

This is the high-level product roadmap. Detailed runtime truth lives in the
current code, contracts, and fresh runtime evidence. Requirements for the next
platform initiative live in
[Graph Execution Requirements](./orchestration/graph-execution-requirements.md).

## now — execution reliability

The immediate go-live work remains:

- chain-execution consistency across every producer and consumer;
- runner-v2 typed `AgentAttempt` lifecycle, readiness, completion, and recovery;
- truthful routing for event, retry, fan-out/fan-in, task, schedule, and
  cross-chain paths;
- one typed lifecycle owner with no new shell-owned fallback engine;
- fresh local runtime proof, not just committed test snapshots.

Graph execution is downstream of this reliability substrate. It must reuse the
typed runner-v2 ownership and preserve current event/run/artifact contracts.

## next — durable graph execution

Priority: P1 platform capability after the current runner-v2 reliability gate.

Intent: make the declared workflow graph, actual execution path, and recovery
state agree while retaining Mentiko's event-driven, local-first model.

The initiative is defined by the [requirements document](./orchestration/graph-execution-requirements.md)
and proceeds in these gates:

1. graph definition, compiler, validator, immutable digest, and run pinning;
2. actual transition ledger, durable frontier, explicit joins, and OR-merge
   correctness;
3. crash-safe fan-out/fan-in, launch acceptance, reconciliation, retries,
   effect receipts, waits, loops, and cancellation;
4. graph-version safety, declared-vs-actual topology, causal lineage,
   checkpoint inspection, replay, and fork;
5. default rollout only after parity and fresh runtime proof across supported
   paths.

The first user-visible value is not a new canvas. It is a truthful answer to:

> What was declared, what actually ran, what is eligible next, what is it
> waiting on, and what evidence proves that state?

## later — graph-native product leverage

After the durable runtime is proven:

- graph-native debugging and run inspection;
- editable human gates and approval workflows;
- bounded dynamic expansion and reusable subgraphs;
- replay/fork-based evaluation and regression comparison;
- richer cross-workspace executor support behind the typed boundary;
- evaluation of an external durable workflow engine only if the proven runtime
  gaps justify its operational cost and it preserves Mentiko's PTY, artifact,
  event, and local-first boundaries.

## roadmap decision rules

- Do not start graph UX work by bypassing runner-v2 reliability.
- Do not infer runtime truth from static `emits`, process liveness, or UI state.
- Do not adopt a vendor runtime as a substitute for Mentiko's own event,
  artifact, attempt, and effect evidence.
- Do not call an external side effect exactly-once unless the receiver
  participates in idempotency and the result is provable.
- Update this roadmap and the requirements document together when scope or
  sequencing changes. Use GitHub issues separately only if Marco explicitly
  asks for them.

