import { create } from "zustand";

// a non-file editor tab that renders a React view instead of Monaco.
// keeps Git surfaces (peer review, etc.) inside the editor's own stacking
// context so they never portal out behind the floating code pill.
export type EditorView = {
  type: "peer-review";
  workspacePath: string;
  selectedFiles: string[];
  sourceBranch: string;
} | {
  type: "tasks-db";
  mode: "table" | "schema" | "recent" | "graph" | "dependencies" | "diagnostics" | "select";
  table?: string;
};

// shared file data (content is synced across panes showing same file)
export interface FileData {
  path: string;
  name: string;
  ext: string;
  content: string;
  savedContent: string;
  loading: boolean;
  pinned: boolean;
  originalContent?: string; // HEAD content for diff view
  view?: EditorView; // when set, this tab renders a React view (not a file)
}

// a single pane's view state (paths only, content from fileCache)
export interface EditorPane {
  id: string;
  openPaths: string[];
  activePath: string | null;
}

// split tree node - either a leaf (pane) or a branch (split)
export type SplitNode =
  | { type: "leaf"; paneId: string }
  | {
      type: "split";
      direction: "horizontal" | "vertical";
      first: SplitNode;
      second: SplitNode;
      sizePercent: number; // % of space given to first child
    };

export interface EditorConfig {
  fontSize: number;
  tabSize: number;
  wordWrap: "off" | "on" | "wordWrapColumn";
  minimap: boolean;
  lineNumbers: "on" | "off" | "relative";
  renderWhitespace: "none" | "boundary" | "all";
}

const EDITOR_CONFIG_KEY = "editor-config";
const OVERLAY_OPEN_KEY = "editor-overlay-open";
const DEFAULT_CONFIG: EditorConfig = {
  fontSize: 11,
  tabSize: 2,
  wordWrap: "on",
  minimap: false,
  lineNumbers: "on",
  renderWhitespace: "boundary",
};

function loadEditorConfig(): EditorConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const saved = localStorage.getItem(EDITOR_CONFIG_KEY);
    if (saved) return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
  } catch {}
  return DEFAULT_CONFIG;
}

interface EditorStore {
  // shared file cache
  fileCache: Map<string, FileData>;

  // panes
  panes: EditorPane[];
  activePaneId: string;
  splitTree: SplitNode;

  // tree workspace path
  treeWorkspacePath: string | null;

  // sidebar view
  sidebarView: "files" | "search" | "config" | "git" | "db";
  setSidebarView: (view: "files" | "search" | "config" | "git" | "db") => void;
  searchPanelVisible: boolean;
  toggleSearchPanel: () => void;
  pendingReveal: { path: string; line: number; column: number } | null;
  setPendingReveal: (reveal: { path: string; line: number; column: number } | null) => void;

  // cross-panel signal: bumped when a peer review is created/changed so the
  // Git panel can refresh its reviewer tracker even though the review UI now
  // lives in a detached editor tab (not a child of the panel).
  reviewsRevision: number;
  notifyReviewsChanged: () => void;

  // editor config
  editorConfig: EditorConfig;
  updateEditorConfig: (partial: Partial<EditorConfig>) => void;

  // pane-scoped actions
  openFile: (paneId: string, path: string, name: string, ext: string, content: string) => void;
  closeFile: (paneId: string, path: string) => void;
  setActiveFile: (paneId: string, path: string) => void;
  updateContent: (path: string, content: string) => void;
  markSaved: (path: string, content: string) => void;
  setFileLoading: (path: string, loading: boolean) => void;
  pinFile: (path: string) => void;

  // diff view
  openDiffFile: (paneId: string, path: string, name: string, ext: string, modified: string, original: string) => void;

  // non-file view tab (peer review, etc.) — keyed by a synthetic path so it
  // participates in the normal tab lifecycle (activate/close/reorder).
  openView: (paneId: string, key: string, name: string, view: EditorView) => void;

  // reorder tabs
  reorderFiles: (paneId: string, fromIndex: number, toIndex: number) => void;

