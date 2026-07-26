# engine map — how everything is wired

A single visual topology of the mentiko engine: triggers, watchers/monitors, chain
runner, chain generation, task creation, and decisions — and where an edge may lead
nowhere. Built 2026-07-24 and **verified against live code** (every named symbol grepped
to a real file; see "verified symbols" at the bottom).

The per-component ownership specs live in [contracts/](./contracts/) (chain-runner,
watcher-watchdog, runner-v2, monitor-v2). Those say *what each box owns*; this doc is the
*connective tissue between the boxes* they don't show. Prose sources: [README.md](./README.md)
and the "auto-run automation" contract in `mentiko/CLAUDE.md`.

---

## 1. full engine topology

```mermaid
flowchart TB
  classDef reaper fill:#3a2a2a,stroke:#c25b5b,color:#f4dede;
  classDef gate fill:#2a2f3a,stroke:#5b9ef5,color:#dbe7ff;
  classDef store fill:#26302a,stroke:#59b87a,color:#dbf4e4;
  classDef sus fill:#332a1a,stroke:#d9a441,color:#f6e8cd,stroke-dasharray:4 3;

  %% ---------------- entry points ----------------
  subgraph TRIG["triggers / entry points"]
    CLI["bin/mentiko run"]
    WEBRUN["web: start run<br/>POST /api/runs"]
    SCHED["scheduler<br/>schedules -> run"]
    HOOK["webhook<br/>/api/webhooks -> chain"]
    POLL["auto-run poller<br/>auto-run-service.ts · 60s"]
  end

  %% ---------------- background worker ----------------
  subgraph BW["background-worker.ts — long-running services"]
    CW["chain-watcher-service<br/>event file -> matching chain"]
    WD["watchdog · 60s<br/>stalled running-run -> stopped"]:::reaper
    RR["run-reconciler<br/>orphaned runs"]:::reaper
    DR["decision-reconciler · 60s<br/>replay lost imports / dead gen"]:::reaper
  end

  %% ---------------- chain generation ----------------
  subgraph GEN["chain generation (typed)"]
    REC["chain-recommendation<br/>analyze -> recommend"]
    CGEN["chain-generation-cli.ts<br/>generate -> validate -> materialize chain.json"]
  end

  %% ---------------- runner core ----------------
  subgraph RUN["chain runner (runner-v2)"]
    DIRECT["direct-run.ts<br/>validate · admit · create run.json"]
    BOOT["bootstrap-executor.ts<br/>PTY + monitor + readiness gate"]
    AGENT["agent PTY session<br/>does work -> writes AGENT_COMPLETE"]
    MON["monitor-v2<br/>watches ONE agent for AGENT_COMPLETE"]
    COMP["completion-entrypoint.ts<br/>capture · match event · route · consume"]
    ROUTE["routing-contract.ts<br/>branch / fan-out / fan-in / error"]
  end

  %% ---------------- events ----------------
  subgraph EVT["events (file-based)"]
    EMIT["event-emitter.ts<br/>canonical write"]
    EDIR["EVENTS_DIR/*.event"]
    ELIFE["event-lifecycle.ts<br/>find · mark · consume"]
  end

  %% ---------------- task lifecycle ----------------
  subgraph TASK["task lifecycle"]
    TSTORE["task-store (sqlite)"]:::store
    READY["isTaskReady + canAdmitAutoRun<br/>+ resolveAutoRunState"]:::gate
    TRIG1["triggerAutoRun<br/>analyze->recommend->generate->run"]
    SCAN["triggerAutoRunScan<br/>getDirectDependentAutoRunCandidates"]
  end

  %% ---------------- decisions ----------------
  subgraph DEC["decisions"]
    DADV["decision-auto-advance.ts<br/>advanceDecisionAfterPhase"]
    DGATE["human gate<br/>SELECT an option"]:::gate
    DRES["decision-resolution.ts<br/>resolve -> create tasks"]
  end

  %% ---- trigger edges ----
  CLI --> DIRECT
  WEBRUN --> DIRECT
  SCHED --> WEBRUN
  HOOK --> CW
  POLL --> READY

  %% ---- generation path (within-task pipeline) ----
  TRIG1 --> REC --> CGEN --> DIRECT
  READY --> TRIG1

  %% ---- runner internal ----
  DIRECT --> BOOT --> AGENT
  BOOT --> MON
  MON -->|AGENT_COMPLETE| COMP
  COMP --> ROUTE
  ROUTE -->|next agent, same chain| BOOT
  COMP --> EMIT --> EDIR
  CW -->|scan EVENTS_DIR| EDIR
  EDIR --> ELIFE
  ELIFE -->|matched trigger| CW
  CW -->|detached bin/mentiko run| DIRECT

  %% ---- completion -> task/decision propagation ----
  COMP -->|update linked task| TSTORE
  COMP -->|chain done| AUDIT["completion-audit-apply.ts"]
  AUDIT --> SCAN
  RECON["/api/tasks/reconcile"] --> SCAN
  DRES --> SCAN
  SCAN --> READY

  %% ---- decisions ----
  DADV --> DGATE
  DGATE -->|selection| DADV
  DADV -->|plan resolved| DRES
  DRES --> TSTORE
  DR --> DADV
  JOBS["/api/jobs/[id]/complete"] --> DADV
  IMPORT["/api/decisions/[id]/import"] --> DADV

  %% ---- reapers watch runs ----
  WD -.->|reap stalled| RUN
  RR -.->|reap orphaned| RUN
  POLL -.->|reapDeadRuns after 45m| RUN
  TSTORE --> READY
```

