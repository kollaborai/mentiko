import { readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";

interface WorkspaceHandoff {
  agentId?: unknown;
  workspacePath?: unknown;
  nodeWorkspacePath?: unknown;
  observed?: {
    sourceWorkspacePath?: unknown;
  };
}

function readWorkspaceHandoff(path: string): WorkspaceHandoff | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return typeof parsed === "object" && parsed !== null
      ? (parsed as WorkspaceHandoff)
      : null;
  } catch {
    return null;
  }
}

function isWithin(parent: string, candidate: string): boolean {
  return candidate === parent || candidate.startsWith(`${parent}${sep}`);
}

function unique(paths: string[]): string[] {
  return [...new Set(paths)];
}

/**
 * Resolve the source workspace and any per-agent isolated worktree recorded
 * in the run handoff artifact. Agent transcripts are keyed by the actual CLI
 * cwd, so the source workspace alone is insufficient for isolated launches.
 */
export function resolveAgentWorkspacePaths(
  artifactsDir: string,
  agentId: string,
  sourceWorkspacePath?: string,
): string[] {
  const runDir = resolve(artifactsDir, "..");
  const worktreeRoot = join(runDir, ".internal", "workspace-isolation", "worktrees");
  const sourceWorkspace = sourceWorkspacePath && isAbsolute(sourceWorkspacePath)
    ? resolve(sourceWorkspacePath)
    : "";
  const candidates: string[] = [];

  if (sourceWorkspace) candidates.push(sourceWorkspace);

  try {
    for (const name of readdirSync(artifactsDir)) {
      if (!name.endsWith(".json") || !name.includes("workspace-start")) continue;
      const handoff = readWorkspaceHandoff(join(artifactsDir, name));
      if (!handoff) continue;
      if (typeof handoff.agentId === "string" && handoff.agentId !== agentId) continue;

      const recorded = [
        handoff.workspacePath,
        handoff.nodeWorkspacePath,
        handoff.observed?.sourceWorkspacePath,
      ].filter((value): value is string => typeof value === "string" && isAbsolute(value));
      candidates.push(...recorded.map((path) => resolve(path)));
    }
  } catch {
    // A missing or unreadable handoff must not prevent the source workspace
    // fallback from being searched.
  }

  // Completed runs can clean up the worktree after the provider has already
  // left its transcript under the cwd-derived log directory. Keep the
  // recorded path even when the workspace itself is gone; resolveLogDir is
  // responsible for requiring the actual provider log directory to exist.
  return unique(candidates).filter(
    (path) => path === sourceWorkspace || isWithin(worktreeRoot, path),
  );
}