  // pane management
  splitRight: (paneId: string) => void;
  splitDown: (paneId: string) => void;
  setActivePane: (paneId: string) => void;
  closePane: (paneId: string) => void;

  // workspace
  setTreeWorkspacePath: (path: string) => void;

  // floating overlay
  isOverlayOpen: boolean;
  openOverlay: () => void;
  closeOverlay: () => void;
  toggleOverlay: () => void;
}


// helper to replace a pane with a split in the tree
function replacePaneInTree(
  node: SplitNode,
  paneId: string,
  replacement: SplitNode
): SplitNode {
  if (node.type === "leaf") {
    return node.paneId === paneId ? replacement : node;
  }
  return {
    ...node,
    first: replacePaneInTree(node.first, paneId, replacement),
    second: replacePaneInTree(node.second, paneId, replacement),
  };
}

// helper to remove a pane from the tree
function removePaneFromTree(node: SplitNode, paneId: string): SplitNode | null {
  if (node.type === "leaf") {
    return node.paneId === paneId ? null : node;
  }
  const newFirst = removePaneFromTree(node.first, paneId);
  const newSecond = removePaneFromTree(node.second, paneId);

  if (!newFirst && !newSecond) return null;
  if (!newFirst) return newSecond;
  if (!newSecond) return newFirst;
  return { ...node, first: newFirst, second: newSecond };
}

let paneIdCounter = 0;
function generatePaneId(): string {
  return `pane-${++paneIdCounter}`;
}

