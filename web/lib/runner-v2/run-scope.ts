import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export function projectRunsRootFor(runJsonPath: string): string {
  const runDir = dirname(resolve(runJsonPath));
  const parent = dirname(runDir);
  return basename(parent) === "runs" || basename(runDir).startsWith("run-")
    ? parent
    : runDir;
}

/**
 * Enumerate only the supported org/project run layouts. This intentionally is
 * not a recursive filesystem walk: the org root can contain workspaces and
 * other user-owned data that a capacity/recovery scan must never traverse.
 */
export function discoverScopedRunJsonPaths(
  scopeRoot: string,
  explicitRunJsonPath?: string,
): string[] {
  const paths = new Set<string>();
  if (explicitRunJsonPath && existsSync(explicitRunJsonPath)) {
    paths.add(resolve(explicitRunJsonPath));
  }

  const root = resolve(scopeRoot);
  if (basename(root) === "runs") addRunsDirectory(paths, root);
  addRunsDirectory(paths, root);
  addRunsDirectory(paths, join(root, "runs"));

  const projectsRoot = join(root, "projects");
  if (existsSync(projectsRoot)) {
    for (const entry of readdirSync(projectsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      addRunsDirectory(paths, join(projectsRoot, entry.name, "runs"));
    }
  }

  return [...paths].sort();
}

function addRunsDirectory(paths: Set<string>, runsDir: string): void {
  if (!existsSync(runsDir)) return;
  for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("run-")) continue;
    const runJsonPath = join(runsDir, entry.name, "run.json");
    if (existsSync(runJsonPath)) paths.add(resolve(runJsonPath));
  }
}
