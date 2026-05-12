import { NextResponse } from "next/server";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { requireOpsAuth } from "@/lib/mentiko-mcp-ops-auth";
import { listWorkspaces } from "@/lib/workspace-storage";
import { resolveAndValidate } from "@/lib/path-validation";

export const dynamic = "force-dynamic";

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build",
  "__pycache__", ".cache", ".turbo", "coverage",
  ".claude", ".vscode",
]);

const MAX_TREE_DEPTH = 6;
const MAX_FIND_DEPTH = 8;
const MAX_FIND_RESULTS = 200;

interface TreeEntry {
  name: string;
  type: "dir" | "file";
  path: string;
  children?: TreeEntry[];
}

/**
 * GET /api/mentiko-mcp/ops/fs?action=list_dir&path=...
 * GET /api/mentiko-mcp/ops/fs?action=tree&path=...&depth=2
 * GET /api/mentiko-mcp/ops/fs?action=find_files&path=...&pattern=...&maxResults=20
 */
export async function GET(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  const { namespaceId, orgId } = ctx;
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action") || "list_dir";
  const rawPath = searchParams.get("path") || "";

  // derive allowed roots from workspace paths
  const workspaces = listWorkspaces(namespaceId, orgId);
  const allowedRoots = workspaces
    .map((workspace) => workspace.path)
    .filter((path): path is string => typeof path === "string" && path.length > 0);
  if (allowedRoots.length === 0) {
    return new NextResponse("No registered workspace roots", { status: 403 });
  }

  // resolve path against first workspace root if relative
  const requestedPath = rawPath.startsWith("/") ? rawPath : join(allowedRoots[0], rawPath || ".");
  const absPath = resolveAndValidate(requestedPath, allowedRoots);
  if (!absPath) {
    return new NextResponse(`Path outside allowed roots: ${absPath}`, { status: 403 });
  }

  if (!existsSync(absPath)) {
    return new NextResponse(`Path not found: ${absPath}`, { status: 404 });
  }

  if (action === "list_dir") {
    const entries = readdirSync(absPath, { withFileTypes: true, encoding: "utf8" })
      .filter((e) => !SKIP_DIRS.has(e.name))
      .map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "dir" : "file",
        path: join(absPath, e.name),
      }));
    return NextResponse.json({ path: absPath, entries });
  }

  if (action === "tree") {
    const requestedDepth = parseInt(searchParams.get("depth") || "2", 10);
    const maxDepth = Math.min(Math.max(requestedDepth, 0), MAX_TREE_DEPTH);
    function buildTree(dir: string, depth: number): TreeEntry[] {
      if (depth <= 0) return [];
      return readdirSync(dir, { withFileTypes: true })
        .filter((e) => !SKIP_DIRS.has(e.name))
        .map((e) => {
          const full = join(dir, e.name);
          return {
            name: e.name,
            type: e.isDirectory() ? "dir" : "file",
            path: full,
            children: e.isDirectory() ? buildTree(full, depth - 1) : undefined,
          };
        });
    }
    return NextResponse.json({ path: absPath, tree: buildTree(absPath, maxDepth) });
  }

  if (action === "find_files") {
    const pattern = searchParams.get("pattern") || "";
    const requestedMaxResults = parseInt(searchParams.get("maxResults") || "20", 10);
    const maxResults = Math.min(Math.max(requestedMaxResults, 1), MAX_FIND_RESULTS);
    const matches: string[] = [];

    function walk(dir: string, depth: number) {
      if (matches.length >= maxResults || depth < 0) return;
      let dirEntries: { name: string; isDirectory: () => boolean }[];
      try {
        dirEntries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" });
      } catch { return; }
      for (const e of dirEntries) {
        if (SKIP_DIRS.has(e.name)) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          walk(full, depth - 1);
        } else if (!pattern || e.name.includes(pattern) || full.includes(pattern)) {
          matches.push(full);
          if (matches.length >= maxResults) return;
        }
      }
    }
    walk(absPath, MAX_FIND_DEPTH);
    return NextResponse.json({ matches, truncated: matches.length >= maxResults });
  }

  return new NextResponse("Unknown action", { status: 400 });
}
