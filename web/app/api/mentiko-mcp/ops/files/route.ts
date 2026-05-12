import { NextResponse, NextRequest } from "next/server";
import { readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { resolveAndValidate, getWorkspaceAllowedRoots } from "@/lib/path-validation";
import { requireOpsAuth, requireOpsPermission } from "@/lib/mentiko-mcp-ops-auth";

/**
 * /api/mentiko-mcp/ops/files
 *
 * GET  ?path=...                 read file content
 * POST {path, content, mode?}    write file content
 *
 * Auth: JWT bearer. Path sandboxed via the same workspace-root check the
 * public /api/fs/file endpoint uses.
 */

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 2 * 1024 * 1024;

export async function GET(req: NextRequest) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  const filePath = req.nextUrl.searchParams.get("path");
  if (!filePath) return new NextResponse("Missing path", { status: 400 });

  const validated = resolveAndValidate(filePath, getWorkspaceAllowedRoots(ctx.namespaceId, ctx.orgId));
  if (!validated) return new NextResponse("Path not in workspace", { status: 403 });
  if (!existsSync(validated)) return new NextResponse("Not found", { status: 404 });

  const stat = statSync(validated);
  if (!stat.isFile()) return new NextResponse("Not a file", { status: 400 });
  if (stat.size > MAX_FILE_SIZE) {
    return new NextResponse("File too large", { status: 413 });
  }

  const content = readFileSync(validated, "utf-8");
  return NextResponse.json({ path: validated, content, size: stat.size });
}

export async function POST(req: NextRequest) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_chains", "files:write");
  if (perm) return perm;

  const { path, content, mode } = (await req.json()) as {
    path?: string;
    content?: string;
    mode?: "create" | "overwrite";
  };
  if (!path || content === undefined) {
    return new NextResponse("path and content required", { status: 400 });
  }

  const validated = resolveAndValidate(path, getWorkspaceAllowedRoots(ctx.namespaceId, ctx.orgId));
  if (!validated) return new NextResponse("Path not in workspace", { status: 403 });

  if (mode === "create" && existsSync(validated)) {
    return new NextResponse("File already exists", { status: 409 });
  }

  writeFileSync(validated, content, "utf-8");
  return NextResponse.json({ path: validated, bytes: Buffer.byteLength(content) });
}
