# Gaia-UI Component Audit vs Mentiko Platform

Generated 2026-03-10 via audit agent.

## Summary

- gaia-ui components: 22
- mentiko matches gaia-ui: 12 (3 perfect, 7 minor styling differences)
- gaia-ui components missing in mentiko: 9
- mentiko-only custom components: 16+

---

## Component Map

### Perfect Matches (no changes needed)
- `label.tsx` — identical API and styling
- `separator.tsx` — identical
- `skeleton.tsx` — identical

### Minor Styling Differences
- `button.tsx` — mentiko adds loading state + xs sizes; outline variant uses bg-muted vs gaia border+shadow-xs
- `badge.tsx` — mentiko adds ghost + link variants
- `card.tsx` — mentiko: rounded-sm, no border, no shadow (flat design) vs gaia: rounded-xl + border + shadow-sm
- `dialog.tsx` — mentiko: bg-background/80 overlay, rounded-md, no border vs gaia: black/50, rounded-lg, border
- `dropdown-menu.tsx` — icon library differs (lucide vs hugeicons), otherwise same
- `tabs.tsx` — mentiko adds underline variant + vertical orientation
- `tooltip.tsx` — mentiko: no arrow, simpler; gaia: arrow + provider wrapper

### Missing in Mentiko (gaia-ui only)
- `avatar.tsx` — low priority (basic profile pic)
- `calendar.tsx` — medium priority (scheduling UI)
- `command.tsx` — low priority (mentiko uses inline CommandMenu)
- `kbd.tsx` — low priority (keyboard shortcut display)
- `navigation-menu.tsx` — not applicable (mentiko uses custom navbar)
- `popover.tsx` — low priority
- `scroll-area.tsx` — utility, not critical
- `theme-toggle.tsx` — handled via provider
- `toggle.tsx` — low priority

---

## Mentiko-Only Custom Components

Domain-specific (keep, do not generalize):
- `goal-card.tsx` — goal/task status display
- `notification-card.tsx` — notification feed item
- `todo-item.tsx` — todo/task item
- `workflow-card.tsx` — chain/workflow card
- `chat-composer.tsx` / `composer.tsx` / `session-composer.tsx` — AI conversation input
- `slash-command-dropdown.tsx` — slash command palette

Advanced visualizations (keep):
- `holo-card.tsx` — 3D holographic effect
- `flip-clock.tsx` — animated timer
- `knowledge-graph.tsx` — network graph
- `timeline.tsx` — event sequence

Utilities (keep):
- `alert.tsx` / `alert-dialog.tsx`
- `copy-button.tsx`
- `file-preview.tsx`
- `raised-button.tsx`
- `status-indicator.tsx`
- `virtual-list.tsx`
- `wave-spinner.tsx`

---

## Design System Alignment

mentiko's design philosophy (CLAUDE.md) is **flat, borderless, Apple Music aesthetic**:
- rounded-sm or rounded-md max
- No shadows, no borders, no glassmorphism
- Theme tokens: bg-card, bg-muted, bg-accent
- OKLCH color space (modern, perceptually uniform)

gaia-ui leans more skeuomorphic (borders + shadows + rounded-xl on cards).

**Decision**: mentiko's flat approach is intentional and correct. The main deviations from gaia-ui
(no card border/shadow, bg-muted inputs instead of border+ring) align with the stated design system.

---

## Key Findings for Storybook Migration

### Biggest Visual Gaps
1. **Card** — mentiko flat vs gaia skeuomorphic. Keep mentiko's approach, document as intentional.
2. **Button outline** — bg-muted vs border+shadow-xs. Minor, consider adopting gaia's polished look.
3. **Tabs** — mentiko's underline variant is more flexible than gaia's pill. Keep mentiko's.
4. **Input** — mentiko bg-muted vs gaia border+shadow-xs+ring. gaia more polished, consider adopting.
5. **Tooltip** — mentiko missing arrow. Low priority.

### Recommendations
1. Adopt gaia-ui avatar and calendar if those features expand.
2. Align input/button outline styling toward gaia-ui's border+ring approach for polish.
3. Add arrow to tooltip (one-liner).
4. Keep all mentiko-specific custom components — they're domain-specific, not gaia's scope.
5. Standardize on lucide-react (currently mixed with some hugeicons from gaia-ui copy-paste).

---

## Icon Library Status

- gaia-ui: hugeicons (more comprehensive icon set)
- mentiko: lucide-react (lighter, more consistent)
- Status: mentiko uses lucide throughout, which is correct. hugeicons is gaia-ui internal.
