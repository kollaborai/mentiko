# QA Report — Chains Visual Editor
date: 2026-04-24

## Fix Verification

fix-1 edges:     PASS — API returns full agent data including triggers/emits.
                  SVG edge labels confirmed (health-validated, auth-tested, etc.)
                  visible in DOM. Green arrow edges connect all 6 nodes in
                  mentiko-smoke-test and all 8 in performance-profile-master.
                  orgId is now passed to getAllChains() in list/route.ts.

fix-2 fit view:  PARTIAL — Nodes are all visible (none clipped off-screen) but
                  graph is offset to the right-center, leaving noticeable empty
                  space in the upper-left quadrant. The 80ms useEffect delay with
                  clientWidth/clientHeight centering math is in place. Not corner-
                  spawning, but centering is imprecise. Edit mode shows same
                  behavior: nodes visible, centered-right. The fit-to-view button
                  (crosshair icon, bottom-left) works correctly when clicked.

fix-3 emits:     PASS (code) / UNTESTED (visual, no agent with empty emits in
                  existing data) — Code at visual-editor-reactflow.tsx:448-449
                  correctly shows "—" in text-muted-foreground/30 when emits is
                  falsy, and event name in text-green-400 when present. Both
                  existing chains have all agents with emits values so the "—"
                  branch was not exercised visually. Code path is correct.

watermark:       GONE — No "Built with React Flow" or xyflow attribution found
                  anywhere. DOM scan confirmed zero react-flow/xyflow references.
                  The editor is a custom canvas implementation, not xyflow/ReactFlow.
                  Bottom-right hint text reads "drag to move · scroll to zoom ·
                  click to select · del to remove" — that is custom, not a library
                  watermark.

## Overall

All three fixes are in place and the critical ones (edges, watermark) verified
visually. Fit-to-view is improved (no longer corner-spawning) but still
right-biased. Fix 3 emits "—" is correct in code but needs a chain with an agent
with no emits field to confirm the visual branch.

## Remaining Issues

1. fit-to-view bias: Read-only preview and edit mode both render nodes
   right-of-center with empty left quadrant. Not broken but not ideal.
   The centering math uses `(cw - scaledW) / 2 - minX * clampedScale` for px;
   if minX > 0 (nodes don't start at x=0), the correction over-shifts left.
   Could be fixed by subtracting minX from all node positions before scaling.

2. Smoke Test Reporter node partially overlaps in read-only preview: visible
   but its fan-out edge from Auth Flow Tester creates a side-branch that
   causes minor visual crowding. Not a bug, just layout density.

3. triggers display still shows "none" text (not "—") for agents with empty
   triggers: line 443 uses `?? "none"` for the in: field. Inconsistent with
   the emits fix on line 449. Low priority but worth aligning.
