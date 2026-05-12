# Multi-Root Workspace for Code Editor

date: 2026-04-08
status: ready for implementation

## Problem

The code editor sidebar shows a single workspace root folder. Users want to
add additional folders from their filesystem to the sidebar -- same as VS
Code's "Add Folder to Workspace" feature. Multiple independent directory
trees displayed simultaneously in the file tree panel.

## Design

### Data Model

Add `rootFolders` field to the Workspace interface:

```typescript
// web/lib/workspace-storage.ts
export interface Workspace {
  // ... existing fields ...
  /** Additional filesystem roots shown in the editor sidebar. */
  rootFolders?: string[];   // array of absolute paths
}
```

The existing `path` field stays as the primary workspace root and is always
shown first. `rootFolders` holds additional roots. Empty array or undefined
means single-root mode (current behavior, fully backward compatible).

### Files to Modify

```
web/lib/workspace-storage.ts          add rootFolders to Workspace interface
web/app/api/workspaces/[id]/route.ts  accept rootFolders in PATCH body
web/lib/path-validation.ts            include rootFolders in allowed roots
web/components/editor/file-tree.tsx   multi-root rendering + add/remove UI
web/components/editor/editor-page-client.tsx  pass rootFolders to FileTree
web/components/workspace/folder-browser.tsx   no changes (reuse as-is)
```

### API Changes

#### PATCH /api/workspaces/[id]

Add `rootFolders` to the accepted body fields:

```typescript
// web/app/api/workspaces/[id]/route.ts
const {
  // ... existing fields ...
  rootFolders,    // new
} = body as {
  // ... existing types ...
  rootFolders?: string[];   // new
};
```

Pass `rootFolders` through to `updateWorkspace()`. The existing
`updateWorkspace` function uses spread merge (`{ ...existing, ...updates }`)
so this works with no changes to workspace-storage.ts beyond the type.

