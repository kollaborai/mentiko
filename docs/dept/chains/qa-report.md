chains visual editor — QA report
tested: 2026-04-24
tester: qa agent (claude-sonnet-4-6)
chains tested: mentiko-smoke-test (6 agents), performance-profile-master-detail-redesign (8 agents)

---

test: chains list / sidebar
status: PASS
what I saw: two chains in list with name, description, agent count badge, status tags,
  "1 runs" count, cli badge. all readable. active/draft/all filter tabs present.
  search bar visible.
issues:
  - search bar not tested (no text typed)

---

test: detail view — header stats
status: PASS
what I saw: chain name, description, last run timestamp, agent count, profile badge
  (Claude/Haiku), max rounds, on_complete. clean layout.
issues:
  - none

---

test: detail view — read-only flow graph (Flow section)
status: FAIL
what I saw: 6 nodes rendered in a horizontal row with no connecting edges between them.
  every node shows "in: none / out: (empty)". nodes are not interactive in a meaningful
  way — clicking selects them visually but does nothing else (no popup, no navigation).
  zoom controls (+/-/fit) exist and respond. fit button does NOT re-center the graph.
issues:
  - no edges/connections rendered — the chain IS connected (editor proves it), detail
    view just fails to show them
  - triggers and emits show "none" for all agents — confirmed root cause:
    /api/chains endpoint returns agents with triggers:[], emits:"" stripped of real data
    the detail view consumes this stripped payload and gets no trigger/emit info
  - nodes are arranged in a flat horizontal row instead of reflecting actual chain topology
  - clicking a node in the read-only flow does nothing useful — dead interaction
  - fit button does not reframe the graph to fit the viewport

---

test: detail view — agents panel (right side)
status: FAIL
what I saw: all agents show "triggers: none  emits: none" — the "none" for triggers
  is white text, the "none" for emits is styled as a green pill (looks like a valid
  value, not an empty state). clicking an agent row does nothing at all.
issues:
  - triggers/emits all empty due to /api/chains data stripping (see above)
  - "none" on emits rendered as a green pill — visually implies "none" is a real event
    name, not an absence of data. highly misleading. should be a gray/muted empty state
  - clicking an agent row is a dead interaction — user expects to navigate to agent
    detail or see a popup

---

test: editor — Visual Builder tab
status: PARTIAL
what I saw: full graph rendered correctly. nodes show real trigger/emit data with colored
  pills. solid green arrows for normal flow, dashed red arrows for error paths. node
  selection works (click to highlight + shows Edit/Delete in toolbar). zoom via scroll
  wheel works. JSON tab shows full chain.json. Connections tab shows all event connections
  in a clean list. node edit panel opens with all fields (name, id, role, notes,
  triggers, emits, timeout, on_error_agent, retry config).
issues:
  - canvas opens with graph crammed into top-right corner — massive empty space fills
    the left 60% of the canvas. the user has to scroll/drag to find their graph
  - fit button (crosshair icon) does NOT re-center/re-fit the graph to canvas
  - "Classic View" button in top-right does nothing — no state change, no navigation,
    no feedback. dead button
  - after scrolling to zoom out, the graph stays in top-right corner — fit button
    should fix this but doesn't
  - node edit modal opens mid-scroll — the Name field appears cut off at top of screen,
    user has to scroll up to see beginning of the form
  - agent names in list sidebar use raw id format (health-check-validator) not the
    human name (Health Check Validator) — inconsistency with the editor nodes which
    do show proper names

---

test: editor — Connections tab
status: PASS
what I saw: clean list of all event connections with "Agent A via event-name to Agent B"
  format. delete buttons on each row. Add Connection button present.
issues:
  - none

---

test: editor — JSON tab
status: PASS
what I saw: full chain.json displayed with proper indentation. Copy button visible.
issues:
  - none

---

test: watermark check
status: PASS (confirmed gone)
what I saw: checked bottom-right corner of both read-only flow canvas and editor canvas.
  no React Flow / xyflow watermark or attribution anywhere. DOM query confirmed
  zero elements with react-flow or xyflow attribution classes.

---

test: zoom controls
status: PARTIAL
what I saw: +/- buttons and fit/crosshair button all exist. scroll-to-zoom works in
  editor. zoom in/out buttons appear functional.
issues:
  - fit button does not work in either read-only view or editor — graph does not
    reframe to show all nodes

---

test: "offline" bar at bottom
status: FAIL
what I saw: a floating bar with "· offline" text with a colorful gradient border
  persists at the bottom of the screen at all times. covers content in the detail view
  and editor. unclear what it means. looks like a broken component or pty-manager
  connection indicator that got wired to UI incorrectly.
issues:
  - always visible, covering content
  - no dismiss button
  - label "offline" is ambiguous — offline what? pty-manager? server? the agent?
  - gradient border looks misplaced against the flat design system
  - in the read-only detail view it overlaps the Recent Runs run task text

---

test: Import URL flow
status: NOT TESTED
what I saw: chains already existed so skipping import per test plan
issues:
  - not tested

---

OVERALL:
the chains detail view is broken for the core use case — a user looking at a chain
sees no connections between agents and no event data, making the chain look like a
bunch of disconnected agents. the editor works meaningfully better but has a severe
UX problem with the canvas starting in the wrong position every time and the fit
button not working. the "offline" bar is a persistent visual pollution. the "Classic
View" button is a dead stub that should either work or be removed.

CRITICAL BUGS:
- /api/chains strips agent triggers/emits — detail view shows all agents as disconnected
  with no events. this is the worst bug — the whole point of a chain is its connections
- read-only flow graph renders no edges between nodes (same root cause: no trigger/emit
  data to derive connections from, or the read-only component doesn't draw edges at all)
- editor canvas initial position bug — graph always spawns in top-right corner with
  fit button broken, forcing user to manually drag their graph into view every time

MINOR ISSUES:
- "Classic View" button does nothing — dead stub
- "none" emits pill is green — misleading styling for empty state
- clicking agents in detail view does nothing — dead interaction
- node edit modal cuts off top of form (opens mid-scroll)
- "offline" bar persistent, covers content, no dismiss, ambiguous label
- agent sidebar list uses id (health-check-validator) vs editor which shows human name
- read-only flow node click is a dead interaction

WATERMARK: confirmed gone — no React Flow / xyflow attribution anywhere in the DOM
