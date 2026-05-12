# Chains PM Review
date: 2026-04-24
author: PM review pass (analyst mode)
scope: /chains page, editor, API surface, docs, UX

---

## executive summary

The chains feature is architecturally solid but operationally rough.
The core loop (create -> edit -> run -> observe) works but has friction
points, missing feedback, and a few silent failure paths that will
cause user confusion. The editor is the biggest risk surface.

---

## what was reviewed

sources:
  - live UI at http://localhost:3000/chains (dev env, empty state)
  - web/app/(workflows)/chains/page.tsx              (list/detail page)
  - web/app/(workflows)/chains/new/page.tsx           (new chain wizard)
  - web/app/(workflows)/chains/[id]/edit/             (editor)
  - web/app/(workflows)/chains/[id]/compare/          (run compare)
  - web/components/chain/                             (20+ components)
  - web/app/api/chains/                               (29 route files)
  - web/app/docs/chains/page.tsx                      (doc page)
  - web/app/api/chains/validate/route.ts              (validation engine)
  - lib/schemas/chain.schema.json                     (JSON schema)

---

## findings

### finding 1: dual visual editor is a liability

evidence:
  - edit-chain-component.tsx imports BOTH VisualChainEditorOld (visual-editor.tsx,
    536 lines) and VisualChainEditorNew (visual-editor-reactflow.tsx, 963 lines)
  - a `useReactFlow` boolean flag (default true) switches between them
  - old editor kept alive but not surfaced to user
  - two different codepaths for the same interaction = divergence risk

impact:
  - dead code maintaining two editors adds ~1500 lines to context
  - any bug fix must potentially be applied to both
  - old editor can be accidentally activated (flag is in-memory state)

confidence: high

---

### finding 2: save flow is not atomic — data loss possible

evidence:
  - save/route.ts migrates inline agents to standalone files AND saves chain.json
    in the same request, no transaction boundary
  - if agent file writes succeed but chain.json write fails, chain is in
    a half-migrated state with dangling agent files
  - there is no rollback mechanism (no backup-before-write pattern)
  - autosave is properly debounced (clearTimeout + setTimeout, 2s window) —
    rapid edits correctly reset the timer and do not cause multiple saves
  - the real concurrency bug: handleSave() has no `if (saving) return` guard.
    if the autoSave timer fires while a manual save (Ctrl+S) is in-flight,
    two concurrent saves race to writeFileSync on the same chain.json

impact: corrupted chain state that requires manual file cleanup to fix
confidence: high

---

### finding 3: run dialog has no validation before spawn

evidence:
  - handleRunChain() in chains/page.tsx fetches chain then immediately calls
    /api/chains/run — no pre-flight /api/chains/validate call
  - user can run a chain with broken event routing (unconsumed events,
    missing branch targets) and get a cryptic runtime failure
  - validate endpoint exists and has circular dep + event flow checks
    but is only called from the editor's Validate tab, not the run dialog

impact: users run broken chains, see unhelpful error deep in run output
confidence: high

---

### finding 4: compare page exits split-view with no back path

evidence:
  - /chains shows proper EmptyState with "Create chain" + "Browse templates"
  - compare selector (/chains/[id]/compare) does navigate correctly to the diff
    page — handleCompare() calls router.push(.../[runA]/[runB]) and it works
  - overflow menu "Compare" link goes to the selector, which then goes to diff.
    the navigation chain is functional
  - the actual UX bug: the compare selector is a full-screen page navigation
    that exits the split-view layout entirely. there is no back button to the
    chain detail — user must hit browser back to return

impact: compare flow is reachable but disorienting — user loses split-view
context with no in-app way to return
confidence: high

---

### finding 5: status field is inconsistent between list and API

evidence:
  - Chain type on page.tsx has status?: ChainStatus where ChainStatus = "active" | "draft" | "archived"
  - chain-utils.ts ChainData interface never defines a status field —
    getAllChains() / loadChain() do not read or pass through json.status
    from chain.json at all, regardless of what the file contains
  - save/route.ts never writes a default status on chain creation
  - filter logic: `chain.status === filterStatus` — since status is always
    undefined from the API, ALL chains fail every status filter
  - this affects every chain, not just new ones — even a chain with
    status: "active" in chain.json appears statusless in the list

impact: status filter is completely broken for all chains
confidence: high

---

### finding 6: YAML import has no file picker support

evidence:
  - file input: accept=".json,.chain.json" — no .yaml/.yml
  - YAML import IS advertised in the Import URL modal (format option shown)
  - drop handler MIME check is fine: .chain.json resolves to application/json
    (verified via mimetypes) so drag-drop works correctly
  - the gap is only file picker — can't browse to a .yaml file

impact:
  - users with a YAML chain file can't import via file picker, only via
    Import URL (paste/URL) which is less obvious
confidence: medium

---

### finding 7: agent href in detail panel is wrong

evidence:
  - AgentStatusPanel in detail view: href="/agents"
  - this links ALL agent names to /agents (the agents list)
  - should link to the specific agent, not the list page

impact: clicking agent name in chain detail navigates to generic agents
list, not the agent — users lose context
confidence: high

---

### finding 8: validation endpoint is auth-inconsistent

