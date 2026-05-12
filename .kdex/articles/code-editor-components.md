---
title: Code Editor Components
type: component
linked_files:
  - web/components/editor/breadcrumb.tsx
  - web/components/editor/code-editor-client.tsx
  - web/components/editor/editor-config.tsx
  - web/components/editor/editor-page-client.tsx
  - web/components/editor/editor-pane.tsx
  - web/components/editor/file-tree.tsx
  - web/components/editor/floating-code-pill.tsx
  - web/components/editor/floating-sidebar.tsx
  - web/components/editor/floating-window-manager.tsx
  - web/components/editor/quick-open.tsx
  - web/components/editor/search-panel.tsx
  - web/components/editor/split-container.tsx
  - web/components/editor/status-bar.tsx
  - web/components/editor/tab-bar.tsx
file_hashes:
  web/components/editor/breadcrumb.tsx: sha256:a1ac44a2e7fece1b
  web/components/editor/code-editor-client.tsx: sha256:6fe8bfb9bb705180
  web/components/editor/editor-config.tsx: sha256:1fe7ace8b54a7cc8
  web/components/editor/editor-page-client.tsx: sha256:57600968174d05cf
  web/components/editor/editor-pane.tsx: sha256:755f564ee7c7966c
  web/components/editor/file-tree.tsx: sha256:e7eb38b16490ca04
  web/components/editor/floating-code-pill.tsx: sha256:69ac01a494b81698
  web/components/editor/floating-sidebar.tsx: sha256:c0b263bb4b5470db
  web/components/editor/floating-window-manager.tsx: sha256:0b387304b939a30f
  web/components/editor/quick-open.tsx: sha256:eb431a84d9f762c5
  web/components/editor/search-panel.tsx: sha256:1a4355ca2af7923c
  web/components/editor/split-container.tsx: sha256:b9bf8372d0193087
  web/components/editor/status-bar.tsx: sha256:4d48b91c514be236
  web/components/editor/tab-bar.tsx: sha256:706a081aaa28aa05
tags: [editor, monaco, file-tree, tabs, react]
created: 2026-04-07T09:43:11.417356
updated: 2026-04-07T09:43:11.417356
status: current
related: []
---

```yaml
---
title: Code Editor Components
type: component
tags: editor, monaco, file-tree, tabs, react
related: [[editor-store]], [[workspace-context]], [[use-namespace-fetch]]
---
```

## Overview

Multi-paned code editor built on Monaco Editor, featuring split panes, floating windows, tabbed editing, file tree browser, search-in-files, and quick-open (cmd+p). Accessed via `/code` route or floating overlay (cmd+shift+e). State managed by [[editor-store]].

## Key Components

| Component | Purpose |
|-----------|---------|
| `CodeEditorClient` | Main editor entry with floating sidebar, pill-nav header |
| `FloatingCodePill` | Fullscreen overlay editor, draggable/resizable panel |
| `EditorPane` | Single Monaco instance with markdown preview toggle |
| `FileTree` | Hierarchical browser with git status, inline create/rename |
| `SplitContainer` | Recursive split-pane renderer (horizontal/vertical) |
| `FloatingWindowManager` | Cascading floating windows with z-order management |
| `TabBar` | Draggable tabs with breadcrumbs, dirty indicators |
| `QuickOpen` | Fuzzy file search (cmd+p) |
| `SearchPanel` | Regex search-in-files with result grouping |
| `EditorConfigPanel` | Font size, tab size, word wrap, minimap settings |

## Key Interfaces

### TabBar Props
```tsx
interface TabBarProps {
  paneId: string;      // identifies which pane's tabs to show
  rootPath: string;    // workspace root for relative paths
}
```

### EditorPane Props
```tsx
interface EditorPaneProps {
  paneId: string;      // pane identifier for store lookup
  rootPath: string;    // for accent color calculation, breadcrumbs
}
```

### FileTree Props
```tsx
interface FileTreeProps {
  workspacePath: string;     // root directory to browse
  filterOpen?: boolean;      // show filter input
  onFileSelect?: () => void; // callback after file opened
}
```

