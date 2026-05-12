# Chains PM Review — Validation Report
date: 2026-04-24
validator: QA pass against source code

---

## FINDING 1: dual visual editor is a liability
status: CONFIRMED
evidence:
  - edit-chain-component.tsx line 16-17 imports both:
      VisualChainEditorOld from "visual-editor"
      VisualChainEditorNew from "visual-editor-reactflow"
  - line 83: const [useReactFlow, setUseReactFlow] = useState(true)
  - lines 714-798: both editors rendered conditionally on useReactFlow flag
  - lines 714-723: a visible "Classic View / React Flow" toggle button exposes the old
    editor to any user who clicks it — this is not just an accidental activation risk,
    it's a deliberate UI affordance that keeps the old editor live
notes:
  - PM report said "old editor can be accidentally activated (flag is in-memory state)"
    but it's actually intentionally surfaced via a button in the UI. the risk is slightly
    different: users CAN and WILL click "Classic View", not just accidentally trigger it.
  - the ~1500 lines dead code count is approximately right (536 + wrapper code)

---

## FINDING 2: save flow is not atomic — data loss possible
status: CONFIRMED (with one correction)
evidence:
  - save/route.ts: migrateInlineAgents() writes standalone agent files (line 184),
    then writeFileSync(chainPath, ...) writes chain.json (line 186). no transaction,
    no rollback, no backup-before-write
  - if writeFileSync for chain.json throws after agents were written, chain is
    half-migrated with dangling agent stubs and no chain.json update
  - autosave: edit-chain-component.tsx line 247-270 sets a 2s debounce timer
    (clearTimeout + setTimeout pattern). this IS properly debounced — rapid edits
    reset the timer. PM report claim "no debounce guard on rapid edits" is INCORRECT
  - however: handleSave() (line 183) has no concurrent-save guard. if autoSave
    timer fires while a manual save is in-flight (user hits Ctrl+S then waits ~2s),
    two concurrent saves can race to writeFileSync. this is a real but different
    concurrency bug than what the PM described
notes:
  - debounce claim in PM report is inaccurate. the timer is properly debounced.
  - the concurrent-save race is real but the vector is Ctrl+S + autoSave firing
    within the same 2s window, not "rapid edits".

---

## FINDING 3: run dialog has no validation before spawn
status: CONFIRMED
evidence:
  - chains/page.tsx handleRunChain() (line 334-363):
      1. fetchWithNamespace(`/api/chains/${selected.id}`)   <- load chain
      2. fetchWithNamespace("/api/chains/run", { POST })    <- run immediately
  - no call to /api/chains/validate at any point in this function
  - validate/route.ts confirms that endpoint exists and does circular dep +
    event flow checks, but it is never called from handleRunChain()

---

## FINDING 4: compare page is orphaned
status: CONFIRMED (with correction on navigation path claim)
evidence:
  - /chains/[id]/compare/page.tsx exists and renders a run selector with A/B
    buttons. handleCompare() (line 49) calls
    router.push(`/chains/${chainId}/compare/${selectedA}/${selectedB}`)
    — so the selector DOES navigate to the diff page. it is functional.
  - /chains/[id]/compare/[runA]/[runB]/page.tsx confirmed to exist at:
    web/app/(workflows)/chains/[id]/compare/[runA]/[runB]/page.tsx
  - chains/page.tsx overflow menu (line 1004-1009): "Compare" links to
    /chains/[id]/compare (the selector). this is correct — user picks runs
    from the selector, then the selector navigates to the diff.
  - the actual orphan problem: the compare selector is a FULL-SCREEN page
    (/chains/[id]/compare navigates away from the chains page), not a panel
    within the split view. there is no way to get back to the chain detail
    without hitting browser back.
notes:
  - PM said "only reachable by direct URL construction" which is wrong. the
    selector page navigates to [runA]/[runB] correctly via router.push().
  - the real UX bug is the selector is a full page navigation with no back
    button to the chain detail, and the overflow "Compare" link exits the
    split-view layout entirely. the diff feature is reachable, just disorienting.

---

## FINDING 5: status field inconsistent between list and API
status: CONFIRMED
evidence:
  - chain-utils.ts ChainData interface (line 15-29): no status field defined
  - getAllChains() / loadChain(): neither function reads or passes through
    json.status from chain.json — the field is simply never extracted
  - save/route.ts: the word "status" appears zero times — no default is set
    on new chain creation
  - chains/page.tsx line 89: Chain interface has status?: ChainStatus
  - filter logic line 486: chain.status === filterStatus — when status is
    undefined, "Draft" filter returns nothing
  - the list API returns ChainData from chain-utils, which never includes
    status, so ALL chains appear statusless regardless of what's in chain.json

---

## FINDING 6: YAML file picker gap
status: CONFIRMED
evidence:
  - chains/page.tsx line 760: accept=".json,.chain.json"
  - .yaml and .yml are absent from the accept attribute
  - the file input is at line 756-766, confirmed hidden input used for import