Reaper boxes are red, human gates blue, the task store green.

---

## 2. within-task auto-run pipeline

One "up-next" task with no chain pulls **itself** through the whole pipeline, one step per
poller tick (`triggerAutoRun` in `web/app/api/tasks/auto-run/route.ts`):

```mermaid
flowchart LR
  A["task up-next<br/>blockers closed + auto-run on"] --> B["analyze<br/>chain-recommendation"]
  B --> C["recommend a chain"]
  C --> D{"chain exists?"}
  D -->|no| E["generate<br/>chain-generation-cli"]
  D -->|yes| F["run<br/>direct-run.ts"]
  E --> F
  F --> G["chain executes<br/>(section 1)"]
  G --> H["completion-audit-apply<br/>-> triggerAutoRunScan"]
  H --> I["direct dependents only<br/>getDirectDependentAutoRunCandidates"]
  I --> A
```

**Landmine (documented):** never wire a *full-org* scan into close/reconcile — that recursed
into the TASK-097 re-run storm. Propagation is **dependents-only** on purpose.

---

## 3. decision phase machine

A person's single action — the selection — is the one and only gate; everything else
auto-advances server-side (`decision-auto-advance.ts`, driven by job-complete, decision-import,
and the 60s reconciler).

```mermaid
stateDiagram-v2
  [*] --> research
  research --> deck: briefed -> auto-generate round-1 questions
  deck --> options: human answers tradeoff cards
  options --> plan: human SELECTS an option (the gate)
  plan --> resolved: auto-resolve into tasks (no separate Approve)
  resolved --> [*]
  note right of options: the ONE human stop
  note right of resolved: decision-resolution.ts -> task-store -> auto-run
```

---

## 4. dead-ends & things to verify

Where an edge may lead nowhere — the reason this map exists. Not all are bugs; each is a
"confirm a consumer" item.

- **four overlapping reapers.** `watchdog` (stalled running), `run-reconciler` (orphaned),
  `reapDeadRuns` (inside the auto-run poller, >45m no liveness), and `decision-reconciler`
  (dead generation) all terminalize runs on different criteria. Confirm they don't fight each
  other (double-terminalize / one undoing another) and that every "dead run" class is owned by
  exactly one. This is the single most likely place a connection is redundant or contradictory.
- **`.bak` files in a live route.** `web/app/api/tasks/reconcile/route.ts.bak` and
  `route.test.ts.bak` sit next to the live route. Dead files in the tree — delete or restore,
  don't leave ambiguous.
- **known env-derivation bugs (from CLAUDE.md).** `CHAIN_PROJECT_ROOT` also derives data paths
  for non-local workspaces; `REMOTE_PROJECT_ROOT` writes artifacts to the project dir instead of
  `$RUNS_DIR`; `REMOTE_NAMESPACE_ROOT` creates dirs under project, not namespace. These are edges
  that land in the wrong directory — the #1 recurring "namespace path mismatch" class.
- **generation -> run handoff.** `/api/chains/recommend` runs the shared helper but is
  "unwatched live" (per the TASK-203 handoff). Confirm a generated chain actually reaches
  `direct-run` on the recommend path, not just the auto-run path.
- **GridBloom (now orphaned).** `web/components/ui/grid-bloom.tsx` has zero importers after the
  2026-07-24 tasks-banner revert. Dead component — safe to delete.

---

## verified symbols (2026-07-24, grepped to live files)

| symbol | file |
|---|---|
| `triggerAutoRun` / `triggerAutoRunScan` | `web/lib/tasks/completion-audit-apply.ts` |
| `getDirectDependentAutoRunCandidates` | `web/lib/runs/auto-run.ts` |
| `canAdmitAutoRun` / `resolveAutoRunState` | `web/lib/tasks/task-store.ts`, `auto-run-state.ts` |
| `isTaskReady` / `reapDeadRuns` | `web/app/api/tasks/auto-run/route.ts` |
| `advanceDecisionAfterPhase` | `web/lib/decisions/decision-auto-advance.ts` |
| `applyDecisionRunResult` | `web/lib/decisions/decision-run-results.ts` |
| chain-watcher / watchdog / reconcilers | `web/server/background-worker.ts` |

three propagation sites calling `triggerAutoRunScan`: `completion-audit-apply.ts`,
`api/tasks/reconcile/route.ts`, `decisions/decision-resolution.ts`.