Validation on PATCH:
- each entry in rootFolders must be an absolute path (starts with /)
- each path must exist on disk (fs.existsSync)
- no duplicates (dedupe before saving)
- primary workspace path must NOT appear in rootFolders (it's implicit)

#### Path Validation (Security)

```typescript
// web/lib/path-validation.ts  getAllowedRoots()
export function getAllowedRoots(request: NextRequest): string[] {
  const workspaces = listWorkspaces(namespaceId, orgId);
  const workspaceRoots = workspaces.flatMap((w) => [
    w.path,
    ...(w.rootFolders || []),   // <-- add this
  ]);
  return [config.root, config.workspaceDir, homedir(), ...workspaceRoots];
}
```

This ensures /api/fs/tree, /api/fs/file, and all other fs endpoints accept
paths under any registered root folder.

### Frontend Changes

#### FileTree Component (file-tree.tsx)

Current props:
```typescript
interface FileTreeProps {
  workspacePath: string;
  filterOpen?: boolean;
  onFileSelect?: () => void;
}
```

New props:
```typescript
interface FileTreeProps {
  workspacePath: string;
  rootFolders?: string[];     // additional roots
  onRootFoldersChange?: (folders: string[]) => void;  // persist changes
  filterOpen?: boolean;
  onFileSelect?: () => void;
}
```

##### Multi-Root Rendering

When `rootFolders` has entries, the tree renders multiple root sections:

```
[+ file] [+ folder] [+ root] [collapse all] [reveal]    <-- toolbar (add root button added)
                                                          
PRIMARY ROOT (workspace name)                             <-- collapsible section header
  bin/                                                    
  lib/                                                    
  web/                                                    
  package.json                                            
                                                          
~/other-project                                           <-- additional root section header
  src/                                                    
  tests/                                                  
                                                          
~/notes                                                   <-- another root
  todo.md                                                 
```

Each root section:
- has its own collapsible header showing the folder name (basename of path)
- full path shown as tooltip on the header
- fetches its own tree independently via /api/fs/tree?workspace={path}
- has its own loading/error state
- has its own expanded folders state (persisted separately in localStorage)
- has its own git status (fetched independently)
- right-click on root section header shows context menu:
  - "Remove Folder from Workspace" (removes from rootFolders, does NOT delete files)
  - "New file" (creates file at that root)
  - "New folder" (creates folder at that root)
  - "Copy Path" (copies absolute path)

The primary workspace root (workspace.path) CANNOT be removed via this menu.
It is always present. Only additional roots from rootFolders can be removed.

##### State Management

Each root maintains independent state:

```typescript
// per-root state, keyed by root path
interface RootState {
  tree: FileNode[];
  loading: boolean;
  error: string;
  expanded: Set<string>;
  gitStatus: Record<string, string>;
}

// inside FileTree component
const [rootStates, setRootStates] = useState<Map<string, RootState>>(new Map());
```

All roots array = [workspacePath, ...(rootFolders || [])].

On mount and when roots change, fetch tree + git status for each root.
Expanded state persisted to localStorage keyed as
`editor-expanded-folders-{rootPath}` (already works this way for the primary
root).

##### Add Root Folder Button

New button in the tree toolbar (line ~407-438 of file-tree.tsx), placed after
the existing "New folder" button and before "Collapse all":

```
[+ file] [+ folder] [+ root folder] [collapse all] [reveal]
```

Icon: use `FolderAddFilled` with a small "+" badge, or use a distinct icon.
Recommendation: reuse `FolderAddFilled` but with different tooltip
("Add folder to workspace"). To differentiate from "New folder", give it a
slightly different style -- e.g. a small dot indicator or use the existing
`FolderOpenFilled` icon.

Actually, simplest approach: use `import { Import1Filled } from "@aliimam/icons"`
or similar. Check what's available. Worst case, `FolderAddFilled` with
title="Add folder to workspace" is clear enough since "New folder" already
has title="New folder".

On click, show the FolderBrowser in a popover/dropdown anchored to the button.
Implementation options (in order of preference):

**Option A: Inline panel** (recommended)
Show the FolderBrowser component directly in the sidebar, replacing the tree
content temporarily. Add a small header bar with "Add Folder" title and a
close/cancel button. When user selects a folder, add it to rootFolders and
close the browser. This is the simplest approach and reuses FolderBrowser
exactly as-is.

```
[cancel]  Add Folder to Workspace
+----------------------------------+
| FolderBrowser component here     |
| (existing component, no changes) |
+----------------------------------+
```

**Option B: Popover**
Use Radix Popover anchored to the button. Contains FolderBrowser. Wider than
the sidebar, so it may overflow. Needs careful positioning.

Go with Option A. It's simpler and matches the existing pattern of the sidebar
switching between Files/Search/Settings views.

##### Add Folder Flow

1. User clicks "Add folder to workspace" button in toolbar
2. Sidebar switches to "add-folder" mode showing FolderBrowser
3. User browses and selects a folder (or creates a new one, then selects it)
4. On select:
   a. validate: not a duplicate, not the primary workspace path
   b. call onRootFoldersChange([...currentRootFolders, selectedPath])
   c. switch sidebar back to "files" mode
   d. new root section appears at the bottom of the tree
5. onRootFoldersChange in EditorPageClient calls
   PATCH /api/workspaces/{id} with updated rootFolders

##### Remove Folder Flow

1. User right-clicks on a root section header (not the primary root)
2. Context menu shows "Remove Folder from Workspace"
3. On click: call onRootFoldersChange(currentRootFolders.filter(f => f !== path))
4. Root section disappears from the tree
5. No confirmation dialog needed (this only removes it from the sidebar,
   files are untouched)

#### EditorPageClient (editor-page-client.tsx)

Currently passes `workspacePath` to FileTree. Changes:

```typescript
// existing
const currentWorkspace = workspaces.find((w) => w.id === workspaceId);
const workspacePath = currentWorkspace?.path ?? "";

// add
const rootFolders = currentWorkspace?.rootFolders ?? [];

const handleRootFoldersChange = useCallback(async (folders: string[]) => {
  if (!workspaceId) return;
  try {
    await fetchWithNamespace(`/api/workspaces/${encodeURIComponent(workspaceId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootFolders: folders }),
    });
    // refresh workspace list to pick up the change
    refreshWorkspaces();
  } catch {
    // show error toast
  }
}, [workspaceId, fetchWithNamespace, refreshWorkspaces]);
```

Pass to FileTree:
```tsx
<FileTree
  workspacePath={workspacePath}
  rootFolders={rootFolders}
  onRootFoldersChange={handleRootFoldersChange}
