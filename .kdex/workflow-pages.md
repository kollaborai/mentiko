---
title: Workflow Pages
type: component
tags: [pages, workflows, routes, react, list-detail]
related: []
---

## Overview

The workflow pages are a set of org-scoped Next.js pages that provide list-detail split views for managing AI agents, chains, artifacts, and related workflow entities. All pages share a consistent UI pattern: a resizable left sidebar for navigation/filtering and a right panel for detail view or editing.

Located in `web/app/(workflows)/`, these pages are:

- `/agents` - Agent library with role-based categorization
- `/chains` - Visual chain builder and chain list
- `/artifacts` - Output template management
- `/email` - Inbound/outbound email routing
- `/events` - Cross-chain event triggers and registry
- `/generation` - AI generation prompt templates
- `/links` - Two-agent collaboration sessions
- `/map` - Relationship visualization (artifacts → agents → chains)
- `/schedules` - Cron-based chain execution
- `/webhooks` - HTTP triggers and notifications

## Shared UI Components

### WorkflowSidebarPane

The left sidebar container used across all workflow pages. Features:

- Resizable width with drag handle (persisted to localStorage)
- Collapsible on mobile (hidden when detail view is active)
- Fixed min/max width constraints (280px - 600px, defaults vary by page)

```tsx
<WorkflowSidebarPane
  className={mobileView === "detail" ? "hidden md:flex" : "flex"}
  style={{ width: sidebarWidth }}
>
  {/* filters, search, list items */}
  <WorkflowSidebarResizeHandle onMouseDown={onDragStart} />
</WorkflowSidebarPane>
```

### WorkflowSidebarItem

Standard list item component with:
- Selected state styling
- Click handler for selection
- Optional accent color bar (left edge)
- Pl-4 content area for custom item layout

### WorkflowSidebarFilters

Filter bar container containing:
- `WorkflowSidebarSearchInput` - search field
- `WorkflowSidebarSegmentedControl` - tab/chip filter
- Action buttons (create, import, etc.)

### WorkflowSidebarResizeHandle

Drag handle for resizing sidebar width. Uses standard event listeners on document for smooth dragging.

## Common Patterns

### List-Detail Split

All pages follow this structure:

```tsx
<div className="flex-1 flex overflow-hidden pl-4">
  {/* Left: list */}
  <WorkflowSidebarPane style={{ width: sidebarWidth }}>
    <WorkflowSidebarFilters>{/* search, filters */}</WorkflowSidebarFilters>
    <div className="flex-1 overflow-y-auto">
      {filtered.map(item => (
        <WorkflowSidebarItem
          key={item.id}
          selected={selected?.id === item.id}
          onClick={() => handleSelect(item)}
        >
          {/* item content */}
        </WorkflowSidebarItem>
      ))}
    </div>
    <WorkflowSidebarResizeHandle onMouseDown={onDragStart} />
  </WorkflowSidebarPane>

  {/* Right: detail */}
  <div className={mobileView === "list" ? "hidden md:flex" : "flex"}>
    {selected ? <DetailPanel data={selected} /> : <EmptyState />}
  </div>
</div>
```

### Sidebar Width Persistence

Each page stores its sidebar width separately in localStorage:

```tsx
const SIDEBAR_KEY = "agents-sidebar-width"; // unique per page
const MIN_W = 280;
const MAX_W = 600;
const DEFAULT_W = 340;

// Restore on mount
useEffect(() => {
  const saved = localStorage.getItem(SIDEBAR_KEY);
  if (saved) {
    const w = parseInt(saved, 10);
    if (w >= MIN_W && w <= MAX_W) setSidebarWidth(w);
  }
}, []);

// Save on drag end
const onUp = () => {
  dragging.current = false;
  setSidebarWidth((w) => {
    localStorage.setItem(SIDEBAR_KEY, String(w));
    return w;
  });
};
```

### Mobile Responsive

Mobile view toggles between list and detail:

```tsx
const [mobileView, setMobileView] = useState<"list" | "detail">("list");

// Sidebar hidden when showing detail on mobile
<WorkflowSidebarPane
  className={mobileView === "detail" ? "hidden md:flex" : "flex"}
>

// Detail panel hidden when showing list on mobile
<div className={mobileView === "list" ? "hidden md:flex" : "flex"}>
```

### URL State Sync

Filter and search state is synchronized with URL query params:

```tsx
const searchParams = useSearchParams();
const [search, setSearch] = useState(searchParams.get("q") || "");
const [filterStatus, setFilterStatus] = useState<FilterStatus>(
  (searchParams.get("status") as FilterStatus) || "all"
);

useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const sync = (key: string, value: string, def: string) => {
    if (value === def) params.delete(key);
    else params.set(key, value);
  };
  sync("q", search, "");
  sync("status", filterStatus, "all");
  const qs = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
}, [search, filterStatus]);
```

## Page-Specific Features

### /agents

- **Categories**: Code, Review, Research, Planning, Writing (keyword-based classification)
- **Role colors**: Auto-assigned based on role keywords (sky, emerald, purple, amber, pink)
- **Actions**: Generate AI, Create, Import Skills
- **AgentRegistryDetail**: Full agent editor with YAML/JSON toggle

