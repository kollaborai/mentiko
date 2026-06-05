import { resolve } from "path";
import { homedir } from "os";
import { NextRequest } from "next/server";
import { config } from "@/lib/config";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { listWorkspaces } from "@/lib/workspaces/workspace-storage";

/**
 * Resolve a raw path and validate it falls under one of the allowed roots.
 * Returns the resolved absolute path, or null if the path is outside all roots.
 */
export function resolveAndValidate(
  rawPath: string,
  allowedRoots: string[]
): string | null {
  const resolved = resolve(rawPath);
  for (const root of allowedRoots) {
    const resolvedRoot = resolve(root);
    if (resolved === resolvedRoot || resolved.startsWith(resolvedRoot + "/")) {
      return resolved;
    }
  }
  return null;
}

export function getWorkspaceAllowedRoots(namespaceId: string, orgId: string): string[] {
  return listWorkspaces(namespaceId, orgId)
    .map((workspace) => workspace.path)
    .filter((path): path is string => typeof path === "string" && path.length > 0);
}

/**
 * Build the list of filesystem roots the caller is allowed to access.
 *
 * Default (restricted): only workspace paths registered for the org.
 * Broad mode (opt-in):  also includes config.root, config.workspaceDir,
 *                        and the user's home directory -- needed for
 *                        onboarding folder browser before any workspaces
 *                        are registered.
 *
 * Self-hosters who need the old behavior set:
 *   MENTIKO_FS_ALLOW_BROAD_ROOTS=true
 */
export async function getAllowedRoots(request: NextRequest): Promise<string[]> {
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const workspaceRoots = getWorkspaceAllowedRoots(namespaceId, orgId);

  // always include homedir + workspaceDir for onboarding folder browser
  // (users need to browse before any workspaces are registered)
  return [config.root, config.workspaceDir, homedir(), ...workspaceRoots];
}
