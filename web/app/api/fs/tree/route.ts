import { NextRequest } from "next/server";
import { readdirSync } from "fs";
import { join } from "path";
import { checkAuth } from "@/lib/api-auth";
import { resolveAndValidate, getAllowedRoots } from "@/lib/path-validation";
import { BadRequest, Forbidden, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

const ALLOWED_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".jsonl", ".yaml", ".yml",
  ".sh", ".bash", ".zsh",
  ".md", ".mdx", ".txt",
  ".css", ".scss",
  ".env", ".env.example", ".env.local",
  ".py", ".go", ".rs", ".rb",
  ".html", ".svg", ".xml",
  ".toml", ".ini", ".conf",
  ".graphql", ".gql",
  ".sql",
  ".dockerfile",
]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build",
  "__pycache__", ".cache", ".turbo", "coverage",
  ".claude", ".vscode",
]);

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: FileNode[];
  ext?: string;
}

function getExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot === -1 || dot === 0) return "";
  return name.slice(dot);
}

function buildTree(dir: string, depth: number = 0): FileNode[] {
  if (depth > 8) return [];

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: FileNode[] = [];

  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIP_DIRS.has(e.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  const files = entries
    .filter((e) => e.isFile() && !e.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const d of dirs) {
    const fullPath = join(dir, d.name);
    const children = buildTree(fullPath, depth + 1);
    nodes.push({
      name: d.name,
      path: fullPath,
      type: "dir",
      children,
    });
  }

  for (const f of files) {
    const ext = getExtension(f.name);
    if (ext && !ALLOWED_EXTENSIONS.has(ext)) continue;
    nodes.push({
      name: f.name,
      path: join(dir, f.name),
      type: "file",
      ext,
    });
  }

  return nodes;
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const workspacePath = request.nextUrl.searchParams.get("workspace");
  if (!workspacePath) {
    throw new BadRequest("workspace param required", { field: "workspace" });
  }

  const validated = resolveAndValidate(workspacePath, await getAllowedRoots(request));

  if (!validated) {
    throw new Forbidden("Path not within any registered workspace");
  }

  const tree = buildTree(validated);
  return apiSuccess({ path: validated, tree });
});