### /chains

- **Status filtering**: Active, Draft, Archived
- **Import**: File upload, URL, drag-drop (.chain.json)
- **Export**: JSON, Markdown, YAML formats
- **Keyboard shortcut**: Cmd+R / Ctrl+R to run selected chain
- **Flow graph**: ChainFlowGraph component visualizes agent pipeline
- **Recent runs**: Shows last 8 runs with status icons
- **Publish/Publish to marketplace**: Share chains publicly

### /artifacts

- **ArtifactTemplateEditor**: Side-by-side list with monaco editor
- **Generate AI**: Create templates from natural language
- **Types**: Various artifact types (report, schema, doc, etc.)

### /email

- **Three-pane layout**: Inboxes → Messages → Detail
- **Folders**: Unread, Processed, Failed
- **Actions**: Move to processed, Compose new, Create inbox
- **Polling**: useEmailPoller hook for auto-refresh

### /events

- **Tabs**: Triggers vs Registry
- **Flow diagram**: Visual representation of event connections
- **Test validation**: Check if emit event matches trigger event
- **Event registry**: Browse all platform events by domain

### /generation

- **Template editor**: Full YAML/JSON prompt editing
- **Categories**: chain, agent, decision, task, webhook, event
- **Save/Reset**: Bulk PUT endpoint for all templates
- **Auto-select**: First template selected on load

### /links

- **Modes**: Debate, Collaboration, Review
- **Run launcher**: Per-agent profile selection, workspace picker
- **Generate AI**: Create links from natural language description
- **Recent runs**: Shows last 5 link runs

### /map

- **Tree view**: Artifact → Agents → Chains cascading
- **Expandable**: Click to expand/collapse node children
- **Cross-triggers**: Shows event trigger relationships at bottom

### /schedules

- **Control plane banner**: Daemon status + circuit breaker
- **Snooze**: Temporarily disable with countdown timer
- **History panel**: Inline run history per schedule
- **Edit form**: Full schedule editing with cron presets

### /webhooks

- **Tabs**: Outbound (notifications) vs Inbound (triggers)
- **Test fire**: Send test payload to verify endpoint
- **Event checkboxes**: Multi-select for mentiko events
- **Inbound tokens**: One-time reveal, regenerate option

## Key Hooks

### useNamespaceFetch

Wraps API calls with namespace/org context from user session:

```tsx
const { fetchWithNamespace } = useNamespaceFetch();
const res = await fetchWithNamespace("/api/agents/registry");
```

### useWorkspace

Provides current workspace context for workspace-scoped operations:

```tsx
const { workspaces, workspaceId, workspacePath } = useWorkspace();
```

### useDebounce

Debounces search input to reduce filter recalculations:

```tsx
const debouncedSearch = useDebounce(searchQuery, 250);
```

## API Integration

All pages use the namespace-fetch wrapper which:
- Auto-includes org headers from session
- Handles auth redirects
- Standardizes error responses

Common pattern:
```tsx
try {
  const res = await fetchWithNamespace("/api/endpoint");
  const data = await res.json();
  setItems(data.items || []);
} catch {
  setItems([]);
} finally {
  setLoading(false);
}
```

## Icon System

Uses `@aliimam/icons` exclusively. Lucide-react is deprecated.

Common icons:
- `AddFilled` - create actions
- `Edit2Filled` - edit actions
- `TrashFilled` - delete actions
- `PlayFilled` - run/execute
- `LinkFilled` - chains
- `BotMessageSquare` - agents
- `BoxFilled` - artifacts
- `SendFilled` - events/webhooks

## Color Coding

Status colors follow the pattern in `status-colors.ts`:
- Complete/success: `emerald-400`
- Running/pending: `amber-400`
- Failed/error: `red-400`
- Cancelled/stopped: `orange-400`
- Disabled/inactive: `foreground/20` or `foreground/5`

## Gotchas

1. **Mobile view state**: Always track `mobileView` state separately from selection state. The detail panel is hidden on mobile until an item is selected.

2. **Sidebar resize drag-out**: The drag event listeners are attached to `document`, not the element. This prevents the drag from getting "stuck" if the mouse leaves the handle area.

3. **localStorage key conflicts**: Each page MUST use a unique SIDEBAR_KEY. The key should match the page name (e.g., "agents-sidebar-width").

4. **URL sync on initial load**: Read initial filter values from `searchParams` on mount, not from default state. This ensures sharing URLs works correctly.

5. **useRef for selection stability**: Some pages use `selectedRef` to maintain selection identity across re-renders, especially when polling updates the list.

6. **Generation dialogs**: Most pages have both "Create" (manual form) and "Generate" (AI-assisted) options. The generate option opens a dialog that calls the generation API.

7. **Empty states**: All pages show EmptyState component when list is empty, with appropriate action button to create first item.

8. **PageBanner component**: All pages use PageBanner for consistent header with title, subtitle, icon, action links, and docs links. The `sectionColor` prop matches the page's accent color.
