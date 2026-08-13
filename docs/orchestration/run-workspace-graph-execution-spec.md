# Run workspace graph execution spec

Status: implementation acceptance spec, 2026-08-09.

Boundary: this is the execution-isolation sub-spec, not the complete graph
runtime contract. Graph-definition versioning, occurrence/frontier semantics,
join policy, durable waits, external effects, replay, migration, and the full
operator topology remain separate roadmap requirements.

This spec defines how Mentiko executes a graph of coding agents against one
user workspace without letting concurrent agents overwrite each other or
publishing a result over source state that changed during the run.

The implementation is not accepted because the happy path works. Every
invariant below needs direct test evidence, including coordinator restart,
conflict, replay, and a 30-target capacity run.

## Terms

- A **node** is one agent attempt. It owns one PTY session, one monitor session,
  one private Git ref, and one isolated Git worktree.
- An **edge** is a dependency between nodes. It becomes launchable only after
  its source node result has been accepted into the run's private integration
  commit.
- The **source workspace** is the user's registered workspace path, branch,
  index, and working tree at task start.
- The **run baseline** is an immutable private commit that exactly represents
  the registered source scope at task start, including staged, unstaged, and
  non-ignored untracked files.
- The **integration ref** is the run-private ordered result of accepted node
  commits. It is never the user's branch.

## Required execution sequence

1. Capture and validate the exact source identity and dirty snapshot.
2. Create private baseline and integration refs without moving the user's
   branch, index, or working files.
3. Durably queue every routed node attempt.
4. Admit attempts in organization-scoped FIFO order while active capacity is
   below the configured limit.
5. Only after admission, allocate one worktree and one PTY pair for that
   attempt from the edge's routing-time integration commit.
6. Submit instructions exactly once or block if delivery becomes ambiguous.
7. Capture the attempt result from only the registered workspace scope.
8. Serialize integration. Advance the private integration ref only when the
   node result applies cleanly and all immutable evidence revalidates.
9. Route downstream edges only after integration succeeds.
10. At terminal completion, publish the private integration result to the
    source workspace only through compare-and-swap validation of the original
    source identity and dirty snapshot.

## Invariants

### Exact baseline

- Baseline capture includes tracked staged changes, tracked unstaged changes,
  and non-ignored untracked files inside the registered workspace scope.
- Ignored files and files outside that scope do not enter the baseline.
- Capture uses private Git state. It does not alter the source index, branch,
  HEAD, or working files.
- A run with prior execution evidence but no trustworthy baseline blocks
  instead of inventing a late baseline.

### One isolated node owner

- Every attempt has a unique identity bound to its run, agent, routed launch
  job, launch occurrence, capacity lease, PTY names, private ref, and worktree.
- A worktree is allocated only after durable capacity admission.
- Capacity waiting must not consume a worktree or PTY.
- Every node on one routed edge uses the same integration commit captured when
  that edge was accepted, even if capacity delays launch.

### Integration gates edges

- Node result capture stages only the registered workspace subtree from the
  node launch commit.
- Result and integration receipts are immutable and identity checked on every
  replay.
- Integration is serialized by an owner-bearing claim and advances by
  compare-and-swap.
- Non-overlapping divergent results may produce a deterministic two-parent
  integration commit.
- Overlapping results write immutable conflict evidence, leave the integration
  ref unchanged, preserve the node worktree, and block dependent edges.
- Completion alone never launches a dependent node. Successful private
  integration is the routing gate.

### Crash-safe launch and cleanup

- Routed launch jobs and capacity attempts are durable and replayable.
- `pty_allocated`, `process_spawned`, and `ready_for_instructions` are
  interrupted pre-instruction phases, not proof that startup completed.
- A pre-instruction attempt may release capacity only after exact absence of
  its agent and monitor PTYs is proven and its pristine worktree cleanup is
  durably journaled.
- If an interrupted worktree contains changes, preserve it and block for
  review.
- If durable instruction intent exists but physical PTY delivery cannot be
  proven, block rather than sending instructions again.
- An `instructions_submitted` attempt is not relaunched. Recovery repairs or
  proves its monitor in the same node worktree.
- Cleanup intent is written before worktree removal. Replaying an interrupted
  cleanup is idempotent, and one malformed cleanup record does not stop sibling
  cleanup work.

### Queue capacity

- Active capacity is organization scoped and counts unreleased attempt
  reservations plus compatible legacy running agents.
- Admission is FIFO and serialized. Only the oldest eligible queued attempt is
  promoted while capacity remains.
- A 30-target routed job must survive coordinator restart without duplicate
  attempts, duplicate instruction submission, skipped targets, or leaked
  capacity.
- Invalid state in the capacity domain blocks admission instead of allowing an
  unsafe count.

### Terminal publication

- Publication rechecks source branch identity, HEAD, scoped index fingerprint,
  and dirty snapshot immediately before apply.
- If source state changed before apply, publication leaves it untouched and
  writes immutable conflict evidence.
- If source state still exactly matches the task-start snapshot, publication
  applies the integrated result while preserving the intended baseline dirty
  state.
- Because arbitrary editors do not participate in Mentiko's advisory claim, a
  writer can still race a multi-file apply. Publication therefore verifies the
  source again after apply and attempts an exact inverse patch. A proven inverse
  leaves only the external edit. If a raced path makes the whole inverse unsafe,
  publication independently reverses every result path still identical to the
  integration commit, leaves externally changed paths untouched, and records
  both path sets. The run blocks with immutable rollback evidence and explicitly
  reports that preserved raced paths may contain run changes. It never claims
  untouched-source semantics without proof.
- Publication is replay safe. A prior receipt is trusted only after its source
  and result identities revalidate.

## Durable state

Run-private records live below:

```text
{runDir}/.internal/workspace-isolation/
  run-workspace.json
  nodes/
  receipts/results/
  receipts/integrations/
  receipts/publication.json
  receipts/publication-conflicts/
  cleanup/pending/
  cleanup/completed/
```

Git refs live under `refs/mentiko/runs/{runRef}/`. Agent-readable artifacts do
not own controller receipts.

## Blocking outcomes

The run or routed launch job must stop and retain evidence when:

- source identity or snapshot no longer matches at publication,
- result identities or receipt ancestry do not revalidate,
- integration conflicts,
- PTY removal cannot be proven,
- an interrupted worktree contains changes,
- instruction delivery is ambiguous,
- monitor recovery cannot be proven,
- capacity state is malformed or cannot be counted safely.

## Acceptance evidence

At minimum, the implementation gate requires:

- exact dirty-baseline tests for staged, unstaged, untracked, ignored, and
  out-of-scope files,
- parallel node tests proving separate worktrees and PTYs,
- edge tests proving no downstream launch before successful integration,
- clean divergent integration and overlapping conflict tests,
- immutable receipt tamper and replay tests,
- source-drift publication tests proving no source mutation,
- post-apply race tests proving exact rollback when safe and explicit blocked
  evidence when an arbitrary writer makes rollback unsafe,
- cleanup crash-before-remove and crash-after-remove replay tests,
- launch restart tests at every pre-instruction phase and after instruction
  submission,
- ambiguous instruction delivery and changed interrupted-worktree tests,
- a 30-target queue restart test proving exact-once target ownership and full
  capacity reclamation,
- typed compile, lint, runner-v2 suites, generated-bundle parity, and a watched
  runtime proof before the behavior is declared ready.

## Scope boundary

This contract owns Git-backed local coding workspaces. Non-Git and remote
workspace modes must remain explicit unsupported/shared behavior until they
have equivalent isolation and publication contracts. It does not authorize a
deployment or alter the production image build rules.