/>
```

Need to verify that `useWorkspace()` exposes a `refreshWorkspaces` or similar
function. If not, add one -- it just re-fetches GET /api/workspaces and
updates context state.

#### SplitContainer / File Opening

SplitContainer currently receives `rootPath={workspacePath}`. For multi-root,
it needs to determine which root a file belongs to for accent colors and
relative path display.

```typescript
// web/components/editor/split-container.tsx
// change rootPath prop to accept multiple roots
interface SplitContainerProps {
  rootPath: string;
  rootFolders?: string[];  // additional roots for path resolution
}
```

For `getFileAccentColor`, resolve which root the file falls under:
```typescript
function findRootForFile(filePath: string, roots: string[]): string {
  return roots.find(r => filePath.startsWith(r + "/") || filePath === r) || roots[0];
}
```

This is a minor change. The editor tab display already shows full filenames,
so multi-root doesn't break tab rendering.

#### Search Panel (search-panel.tsx)

The search panel currently searches within `workspacePath`. For multi-root,
it should search across all roots. Update the search API call to include
all root paths, or make multiple parallel search calls (one per root) and
merge results.

Simplest approach: make N parallel search requests (one per root), merge
and sort results. The search panel already shows file paths, so results
from different roots are naturally distinguishable.

#### Quick Open (quick-open.tsx)

Same as search -- currently scoped to workspacePath. For multi-root, the
quick open overlay should search across all roots. Make parallel
/api/fs/search calls and merge results.

### Edge Cases

1. **Deleted folder**: if a rootFolder path no longer exists on disk,
   show an error state in that section ("folder not found") with a
   "Remove" button. Don't crash.

2. **Duplicate detection**: when adding, check against all existing
   roots (primary + rootFolders). Also check if the new path is a
   parent or child of an existing root -- warn but allow.

3. **Workspace switching**: rootFolders are per-workspace. When user
   switches workspace, the new workspace's rootFolders (or lack thereof)
   take effect. No cross-workspace state leakage.

4. **Path security**: rootFolders are added to getAllowedRoots, so the
   existing path validation covers all FS operations within added roots.

5. **Performance**: each root folder triggers its own /api/fs/tree call.
   For workspaces with many roots, this means multiple API calls on load.
   Acceptable for <10 roots. If needed later, batch into a single
   /api/fs/tree?workspaces=path1,path2 endpoint.

6. **Git status**: fetched per root. Each root may or may not be a git
   repo. Non-git roots just show no git indicators (current behavior
   when git status returns empty).

### Implementation Order

1. **Workspace model + API** (30 min)
   - add rootFolders to Workspace interface in workspace-storage.ts
   - add rootFolders to PATCH handler in workspaces/[id]/route.ts
   - add validation (absolute path, exists, no dupes)
   - add rootFolders to getAllowedRoots in path-validation.ts

2. **FileTree multi-root rendering** (1-2 hrs)
   - refactor FileTree to manage per-root state (tree, loading, expanded, git)
   - render root section headers with folder name + collapse
   - context menu on root headers (remove folder)
   - primary root is always first, additional roots follow in order

3. **Add folder UI** (45 min)
   - add "Add folder to workspace" button to toolbar
   - implement inline FolderBrowser panel mode
   - wire onSelect to add root folder + persist via API

4. **EditorPageClient wiring** (30 min)
   - read rootFolders from workspace context
   - pass to FileTree
   - handle onRootFoldersChange with PATCH API call
   - refresh workspace context after change

5. **Search + Quick Open** (30 min)
   - update SearchPanel to search across all roots
   - update QuickOpen to index across all roots
   - merge results from parallel queries

6. **SplitContainer accent colors** (15 min)
   - pass rootFolders to SplitContainer
   - resolve file accent color from correct root

### What NOT to Do

- do NOT create a new dialog/modal component for folder selection
  (reuse FolderBrowser)
- do NOT modify FolderBrowser component (use as-is)
- do NOT add a new API endpoint for multi-root tree fetching
  (call existing /api/fs/tree once per root)
- do NOT change the workspace.path field meaning (stays as primary root)
- do NOT add drag-and-drop reordering of roots (not needed for v1)
- do NOT add rename/edit of root folder paths (remove and re-add instead)