evidence:
  - validate/route.ts uses checkAuth() (session cookie auth)
  - run/route.ts uses requirePermission() (RBAC-aware)
  - list/route.ts uses requirePermission("view_chains")
  - inconsistent auth patterns across sibling routes

impact: validate endpoint may accept/reject requests in edge cases where
other chain endpoints would behave differently
confidence: medium

---

### finding 9: docs page is thin — key trigger types not covered

evidence:
  - /docs/chains/page.tsx covers: chain format, agents, config, branches/
    conditional routing, {VARIABLE} substitution, agent profiles — these
    are all present and substantive
  - what IS missing: webhooks (no section on inbound webhook config or
    event triggers from webhooks), email triggers, schedule-triggered
    chains, import/export workflow
  - no link from editor to docs (PageBanner on editor has no docs charm)

impact: users setting up webhook, email, or scheduled triggers have no
in-product reference — the branching and variable docs are fine
confidence: high

---

### finding 10: batch run API has no UI surface

evidence:
  - /api/chains/run-batch route exists (GET/POST/DELETE for batch runs)
  - web/lib/api.ts has runChainBatch(), getBatch(), getAllBatches(),
    cancelBatch() — client functions exist but no UI exposes them
  - debug mode IS fully wired in the editor: Debug button toggles debugMode
    state, ChainDebugPanel is imported and rendered, handleDebugStartRun()
    calls /api/chains/run with debug:true, breakpoints wired via useBreakpoints
  - batch run (run-batch) is the only unrepresented feature — debug has UI

impact: batch run is invisible to users; debug panel exists but is not
well-signposted (discoverable only if you find the Debug button)
confidence: high

---

### finding 11: archived status has no filter tab

evidence:
  - ChainStatus type includes "archived" as a valid value
  - STATUS_FILTERS in chains/page.tsx has "all", "active", "draft" only —
    "archived" is absent
  - users can set a chain to archived status but can never filter to see
    archived chains in the list

impact: archived chains are permanently hidden from filtered views —
users cannot manage or recover archived chains via the list UI
confidence: high

---

### finding 12: handleSave has no concurrent-request guard

evidence:
  - handleSave() (edit-chain-component.tsx) has no `if (saving) return`
    guard at the top of the function
  - the autoSave timer (2s debounce) can fire while a manual save is in
    flight (e.g. user hits Ctrl+S, waits ~1.5s, autoSave fires)
  - this creates two concurrent POST /api/chains/save requests both
    calling writeFileSync on the same chain.json simultaneously
  - no mutex, no lock, no last-write-wins logic — race is uncontrolled

impact: concurrent writes can corrupt chain.json (partial interleaved writes
or last-completer overwrites the other's changes)
confidence: high

---

### xyflow attribution badge (in progress)

status: in progress — replacement underway
evidence:
  - @xyflow/react free tier displays a "Built with React Flow" watermark
    badge in the bottom-right corner of the flow canvas
  - this is a licensing constraint of the free tier, not a bug
  - fix in progress: the xyflow-based visual editor is being replaced with
    a custom SVG editor that removes the dependency entirely
  - old visual editor (visual-editor.tsx) will be removed as part of this
    work (see CHAIN-004)

impact: third-party branding visible in the product canvas
confidence: high

---

## so what?

priority ranking by user impact:

  P0 (breaks users today):
    - run dialog skips validation → silent broken runs
    - status filter broken for ALL chains (not just new ones) — chain-utils
      never reads status from chain.json, so every filter tab is empty
    - drag-drop import silently fails for .chain.json

  P1 (data integrity risk):
    - save is not atomic → potential chain corruption
    - handleSave has no concurrent-request guard → race on chain.json writes
    - dual editor + xyflow badge → being replaced by custom SVG editor

  P2 (discoverability / UX gaps):
    - compare exits split-view with no back path
    - agent href links to wrong page
    - batch run has no UI surface
    - archived status filter tab missing

  P3 (polish / docs):
    - docs page missing webhooks/email/schedule/import-export sections
    - editor missing docs link
    - auth inconsistency on validate endpoint

---

## what's working well (don't break it)

  - import flow is solid: file -> preview -> validate -> customize -> install
  - sidebar resize persistence (localStorage) is a nice touch
  - circular dependency detection in validate is real and useful
  - flow graph preview on detail panel is clean
  - keyboard shortcut (Cmd+R) to run selected chain is good UX
  - status colors in sidebar items (run status dot) are clear

---

## appendix: file map

  chains page:         web/app/(workflows)/chains/page.tsx         (1467 lines)
  new chain wizard:    web/app/(workflows)/chains/new/page.tsx
  editor (embedded):   web/app/(workflows)/chains/[id]/edit/edit-chain-component.tsx
  compare selector:    web/app/(workflows)/chains/[id]/compare/page.tsx
  run diff:            web/app/(workflows)/chains/[id]/compare/[runA]/[runB]/page.tsx
  visual editor (new): web/components/chain/visual-editor-reactflow.tsx  (963 lines)
  visual editor (old): web/components/chain/visual-editor.tsx            (536 lines)
  chain components:    web/components/chain/ (20 files)
  api routes:          web/app/api/chains/ (29 route files)
  chain schema:        lib/schemas/chain.schema.json
  docs page:           web/app/docs/chains/page.tsx
