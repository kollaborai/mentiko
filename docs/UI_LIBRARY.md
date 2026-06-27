# UI LIBRARY

This is the internal component library for the web app.

Source of truth:
- `web/components/ui`
- `web/components/ui/index.ts`
- `web/components/ui/registry.ts`

This is not a separate npm package yet.

That is intentional.

Right now the priority is:
- establish one shared component surface
- stop page-local UI rewrites
- make agents reuse approved primitives
- tighten the library contract before extraction
- enforce one dense workflow baseline so pages stop drifting

If the shared surface stabilizes, we can split it into a package later.

---

## RULES

1. Import from `@/components/ui` before building anything page-local.
2. Use approved components by default.
3. Treat provisional components as limited-use until they are cleaned up.
4. If a component is missing, build a shared primitive first.
5. Register new shared components in `web/components/ui/registry.ts`.
6. Do not call something "Gaia" in user-facing copy just because it was inspired by Gaia.
7. Do not use decorative hero chrome to fake a design-system upgrade.
8. Default to the dense list-detail workflow shell unless the page has a strong reason not to.

---

## DEFAULT PAGE MODEL

The default product model is the dense workflow page.

Use current `runs`, `tasks`, and `decisions` as the visual baseline.

That baseline means:
- compact header
- compact search/filter controls
- dense list rows
- dense detail pane
- shared status/badge language
- neutral surfaces

Do not “improve” a workflow page by adding:
- hero headers
- oversized rounded cards
- blur
- glow
- decorative gradients
- showcase-card list items

If you want a page to feel better, improve:
- information order
- list row clarity
- metadata grouping
- action placement
- scan speed

---

## STATUS LEVELS

`approved`
- ready for broad use across product pages

`provisional`
- real shared component, but still has API drift, visual drift, or limited appropriate usage

`planned`
- not ready for broad adoption; keep local until a shared contract is defined

---

## WHAT THIS LIBRARY CONTAINS

Foundations:
- buttons
- cards
- badges
- inputs
- textarea
- select
- dialogs
- tabs

Workflow surfaces:
- notification card
- workflow card
- calendar event card
- chat composer
- nested menu
- raised button
- chain detail panel

Limited-use components:
- holo card
- specialized indicators and loading states
- entropy banner
- liquid metal border

---

## CHAIN DETAIL PANEL

`web/components/chain/chain-detail-panel.tsx` is the shared read-only chain
summary surface.

Use it anywhere a chain definition is being inspected but not edited:
- `/chains` selected-chain detail
- task assigned-chain section
- future run/task references to an assigned chain

Rules:
- do not duplicate the chain canvas/details block in route files
- keep task-specific controls outside the panel through adjacent action rows
- use `headerActions` for page-local actions like Edit, Run, status, or last run
- use `showOpenLink={false}` when the panel is already on the chains page
- use `compact` for embedded task views

The read-only flow preview uses `previewMode` on
`visual-editor-reactflow.tsx`. Keep editor behavior and preview behavior
separate: the editor can stay spacious and draggable; previews must be dense,
readable, and fit without making agents tiny.

Entry-trigger aliases matter for preview layout. The preview must treat
`manual-start`, `chain-started`, `chain_start`, and triggers with no local
emitter as entry points so generated/imported chains do not collapse into
orphan stacks.

---

## BANNER PRIMITIVES

`PageBanner` owns workflow-page header presentation. Keep watermark/pattern
effects contained inside the banner component, not leaking into route layouts.

`EntropyBanner` is a canvas banner primitive for controlled decorative motion.
It must remain behind normal product chrome, support reduced motion, and avoid
blocking typecheck with nullable canvas/context references.

---

## BUILD PROCESS FOR NEW COMPONENTS

1. Check `web/components/ui/index.ts`.
2. Check `web/components/ui/registry.ts`.
3. Check Gaia for the missing primitive pattern.
4. Create the component in `web/components/ui`.
5. Export it from `web/components/ui/index.ts`.
6. Add it to `web/components/ui/registry.ts`.
7. Update pages to consume the shared component.

Do not:
- build the component inline inside a route file
- duplicate an existing shared primitive with different styling
- add a page-specific version first and promise to clean it up later

---

## CURRENT KNOWN GAP

`HoloCard` is currently too easy to misuse on dense workflow pages.

It should stay a limited-use component until:
- its supported use cases are narrower
- its sizing behavior is clearer
- dense product pages stop forcing it into compressed summary slots

---

## DOCS

- In-app docs route: `/docs/ui-library`
- Design system rules: `docs/DESIGN_SYSTEM.md`
