import { NextResponse } from "next/server";
import { requireOpsAuth } from "@/lib/ai-engine/mentiko-mcp-ops-auth";
import { listWorkspaces } from "@/lib/workspaces/workspace-storage";

export const dynamic = "force-dynamic";

/**
 * GET /api/mentiko-mcp/ops/context/workspace
 *
 * Returns the active workspace. The bar stores the selected workspace ID
 * in localStorage ("mentiko-workspace") — we can't read that from the server.
 * Instead we return all workspaces and flag the first/only one as active.
 * The MCP inbox also receives select_workspace effects, so a future
 * improvement could persist the last-selected ID on the server side.
 */
export async function GET(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  const { namespaceId, orgId } = ctx;
  const workspaces = listWorkspaces(namespaceId, orgId);

  if (workspaces.length === 0) {
    return NextResponse.json({ workspace: null, note: "No workspaces configured." });
  }

  // Return the first workspace as a best-guess active workspace.
  // The bar's select_workspace effect updates the inbox; a persistent
  // "last selected" store would make this accurate — tracked as future work.
  const ws = workspaces[0];
  return NextResponse.json({
    workspace: {
      id: ws.id,
      name: ws.name,
      path: ws.path,
      type: ws.execution?.type || "local",
    },
    note: workspaces.length > 1
      ? `${workspaces.length} workspaces available; returning first. Use list_workspaces + select_workspace for full control.`
      : undefined,
  });
}
