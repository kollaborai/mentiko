import {
  migrateEditorState,
  type EditorState,
} from "@/app/docs/ui-editor/editor-model";

export const TASK_SIDEBAR_STORAGE_KEY =
  "mentiko:docs:ui-editor:task-sidebar:v5";
export const TASK_SIDEBAR_EDITOR_UPDATED_EVENT =
  "mentiko:task-sidebar-editor-updated";

export function readTaskSidebarEditorState(): EditorState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TASK_SIDEBAR_STORAGE_KEY);
    return raw ? migrateEditorState(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