export const useEditorStore = create<EditorStore>((set, get) => {
  const initialPane: EditorPane = {
    id: generatePaneId(),
    openPaths: [],
    activePath: null,
  };

  return {
    fileCache: new Map(),
    panes: [initialPane],
    activePaneId: initialPane.id,
    splitTree: { type: "leaf", paneId: initialPane.id },
    treeWorkspacePath: null,
    sidebarView: "files" as const,
    setSidebarView: (view) => set({ sidebarView: view }),
    searchPanelVisible: false,
    pendingReveal: null,
    toggleSearchPanel: () => set((s) => {
      const isSearch = s.sidebarView === "search";
      return {
        searchPanelVisible: !isSearch,
        sidebarView: isSearch ? "files" : "search",
      };
    }),
    setPendingReveal: (reveal) => set({ pendingReveal: reveal }),
    reviewsRevision: 0,
    notifyReviewsChanged: () => set((s) => ({ reviewsRevision: s.reviewsRevision + 1 })),
    editorConfig: loadEditorConfig(),
    updateEditorConfig: (partial) => set((s) => {
      const next = { ...s.editorConfig, ...partial };
      try { localStorage.setItem(EDITOR_CONFIG_KEY, JSON.stringify(next)); } catch {}
      return { editorConfig: next };
    }),

    openFile: (paneId, path, name, ext, content) => {
      const store = get();
      const pane = store.panes.find((p) => p.id === paneId);
      if (!pane) return;

      // add or update file cache
      const existing = store.fileCache.get(path);
      const fileData: FileData = existing
        ? { ...existing, content, savedContent: content, loading: false }
        : { path, name, ext, content, savedContent: content, loading: false, pinned: false };

      const newCache = new Map(store.fileCache);
      newCache.set(path, fileData);

      // update pane
      const newPanes = store.panes.map((p) => {
        if (p.id !== paneId) return p;
        if (p.openPaths.includes(path)) {
          // already open in this pane - just activate
          return { ...p, activePath: path };
        }
        // replace preview tab if exists, else add
        const previewIdx = p.openPaths.findIndex((fp) => {
          const fd = store.fileCache.get(fp);
          return fd && !fd.pinned;
        });
        const newOpenPaths = [...p.openPaths];
        if (previewIdx >= 0) {
          newOpenPaths[previewIdx] = path;
        } else {
          newOpenPaths.push(path);
        }
        return { ...p, openPaths: newOpenPaths, activePath: path };
      });

      set({ fileCache: newCache, panes: newPanes });
    },

    openDiffFile: (paneId, path, name, ext, modified, original) => {
      const store = get();
      const pane = store.panes.find((p) => p.id === paneId);
      if (!pane) return;

      const fileData: FileData = {
        path, name, ext,
        content: modified,
        savedContent: modified,
        loading: false,
        pinned: false,
        originalContent: original,
      };

      const newCache = new Map(store.fileCache);
      newCache.set(path, fileData);

      const newPanes = store.panes.map((p) => {
        if (p.id !== paneId) return p;
        if (p.openPaths.includes(path)) {
          return { ...p, activePath: path };
        }
        const previewIdx = p.openPaths.findIndex((fp) => {
          const fd = store.fileCache.get(fp);
          return fd && !fd.pinned;
        });
        const newOpenPaths = [...p.openPaths];
        if (previewIdx >= 0) {
          newOpenPaths[previewIdx] = path;
        } else {
          newOpenPaths.push(path);
        }
        return { ...p, openPaths: newOpenPaths, activePath: path };
      });

      set({ fileCache: newCache, panes: newPanes });
    },

    openView: (paneId, key, name, view) => {
      const store = get();
      const pane = store.panes.find((p) => p.id === paneId);
      if (!pane) return;

      // upsert the view tab (refreshes its payload if already open). pinned so
      // opening files never replaces it as a preview tab.
      const fileData: FileData = {
        path: key,
        name,
        ext: "",
        content: "",
        savedContent: "",
        loading: false,
        pinned: true,
        view,
      };
      const newCache = new Map(store.fileCache);
      newCache.set(key, fileData);

      const newPanes = store.panes.map((p) => {
        if (p.id !== paneId) return p;
        if (p.openPaths.includes(key)) return { ...p, activePath: key };
        return { ...p, openPaths: [...p.openPaths, key], activePath: key };
      });

      set({ fileCache: newCache, panes: newPanes });
    },

    closeFile: (paneId, path) => {
      const store = get();
      const pane = store.panes.find((p) => p.id === paneId);
      if (!pane) return;

      const newOpenPaths = pane.openPaths.filter((p) => p !== path);
      let newActivePath = pane.activePath;
      if (pane.activePath === path) {
        const idx = pane.openPaths.indexOf(path);
        newActivePath = newOpenPaths[Math.max(0, idx - 1)] ?? null;
      }

      const newPanes = store.panes.map((p) =>
        p.id === paneId ? { ...p, openPaths: newOpenPaths, activePath: newActivePath } : p
      );

      // evict from cache if no pane holds this file anymore
      const stillOpen = newPanes.some((p) => p.openPaths.includes(path));
      const newCache = stillOpen ? store.fileCache : (() => {
        const c = new Map(store.fileCache);
        c.delete(path);
        return c;
      })();

      // check if pane should be auto-closed (no files left and not the only pane)
      if (newOpenPaths.length === 0 && store.panes.length > 1) {
        set({ fileCache: newCache });
        get().closePane(paneId);
      } else {
        set({ panes: newPanes, fileCache: newCache });
      }
    },

    setActiveFile: (paneId, path) => {
      set((s) => ({
        panes: s.panes.map((p) => (p.id === paneId ? { ...p, activePath: path } : p)),
      }));
    },

    updateContent: (path, content) => {
      // editing auto-pins the file
      set((s) => {
        const newCache = new Map(s.fileCache);
        const existing = newCache.get(path);
        if (existing) {
          newCache.set(path, { ...existing, content, pinned: true });
        }
        return { fileCache: newCache };
      });
    },

    markSaved: (path, content) => {
      set((s) => {
        const newCache = new Map(s.fileCache);
        const existing = newCache.get(path);
        if (existing) {
          newCache.set(path, { ...existing, savedContent: content, content });
        }
        return { fileCache: newCache };
      });
    },

    setFileLoading: (path, loading) => {
      set((s) => {
        const newCache = new Map(s.fileCache);
        const existing = newCache.get(path);
        if (existing) {
          newCache.set(path, { ...existing, loading });
        }
        return { fileCache: newCache };
      });
    },

    pinFile: (path) => {
      set((s) => {
        const newCache = new Map(s.fileCache);
        const existing = newCache.get(path);
        if (existing) {
          newCache.set(path, { ...existing, pinned: true });
        }
        return { fileCache: newCache };
      });
    },

    reorderFiles: (paneId, fromIndex, toIndex) => {
      set((s) => ({
        panes: s.panes.map((p) => {
          if (p.id !== paneId) return p;
          const newPaths = [...p.openPaths];
          const [moved] = newPaths.splice(fromIndex, 1);
          newPaths.splice(toIndex, 0, moved);
          return { ...p, openPaths: newPaths };
        }),
      }));
    },

    splitRight: (paneId) => {
      const store = get();
      const currentPane = store.panes.find((p) => p.id === paneId);
      if (!currentPane) return;

      // create new pane with same file
      const newPane: EditorPane = {
        id: generatePaneId(),
        openPaths: [...currentPane.openPaths],
        activePath: currentPane.activePath,
      };

      const replacement: SplitNode = {
        type: "split",
        direction: "horizontal",
        first: { type: "leaf", paneId },
        second: { type: "leaf", paneId: newPane.id },
        sizePercent: 50,
      };

      set((s) => ({
        panes: [...s.panes, newPane],
        splitTree: replacePaneInTree(s.splitTree, paneId, replacement),
        activePaneId: newPane.id,
      }));
    },

    splitDown: (paneId) => {
      const store = get();
      const currentPane = store.panes.find((p) => p.id === paneId);
      if (!currentPane) return;

      const newPane: EditorPane = {
        id: generatePaneId(),
        openPaths: [...currentPane.openPaths],
        activePath: currentPane.activePath,
      };

      const replacement: SplitNode = {
        type: "split",
        direction: "vertical",
        first: { type: "leaf", paneId },
        second: { type: "leaf", paneId: newPane.id },
        sizePercent: 50,
      };

      set((s) => ({
        panes: [...s.panes, newPane],
        splitTree: replacePaneInTree(s.splitTree, paneId, replacement),
        activePaneId: newPane.id,
      }));
    },

    setActivePane: (paneId) => {
      set({ activePaneId: paneId });
    },

    closePane: (paneId) => {
      const store = get();
      if (store.panes.length === 1) return; // never close last pane

      const newTree = removePaneFromTree(store.splitTree, paneId);
      if (!newTree) return;

      const newPanes = store.panes.filter((p) => p.id !== paneId);
      const newActiveId =
        store.activePaneId === paneId ? newPanes[0].id : store.activePaneId;

      set({
        panes: newPanes,
        splitTree: newTree,
        activePaneId: newActiveId,
      });
    },

    setTreeWorkspacePath: (path) => set({ treeWorkspacePath: path }),

    // floating overlay
    isOverlayOpen: false,
    openOverlay: () => {
      try { localStorage.setItem(OVERLAY_OPEN_KEY, "true"); } catch {}
      set({ isOverlayOpen: true });
    },
    closeOverlay: () => {
      try { localStorage.setItem(OVERLAY_OPEN_KEY, "false"); } catch {}
      set({ isOverlayOpen: false });
    },
    toggleOverlay: () => {
      const next = !get().isOverlayOpen;
      try { localStorage.setItem(OVERLAY_OPEN_KEY, String(next)); } catch {}
      set({ isOverlayOpen: next });
    },
  };
});

// selectors
export function isDirty(file: FileData): boolean {
  return file.content !== file.savedContent;
}

// get pane data helper
export function usePane(paneId: string) {
  const panes = useEditorStore((s) => s.panes);
  const fileCache = useEditorStore((s) => s.fileCache);
  const pane = panes.find((p) => p.id === paneId);

  if (!pane) return { pane: null, openFiles: [], activeFile: null };

  const openFiles = pane.openPaths
    .map((path) => fileCache.get(path))
    .filter((f): f is FileData => f !== undefined);

  const activeFile = pane.activePath ? fileCache.get(pane.activePath) ?? null : null;

  return { pane, openFiles, activeFile };
}
