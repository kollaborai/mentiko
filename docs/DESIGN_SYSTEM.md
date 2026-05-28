# mentiko DESIGN SYSTEM

## READ THIS FIRST

This document is for agents updating product pages.

The goal is simple:
- mentiko should look like mentiko
- shared UI should come from Gaia-style components where possible
- page redesigns must not invent a second design language

Gaia is a component reference, not a theme excuse.

If you make a page look like a separate product, a concept site, or a marketing demo, the work is wrong even if the page uses some Gaia ideas.

---

## NON-NEGOTIABLE RULES

1. Use existing shared components first.
2. Keep the existing app shell, density, and product chrome.
3. Do not add decorative hero treatments to normal workflow pages.
4. Do not duplicate emphasis. One featured visual surface is the maximum.
5. Do not write "Gaia" in end-user UI copy unless the page is literally about Gaia.
6. Do not fork a Gaia component into a page-specific redesign and still call it Gaia.
7. If a shared component is missing, create one shared component that fits Gaia's look and mentiko's density. Do not build one-off page chrome first.

If you violate any rule above, stop and fix that before shipping.

---

## WHAT "USE GAIA" MEANS HERE

Using Gaia does **not** mean:
- adding holographic headers
- adding extra blue feature cards
- adding decorative gradients to a workflow page
- putting Gaia-themed labels into the UI
- making one page feel more "special" than the rest of the product

Using Gaia **does** mean:
- prefer Gaia-derived shared primitives when they already exist in `web/components/ui`
- if a primitive is missing, inspect the local Gaia UI source checkout or the public Gaia UI registry
- copy the component anatomy and interaction model, then adapt it to mentiko tokens and density
- preserve the current product shell and navigation
- keep layouts compact, readable, and operational

Short version:
- Gaia should influence components
- mentiko should still own the page

---

## REQUIRED IMPLEMENTATION ORDER

For every page update, do this in order:

1. Inventory the existing shared components in `web/components/ui`.
2. Reuse the existing app header, section, button, card, and list patterns.
3. Check Gaia only for missing primitives or interaction patterns.
4. If something is missing, build a shared component first.
5. Only then apply the new component to the page.

Never start by hand-styling a page with raw divs, gradients, and bespoke chrome.

---

## BASELINE MODEL

The default mentiko workflow page is:
- dense
- neutral
- list-detail
- operational

Use the current `runs`, `tasks`, and cleaned-up `decisions` flows as the baseline model.

That means:
- compact page header
- compact filter/search row
- dense list items
- dense detail header
- standard card surfaces
- emphasis through structure, not spectacle

If you are redesigning a workflow page and it stops looking like those pages, you are probably going in the wrong direction.

This is the default shell to copy:
- top header with title, short description, and a small action cluster
- optional compact filter/search strip under the header
- left list / right detail split when the workflow benefits from comparison or browsing
- shared cards and badges for rows and metadata
- compact action buttons (`h-7` / `h-8`)

This is **not** the default shell:
- marketing-style hero header
- giant title block with decorative chips
- special glassy cards
- blue glow selection states
- blurred floating pills
- two layers of “featured” surfaces before the user even reaches the content

---

## PAGE HEADER RULES

> **NOTE:** `PageHeader` has been superseded by `PageBanner` for all workflow
> and docs pages. See the PAGE BANNER SYSTEM section below. `PageHeader` is
> retained for backward compatibility but new pages should use `PageBanner`.

Normal application pages must use the shared `PageHeader` component.

```tsx
import { PageHeader } from “@/components/ui/page-header”;

<PageHeader
  title=”Tasks”
  description=”Track and manage project issues”
  helpHref=”/docs/tasks”
  views={[
    { icon: ListIcon, value: “list”, label: “List view” },
    { icon: TreeIcon, value: “tree”, label: “Dependency tree” },
  ]}
  activeView={viewMode}
  onViewChange={setViewMode}
  actions={
    <>
      <Button size=”sm” variant=”ghost” onClick={generate}>Generate</Button>
      <Button size=”sm” onClick={create}>New Task</Button>
    </>
  }
/>
```

Layout (all left-aligned, stacked vertically):
- row 1: h1 title + help (i) icon (links to docs page)
- row 2: description (text-xs text-foreground/50)
- row 3: toolbar — view toggles + action buttons, left-aligned, flex-wrap