notes:
  - PM report is accurate. YAML import via URL modal may work but file picker
    cannot browse .yaml files.

---

## FINDING 7: agent href in detail panel is wrong
status: CONFIRMED
evidence:
  - chains/page.tsx line 1111: href="/agents"
  - all agents in the detail panel link to the generic /agents list page
  - no agent-specific URL is constructed (no agent.id in the href)

---

## FINDING 8: auth inconsistency on validate endpoint
status: CONFIRMED
evidence:
  - validate/route.ts line 277: if (!(await checkAuth(request))) throw new Unauthorized()
    uses checkAuth() — session-only, no RBAC
  - run/route.ts line 1: uses requirePermission (confirmed by import of requirePermission
    from rbac-auth, line 8)
  - list/route.ts line 10: requirePermission(req, "view_chains")
  - save/route.ts line 135: requirePermission(request, "manage_chains")
  - validate is the only chains endpoint using the weaker checkAuth()

---

## FINDING 9: docs page is thin — no branching or variables coverage
status: REFUTED (PARTIALLY)
evidence:
  - docs/chains/page.tsx has sections for:
      "Branches and Routing" (line 141-169): covers simple routing, fan-out,
        conditional routing with conditions/default/fan_in/wait_for — this is
        substantial coverage, not missing
      "Runtime Placeholders" (line 206-216): covers {TASK}, {GOAL}, {CHAIN_NAME},
        {TASK_CONTEXT} — variable substitution IS documented
      "Agent Profiles and Gateways" (line 108-138): covers agent profiles — documented
  - what IS missing:
      webhooks: no section on event triggers from webhooks or inbound webhook config
      email triggers: not documented
      import/export workflow: no section
      schedule-triggered chains: not documented
  - PM report claim "missing: branches/conditional routing, {VARIABLE} substitution,
    agent profiles within chains" is WRONG — all three exist in the docs page
  - no link from editor to docs is correct (editor PageBanner has no docs charm)
notes:
  - the docs are better than reported. branches and variables ARE covered.
    webhooks, email triggers, schedules, and import/export workflow are missing.

---

## FINDING 10: batch run API has no UI surface
status: PARTIAL
evidence:
  - /api/chains/run-batch: confirmed exists (route file + confirmed in types)
  - web/lib/api.ts lines 273-288: has runChainBatch(), getBatch(), getAllBatches(),
    cancelBatch() — API client functions exist
  - no batch run UI component found in web/components/ or chains page
  - debug: PM report said "no UI component wiring found" — this is PARTIALLY WRONG
    because the editor (edit-chain-component.tsx) has a full debug mode:
      - Debug button toggles debugMode state (line 116, 633)
      - ChainDebugPanel imported and rendered (lines 35, 1656-1666)
      - handleDebugStartRun() (line 485) calls /api/chains/run with debug:true
      - breakpoints are wired via useBreakpoints hook (line 132)
      - the "Debug" tab described in backlog CHAIN-009 already EXISTS in the
        editor as a mode (not a tab, but as an overlay panel via ChainDebugPanel)
  - batch run (run-batch) truly has no UI — confirmed
notes:
  - PM report is correct that batch run has no UI. but the debug claim is wrong:
    debug IS surfaced in the editor via the Debug button + ChainDebugPanel overlay.
    the debug panel is wired to breakpoints and the debug run API. CHAIN-009 in the
    backlog says to "add Debug tab" but debug mode already exists — the backlog item
    may be about improving discoverability, not implementing from scratch.

---

## summary

confirmed:    7  (findings 1, 2, 3, 5, 6, 7, 8)
partial:      2  (findings 4, 10)
refuted:      1  (finding 9 — docs are substantially better than claimed)

corrections to PM report:
  F2: debounce claim wrong — autosave IS properly debounced. concurrent save race
      exists but via different vector (Ctrl+S + autoSave within 2s, not rapid edits)
  F4: diff page IS reachable via the selector's Compare button. the real bug is
      the selector navigates away from split-view with no context-preserving back.
  F9: branches, variable substitution, agent profiles ARE documented. missing
      sections are webhooks, email triggers, schedules, import/export.
  F10: debug IS surfaced in the editor via Debug button + ChainDebugPanel. only
      batch run (run-batch) is truly unrepresented in the UI.

new findings spotted:
  NF1: ChainData interface in chain-utils.ts never reads the status field from
      chain.json at all. even chains that DO have status in their JSON file
      will appear statusless in the list API. this makes the status bug worse
      than F5 describes: it's not just new chains, it's ALL chains.
  NF2: chains/page.tsx filter includes "Draft" in STATUS_FILTERS (line 106-110)
      but "archived" is missing from the filter tabs — users can't filter by
      archived status even though ChainStatus includes "archived".
  NF3: handleSave() has no in-flight guard (no `if (saving) return` at top).
      The autoSave timer (2s debounce) can fire while a manual save is running,
      creating a race between two concurrent writeFileSync calls on chain.json.