## Control Flow

### Opening a File
1. User clicks file in `FileTree` or selects via `QuickOpen`
2. `openFile(paneId, path, name, ext, content)` called
3. Store updates pane's `openPaths`, sets `activePath`
4. `TabBar` re-renders with new tab
5. `EditorPane` mounts Monaco editor for that path
6. Content fetched via `/api/fs/file?path=...`

### Splitting Panes
1. `cmd+\` or split button calls `splitRight(paneId)`
2. Store creates new pane with same file
3. `splitTree` restructured: leaf → branch(direction, first, second)
4. `SplitContainer` recursively renders new structure
5. Resizable divider between panes (30-70% range)

### Search-in-Files
1. User types query in `SearchPanel`
2. Debounced (300ms) fetch to `/api/fs/search?query=&regex=`
3. Results grouped by file path
4. Click result → `openFile` + `setPendingReveal({line, column})`
5. Editor scrolls to position after content loads

## Patterns

### Monaco Theme Definition
Dynamic `mentiko-void` theme defined per-file based on accent color (folder-derived). `defineVoidTheme()` called on mount and when file switches. Colors computed via `hexToRgb()` + alpha blending.

### File Tree Expansion
Expanded folders persisted to localStorage: `editor-expanded-folders-{workspace}`. Ancestor paths auto-expanded when revealing active file.

### Tab Reordering
Native HTML5 drag-and-drop:
- `draggable=true` on tab
- `onDragStart` sets drag index
- `onDragOver` calculates insert position (midpoint split)
- `onDrop` calls `reorderFiles(paneId, from, to)`

### Git Status Integration
Git status fetched on mount, cached per file. Status indicators (M/A/D/?) shown as colored badges next to files. Status colors: amber (modified), green (added), red (deleted), gray (untracked).

### Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| `cmd+p` | Toggle quick open |
| `cmd+shift+f` | Toggle search panel |
| `cmd+s` | Save active file |
| `cmd+w` | Close active tab |
| `cmd+\` | Split right |
| `cmd+shift+\` | Split down |
| `cmd+shift+[` | Previous tab |
| `cmd+shift+]` | Next tab |
| `Escape` | Close overlay / clear filter |

## Gotchas

### Markdown Preview Toggle
Markdown files default to preview mode on open. Toggle stored in component state, reset when switching files. Preview renders via `Markdown` component (not Monaco).

### Monaco SSR
Monaco editor dynamically imported with `ssr: false`. Loading state shows `WaveSpinner` during hydration.

### File Path Resolution
All file paths resolved relative to `workspacePath`. `rootPath` prop used for accent color calculation (first folder determines color). Fallback to `configRoot` from `/api/config` when no active workspace.

### Dirty State
Files compared via `isDirty(file)` - checks if `content !== savedContent`. Dirty indicator shown in tab (amber dot) and floating "unsaved" badge above editor.

### Tab Breadcrumbs
Tabs show full relative path with segment separators. Long paths truncated. Active tab highlighted with accent color background + border.

### Panel Bounds Persistence
Floating code pill position/size persisted to `editor-overlay-bounds` as percentage-based bounds. Mobile forces fullscreen (bounds = `{top:0,left:0,right:0,bottom:0}`).

### Resize Handle Conflicts
Sidebar resize (drag divider) vs panel resize (edges + corners). Pointer capture used for smooth dragging. Safety timeout (3s) resets stuck drag state.

### Accent Color Derivation
`getFileAccentColor(path, rootPath)` extracts first folder segment from relative path, maps to folder color palette. Fallback to `#64748b` (slate) for unknown folders.

## Dependencies

- `@monaco-editor/react` - Monaco editor wrapper
- `@aliimam/icons` - Icon components (replacing lucide-react)
- `motion` / `framer-motion` - Animations for floating panels
- `editor-store` - Zustand store for panes, files, split tree
- `workspace-context` - Active workspace path
- `use-namespace-fetch` - Namespace-aware API wrapper
- `api-client` - `unwrapApiData()` helper