Rules:
- ALWAYS use `<PageHeader>` — do not hand-roll headers
- use a static description, not dynamic counts (sidebar shows counts)
- helpHref links to the relevant /docs page
- views are optional (only for pages with multiple view modes)
- actions are optional (buttons for create, generate, import, etc)
- all toolbar items are left-aligned, not pushed to the right

Do not:
- use `justify-between` to push actions to the far right
- put dynamic counts (“21 open · 0 closed”) in the header
- add a featured card to the page header
- repeat the selected record inside the page header
- create a separate “hero” for a workflow screen
- turn the page title area into a design statement

If the detail pane already contains a featured card, the page header must stay plain.

---

## SIDEBAR LIST ITEM RULES

All list-detail pages must use `WorkflowSidebarItem` for sidebar list items.
Do NOT use `WorkflowCard` — it is deprecated for sidebar use.

The standard sidebar item layout (modeled after the decisions page):

```tsx
<WorkflowSidebarItem
  selected={isSelected}
  onClick={onSelect}
  accentClassName={statusBar(item.status)}
>
  <div className="pl-4">
    {/* row 1: title + time ago */}
    <div className="flex items-start justify-between gap-2 pr-5">
      <span className="line-clamp-2 text-sm font-semibold leading-5">
        {item.title}
      </span>
      <TimeAgo date={item.date} format="short" suffix={false}
        className="shrink-0 !text-[10px] text-foreground/30" />
    </div>

    {/* row 2: description */}
    <p className="line-clamp-1 text-[11px] text-foreground/40 mt-0.5">
      {item.description}
    </p>

    {/* row 3: status pill + meta pills */}
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-foreground/40">
      <span className={`rounded-full px-2 py-0.5 uppercase tracking-[0.14em] ${statusPill(item.status)}`}>
        {statusLabel(item.status)}
      </span>
      {/* additional meta pills */}
    </div>
  </div>
</WorkflowSidebarItem>
```

Rules:
- always use `WorkflowSidebarItem` as the container
- accent bar colored by status via `statusBar()` from `@/lib/status-colors`
- status pills colored via `statusPill()` from `@/lib/status-colors`
- title: text-sm font-semibold, line-clamp-2
- time ago: top-right, text-[10px] text-foreground/30, always visible
- description: text-[11px] text-foreground/40, line-clamp-1
- pills: rounded-full bg-foreground/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]
- group headers use `WorkflowSidebarSectionHeader` with collapsible support

Status color system (`@/lib/status-colors`):
- running    = amber   (in progress)
- complete/d = green   (success)
- error      = red     (failure)
- stopped    = orange  (needs attention)
- cancelled  = zinc    (intentional, no big deal)
- pending    = neutral (waiting)

Do not:
- use `WorkflowCard` in sidebar lists
- put time ago in the pill row (it belongs top-right with the title)
- use different color mappings per page — always use the shared status-colors.ts
- add checkboxes to sidebar items unless there is a bulk action that uses them

---

## EMPHASIS RULES

Strong visual emphasis is limited.

Rules:
- use at most one strongly colored or highly featured surface per workflow page view
- do not show the same entity twice in two different featured cards
- do not place a blue featured card in the page header and another blue featured card in the detail pane
- if a `HoloCard` is used, it must have a real product reason, not just decoration
- if the page works without the featured card, remove it

This was the exact failure mode on the decisions page:
- one featured blue card in the header
- another featured blue card in the detail pane

That is not Gaia. That is over-styled duplication.

This was also the exact failure mode on the runs page:
- hero header added to a dense operational screen
- rounded-2xl list cards with glow, blur, and left color bars
- dense workflow rows replaced with bespoke showcase cards

That is not a design-system improvement. That is a fork away from the system.

---

## COMPONENT SOURCING RULES

Before creating or changing UI, check these in order:

1. `web/components/ui`
2. other existing product components on nearby pages
3. Gaia UI registry source (local checkout or public docs)

Preferred behavior:
- use the shared component as-is
- if it needs extension, extend the shared component
- if no component exists, create a new shared primitive

Do not:
- rebuild a shared primitive locally inside a page file
- rename a custom component to match a Gaia component while changing its visual language
- create page-specific versions of buttons, list rows, cards, or headers unless there is a strong product reason

