# Chains Backlog
generated: 2026-04-24
source: pm-review.md

---

## P0 — fix today

CHAIN-001: pre-flight validate before run
  file: web/app/(workflows)/chains/page.tsx  handleRunChain()
  fix: call POST /api/chains/validate before POST /api/chains/run
       if errors, block run + show validation errors inline in dialog
       warnings: show but allow proceed

CHAIN-002: fix status field missing from chain-utils + set default on creation
  files:
    web/lib/chain-utils.ts (ChainData interface + getAllChains / loadChain)
    web/app/api/chains/save/route.ts (new chain path)
  fix:
    - add status field to ChainData interface in chain-utils.ts
    - read json.status in getAllChains() / loadChain() and pass it through
    - when creating a chain with no status field, default to "draft"
  note: affects ALL chains — even existing chains with status in chain.json
        appear statusless because chain-utils never reads the field

CHAIN-003: add YAML to file picker accept list
  file: web/app/(workflows)/chains/page.tsx  file input element
  current: accept=".json,.chain.json"
  fix: accept=".json,.chain.json,.yaml,.yml"
  note: drag-drop is fine (.chain.json = application/json, verified)

---

## P1 — this sprint

CHAIN-004: replace xyflow with custom SVG editor — remove old editors
  status: IN PROGRESS
  files:
    web/app/(workflows)/chains/[id]/edit/edit-chain-component.tsx
    web/components/chain/visual-editor.tsx
    web/components/chain/visual-editor-reactflow.tsx
  fix:
    - replace @xyflow/react visual editor with custom SVG editor to eliminate
      the "Built with React Flow" attribution badge (free-tier licensing)
    - delete visual-editor.tsx (old classic editor) and visual-editor-reactflow.tsx
    - remove VisualChainEditorOld, VisualChainEditorNew imports and useReactFlow flag
    - wire new SVG editor in place
  note: old visual editor removal is now bundled into this xyflow replacement work

CHAIN-005: atomic save with rollback
  file: web/app/api/chains/save/route.ts
  fix:
    - write to chain.json.tmp first
    - on success, rename tmp -> chain.json (atomic on POSIX)
    - if agent migration fails mid-way, abort and return 500 before
      any files are written

CHAIN-014: handleSave concurrent-request guard
  file: web/app/(workflows)/chains/[id]/edit/edit-chain-component.tsx  handleSave()
  fix: add `if (saving) return` at the top of handleSave() to prevent
       two concurrent POSTs to /api/chains/save from racing on chain.json
  note: autosave debounce (clearTimeout + setTimeout) is already correct —
        this guard covers the race between a manual Ctrl+S and the autoSave
        timer firing within the same 2s window

CHAIN-006: compare page exits split-view with no back path
  files:
    web/app/(workflows)/chains/[id]/compare/page.tsx
    web/app/(workflows)/chains/page.tsx  overflow menu
  context:
    - the compare selector and diff navigation work correctly — the selector's
      handleCompare() calls router.push(.../[runA]/[runB]) properly
    - the UX bug is that "Compare" navigates away from the split-view layout
      entirely with no in-app back button to the chain detail
  fix (option A): render compare selector as a panel/drawer within the chains
    page split-view instead of a full-screen page navigation
  fix (option B): add a "Back to chain" breadcrumb/button on the compare
    selector and diff pages that returns to /chains with the correct chain
    selected

---

## P2 — next sprint

CHAIN-007: fix agent href in detail panel
  file: web/app/(workflows)/chains/page.tsx  AgentStatusPanel
  current: href="/agents"
  fix: href={`/agents?agent=${agent.id}`} or the agent detail URL
       (check how agents page handles ?agent= param)

CHAIN-008: expose batch run in UI
  file: web/app/(workflows)/chains/page.tsx or new BatchRunModal
  fix: add "Batch run" to overflow menu
       opens modal to configure multiple chain runs
       uses existing /api/chains/run-batch endpoint

CHAIN-009: improve debug mode discoverability in editor
  files: web/app/(workflows)/chains/[id]/edit/edit-chain-component.tsx
  context:
    - debug mode is ALREADY implemented: Debug button toggles debugMode,
      ChainDebugPanel renders as an overlay, handleDebugStartRun() calls
      /api/chains/run with debug:true, breakpoints wired via useBreakpoints
    - the issue is discoverability — the Debug button may not be prominent
      enough and ChainDebugPanel renders as an overlay, not an explicit tab
  fix: evaluate whether the Debug button is visible in the default editor
       toolbar state. if not, surface it more clearly (dedicated tab strip
       entry or a more prominent button placement)

---

## P3 — polish

CHAIN-010: expand docs page — trigger types and import/export
  file: web/app/docs/chains/page.tsx
  note: branches, variable substitution, and agent profiles ARE already
        documented — do not re-add
  sections to add:
    - webhook triggers (inbound webhook config, event trigger format)
    - email triggers (inbound email → chain start)
    - schedule-triggered chains (cron format, scheduler integration)
    - import/export workflow (how to import JSON/YAML, export, share)
  also: add docs charm to editor PageBanner

CHAIN-011: unify auth pattern on validate endpoint
  file: web/app/api/chains/validate/route.ts
  fix: replace checkAuth() with requirePermission(request, "view_chains")
       to match list and run endpoints

CHAIN-012: add YAML file import via file picker
  file: web/app/(workflows)/chains/page.tsx  file input
  fix: change accept=".json,.chain.json" to ".json,.chain.json,.yaml,.yml"
       update handleImport() to pass correct format to importChainFromString()

CHAIN-013: add archived filter tab to chains list
  file: web/app/(workflows)/chains/page.tsx  STATUS_FILTERS
  current: STATUS_FILTERS has "all", "active", "draft" — "archived" missing
  fix: add "archived" entry to STATUS_FILTERS array so users can filter
       and manage archived chains
  note: depends on CHAIN-002 (status field must be read from chain-utils
        before any filter tab is useful)

---

## in progress

CHAIN-004 (xyflow badge + old editor removal)
  status: IN PROGRESS — agent working on custom SVG editor replacement
  blocker: none
  eta: unknown

---

## questions for marco (decisions needed)

1. dual editor: safe to delete old visual-editor.tsx now? any known users of it?
2. compare page: should it auto-select last 2 runs or require manual selection?
3. batch run: is this feature intended for v1 or just scaffolding?
4. agent href: does /agents support ?agent= query param for deep linking?
