// Pure task lifecycle vocabulary shared by server stores and client task views.
// Keep this separate from task-store.ts so client components never pull the
// better-sqlite3 native addon into their bundle.

export const TERMINAL_TASK_STATUSES = [
  "closed",
  "resolved",
  "done",
  "complete",
] as const;

const terminalTaskStatusSet = new Set<string>(TERMINAL_TASK_STATUSES);

export function isTerminalTaskStatus(status: string | null | undefined): boolean {
  return !!status && terminalTaskStatusSet.has(status);
}