---

## VISUAL LANGUAGE RULES

mentiko is:
- dense
- flat
- operational
- restrained
- layered through value shifts, not spectacle

mentiko is not:
- glossy
- sci-fi
- marketing-heavy
- oversized
- novelty-driven

Required defaults:
- compact spacing
- restrained metadata
- clear hierarchy through order and typography
- surfaces separated mostly by background value, not dramatic effects

Avoid by default:
- decorative gradients
- multiple tinted highlight blocks
- large empty hero spacing
- one-off premium panels
- animation used only to create spectacle

If a page looks “cooler” but less like the rest of the product, it is worse.

---

## APP SIDEBAR RULES

The global app sidebar is part of the product shell.

It should feel:
- dense
- quiet
- layered
- slightly inset
- clearly hierarchical

It should not feel:
- flat and empty
- like a generic admin template
- like a second competing product inside the shell
- visually identical to the contextual flyout or top navigation

Use this structure:
- one outer sidebar shell
- nested section groups with subtle tonal separation
- compact rounded rows inside each group
- one unmistakable active state

Required behavior:
- section headers are typographic, small, and quiet
- rows are compact and consistent
- active row must be obvious at a glance
- hover state must be visible but weaker than active
- workspace block should feel like the top of the same system, not a different widget

Required visual treatment:
- rounded outer shell
- rounded section containers
- subtle border or inset edge between shell layers
- stronger contrast between shell, section group, and active row
- use neutral values first; use color sparingly

Do not:
- leave the entire rail as one flat black slab
- make the active row barely darker than hover
- create two sidebars with the same weight and treatment
- use loud gradients, glow, blur, or showcase cards in navigation
- add novelty styling that does not exist elsewhere in the shell

Navigation hierarchy rule:
- the far-left rail is the stable product navigation
- any adjacent panel must read as contextual navigation, not a duplicate of the first rail

If the sidebar and secondary navigation look like the same component repeated twice, the shell is wrong.

Workflow-local sidebars:
- are narrower and quieter than the app rail
- use the same density, but lighter emphasis
- group links into subtle section containers
- should feel attached to the current domain, not like a second global nav
- should use neutral active states, not another loud accent language

---

## TOKENS AND SPACING

Use app tokens:
- `bg-background`
- `bg-card`
- `bg-muted`
- `bg-accent`

Use compact spacing:
- page header: `px-4 py-3`
- normal panel: `p-3`
- larger panel only when necessary: `p-4`
- normal gap: `gap-2` or `gap-3`
- dense button height: `h-7` or `h-8`

Corner rhythm:
- `rounded-sm`
- `rounded-md`

Do not default to:
- `rounded-xl`
- `rounded-2xl`
- oversized chips
- loose dashboard spacing
- `shadow-*`
- `backdrop-blur-*`
- decorative glow states

If the page starts to feel airy, reduce padding and gap before changing typography.

Dense does not mean cramped. Dense means:
- low decorative waste
- high scan speed
- compact but readable rows
- enough structure to compare information quickly

---

## BUTTON RULES

Primary actions:
- use shared button primitives, preferably Gaia-derived ones already present in the app
- keep primary action count low
- one obvious primary action per section is usually enough

Do not:
- mix multiple competing primaries in the same small area
- create page-specific button chrome when `RaisedButton` or the standard `Button` already solves it
- upsize buttons just to make the page feel more dramatic

---

## COPY RULES

Do not put implementation language into product copy.

Do not say:
- "Gaia review surface"
- "Gaia intake"
- "Gaia header"
- anything else that leaks internal design-system language into the UI

Use product language instead:
- "Decision intake"
- "Review options"
- "Open implementation task"
- "Research summary"

The UI should describe the product job, not the source of the component style.

---

## WHEN TO CREATE A NEW SHARED COMPONENT

Create a new shared component only when all of the following are true:
- the page needs a repeated pattern
- no current shared component fits
- the pattern will likely be reused on another page
- the component can be described as a product primitive, not a one-off composition trick

When you add one:
- place it in `web/components/ui`
- keep props small and reusable
- match Gaia component structure where relevant
- match mentiko tokens, spacing, and density

---

## RED FLAGS

If any of these are true, stop and rework the page:
- the page header became a hero
- the page contains two featured cards of the same importance
- the page says "Gaia" anywhere in user-facing copy
- the page looks more like a themed landing page than an internal workflow tool
- the component names say Gaia but the visuals do not
- the page looks out of place next to tasks, runs, workflows, and settings
- list rows turned into showcase cards with shadows, blur, or glow
- dense workflow cards were replaced by large rounded-2xl surfaces
- the redesign added “specialness” instead of clarity

---

## AGENT CHECKLIST BEFORE YOU FINISH

Every page update must pass this checklist:

1. I reused existing shared components before inventing new ones.
2. I checked Gaia for missing primitives, not for permission to redesign the whole page.
3. The page header is neutral and compact.
4. The page has no duplicate featured cards.
5. The UI contains no user-facing "Gaia" copy.
6. The page still looks like mentiko next to adjacent routes.
7. Any new primitive was added as a shared component, not a page-only hack.
8. The result improved the workflow without adding decorative chrome.
9. I did not replace dense workflow rows with bespoke hero/list-card styling.
10. The page would still feel normal next to `runs`, `tasks`, and `decisions`.

If you cannot say yes to every line above, the work is not done.

---

## ICON RULES

mentiko uses `@aliimam/icons` as the ONLY icon library. `lucide-react` is deprecated and must not be used in new code. Existing lucide-react usage should be migrated to @aliimam/icons equivalents.

`@aliimam/icons`:
- use **Filled** variants for navigation: `CpuFilled`, `RouteSquareFilled`, `BoxFilled`, etc.
- use **non-Filled** variants for inline/contextual use: action buttons, metadata indicators, form elements
- import: `import { CpuFilled, AddCircle } from "@aliimam/icons"`
- browse available icons: check the @aliimam/icons package exports

Chain icons (`@aliimam/vectors`):
- chains use **abstract category vectors** from `@aliimam/vectors` as their identity icon
- the `ChainIcon` component (`web/components/chain/chain-icon.tsx`) deterministically maps a chain name to a unique abstract vector + color via hash
- always use `<ChainIcon seed={chainName} />` to render chain identity — never use a generic workflow icon for a specific chain
- vectors are from the `allVectors.abstract` category, sorted by id for deterministic ordering

Summary:
- ALL icons → `@aliimam/icons` (Filled for nav, non-Filled for inline)
- chain identity → `@aliimam/vectors` via `ChainIcon`
- lucide-react → DEPRECATED, do not add new imports, migrate existing usage

Do not:
- import from `lucide-react` in new code
- use a generic icon where `ChainIcon` should provide chain identity
- mix icon libraries within the same visual context

Migration:
- 106 files still import from lucide-react (as of 2026-03-15)
- when touching a file that imports lucide-react, replace with @aliimam/icons equivalents
- common mappings: Plus→AddFilled, RefreshCw→RefreshFilled, Trash2→Trash, Check→TickCircleFilled, X→CloseCircleFilled, Search→SearchNormalFilled, Settings→Setting2Filled, ChevronDown→ArrowDown1Filled

---

## PAGE BANNER SYSTEM

Every page MUST use the `PageBanner` component as its header. `PageHeader` is the old
compact header and has been superseded by `PageBanner` for all workflow and docs pages.

```tsx
import { PageBanner } from "@/components/ui/page-banner";
import { LinkFilled, BotMessageSquare, RouteSquareFilled } from "@aliimam/icons";

<PageBanner
  title="Chains"
  subtitle="Define agent workflows as visual pipelines."
  icon={LinkFilled}
  sectionColor="#b07ee8"
  actions={[
    { label: "Agents", href: "/agents", icon: BotMessageSquare, iconColor: "#b07ee8" },
    { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
  ]}
  docs={[
    { label: "Chains Guide", href: "/docs/chains", icon: LinkFilled },
  ]}
/>
```

Props:
- `title` — page title, rendered as h1 text-4xl font-black tracking-tighter
- `subtitle` — description, text-sm text-foreground/50, max-w-2xl
- `icon` — the page's identity icon (from @aliimam/icons or @aliimam/vectors), used as watermark
- `sectionColor` — hex color for watermark tint; must match the page's section color
- `actions` — array of BannerAction objects (icon-only charm buttons with tooltips)
- `docs` — array of BannerDoc objects (doc link charms, always amber)
- `children` — additional content rendered below subtitle + charms

Visual anatomy:
- background: bg-transparent (no card bg, sits directly on page background)
- pattern: zinc-based CSS pattern (#71717a, #a1a1aa, #3f3f46) selected by title hash
- pattern fade: mask from solid at left to transparent at right (50% -> 100%)
- watermark: the page's identity icon, 3x oversized (size={400}), right-aligned,
  colored by sectionColor, 0.15 opacity, hidden on small screens
- title: text-4xl font-black tracking-tighter (row 1)
- subtitle: text-sm text-foreground/50 leading-relaxed (row 2)
- charms: action + doc icon buttons with tooltips (row 3)

Pattern colors (all zinc family):
- primary: #71717a (zinc-500)
- light: #a1a1aa (zinc-400)
- dark: #3f3f46 (zinc-700)

Pattern types (auto-selected by title hash): crosshatch, radial dots,
diamonds, diagonal stripes, sunburst, fine grid.

Do not:
- use PageHeader where PageBanner should be used
- pass colors outside the 5 section color palette to sectionColor
- override the banner's internal layout
- add borders or shadows to the banner container

---

## CHARM SYSTEM

Charms are icon-only buttons with radix tooltips. They appear in the third row
of PageBanner, providing quick navigation to related pages and documentation.

Two types:

Action charms:
- cross-link to related pages
- icon: the destination page's identity icon
- color: the destination page's section color (via iconColor prop)
- hover: bg-foreground/5

Doc charms:
- link to documentation pages
- icon: the topic's identity icon (defaults to DocumentTextFilled)
- color: always amber (#f59e0b)
- hover: bg-foreground/5
- icon opacity: 0.5 default, 0.8 on hover

Generate charms:
- trigger AI generation actions
- icon: always MagicStarFilled (set generate: true on the action)
- color: purple (text-purple-400, hover bg-purple-500/10)

Divider:
- a thin vertical line (w-px h-4 bg-foreground/10 mx-1) separates action charms
  from doc charms when both are present

```tsx
// action charm: navigates to Agents page (workflow section)
{ label: "Agents", href: "/agents", icon: BotMessageSquare, iconColor: "#b07ee8" }

// action charm: navigates to Runs page (workspace section)
{ label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" }

// doc charm: links to chains documentation
{ label: "Chains Guide", href: "/docs/chains", icon: LinkFilled }

// generate charm: triggers AI generation
{ label: "Generate", icon: MagicStarFilled, onClick: handleGenerate, generate: true }
```

Rules:
- charm icons are always h-4 w-4
- charm buttons use p-1 rounded-md
- always wrap charms in a TooltipProvider with delayDuration={200}
- action charms colored by the DESTINATION section, not the current section
- doc charms are ALWAYS amber regardless of current section

---

## ICON + COLOR IDENTITY SYSTEM

Every page has a unique identity icon from @aliimam/icons. Every section has a
fixed color. See /docs/icon-system for the full interactive mapping.

5 section colors:
- workspace: #5b9ef5 (blue) — active execution context (runs, tasks, conversations, decisions, activity, schedules)
- workflows: #b07ee8 (purple) — pipeline definitions (chains, agents, artifacts, templates, generation, events, email, webhooks, map)
- marketplace: #5cb88a (green) — shared registry (marketplace, marketplace/chains, marketplace/agents, etc.)
- mentiko: #f59e0b (amber) — platform home (dashboard, updates, docs, notifications, workspaces)
- settings: #a0927b (tan) — configuration (all /settings/* pages)

Core rule: icon = WHAT (which page), color = WHERE (which section).

Same icon + different color = same concept in different context:
- LinkFilled in purple = Workflow Chains
- LinkFilled in green = Marketplace Chains
- BotMessageSquare in purple = Workflow Agents
- BotMessageSquare in green = Marketplace Agents
- BotMessageSquare in tan = Settings Agent Configs

Where identity is used:
- PageBanner watermark (oversized, 0.15 opacity)
- sidebar navigation (Filled variant)
- charm buttons on other pages (cross-links)
- empty states (48-64px, reduced opacity)
- notification items (source page's icon + color)
- card watermarks (large, low opacity, bottom-right)

Do not:
- invent new section colors
- use a page's icon in the wrong section color
- use generic icons where an identity icon is assigned
- put section colors on non-identity elements

---

## SIDEBAR PANE STYLING

List-detail pages use WorkflowSidebarPane for the left list panel.

Standard sidebar pane:
- container: bg-muted rounded-xl border-border/60
- NO patterns on sidebar (patterns are ONLY for PageBanner)
- search/filter inputs use bg-card
- filter buttons use bg-accent

Outer layout:
- the flex container holding sidebar + detail pane uses pl-4 left margin
- sidebar width is typically w-[340px] or w-[380px]

```tsx
<div className="flex h-full pl-4">
  <WorkflowSidebarPane>
    <WorkflowSidebarFilters>
      <WorkflowSidebarSearchInput value={q} onChange={setQ} />
    </WorkflowSidebarFilters>
    <WorkflowSidebarSectionHeader title="Active" count={5} />
    <WorkflowSidebarItem selected={selected} onClick={onSelect}>
      {/* content */}
    </WorkflowSidebarItem>
  </WorkflowSidebarPane>
  <div className="flex-1">
    {/* detail pane */}
  </div>
</div>
```

Do not:
- add patterns or watermarks to sidebars
- use bg-card for the sidebar pane itself (use bg-muted)
- use sharp corners on the sidebar container

---

## CARD WATERMARKS

Cards can include identity watermarks to reinforce page/feature identity.
Used on pages like /updates where cards benefit from visual personality.

Anatomy:
- large icon: h-48 w-48 (or similar oversized)
- position: absolute bottom-right, partially clipped by overflow-hidden
- opacity: 0.1
- color: the feature's section color

```tsx
<div className="relative overflow-hidden rounded-md bg-card p-6">
  {/* card content */}
  <div className="absolute -bottom-8 -right-8 pointer-events-none"
    style={{ color: "#b07ee8", opacity: 0.1 }}>
    <FeatureIcon className="h-48 w-48" />
  </div>
</div>
```

Auto-assignment: cards with keyword-based content can use title hashing
to deterministically select an icon and color from the identity system.

Rules:
- one watermark per card maximum
- never make watermarks interactive
- overflow-hidden on the card container is required (clips the oversized icon)
- watermark should be purely decorative — it must never interfere with content readability

---

## HEADING CONVENTIONS

Heading hierarchy across the app:

h1 — page title:
- delivered via PageBanner, not hand-rolled
- text-4xl font-black tracking-tighter
- one h1 per page, always inside PageBanner

h2 — section headers within page content:
- Title Case
- used in docs pages, settings sections, detail pane sections

h3 — subsection headers:
- Title Case
- used inside cards, collapsible groups, form sections

Do not:
- hand-roll h1 elements outside of PageBanner
- use sentence case for h2/h3 (use Title Case)
- use font-black on anything other than the PageBanner h1

---

## GENERATE BUTTON STANDARD

All AI generation actions across the app follow one consistent pattern.

Icon: always MagicStarFilled
Color: purple — bg-purple-500/10 text-purple-400
Loading state: RotateFilled with animate-spin (replaces MagicStarFilled during generation)

As a charm in PageBanner:
```tsx
{ label: "Generate", icon: MagicStarFilled, onClick: handleGenerate, generate: true }
```

As a standalone button:
```tsx
<Button variant="ghost" size="sm" className="bg-purple-500/10 text-purple-400"
  onClick={handleGenerate} disabled={generating}>
  {generating
    ? <RotateFilled className="h-4 w-4 animate-spin" />
    : <MagicStarFilled className="h-4 w-4" />}
  Generate
</Button>
```

Rules:
- NEVER use a different icon for AI generation actions
- NEVER use a different color for generation (always purple)
- always show a loading spinner during generation
- generate charms in PageBanner must set generate: true on the action

---

## REFERENCES

- Gaia UI docs: https://ui.heygaia.io/docs
- Gaia UI status: https://ui.heygaia.io/docs/status-beta
- Gaia UI source: local checkout or public registry docs
- Icon system: `/docs/icon-system` (interactive mapping of all page icons + section colors)
- PageBanner component: `web/components/ui/page-banner.tsx`
