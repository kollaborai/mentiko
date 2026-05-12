import { NextRequest } from "next/server";
import { execSync } from "child_process";
import { checkAuth } from "@/lib/api-auth";
import { resolveAndValidate, getAllowedRoots } from "@/lib/path-validation";
import { BadRequest, Forbidden, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build",
  "__pycache__", ".cache", ".turbo", "coverage",
  ".claude", ".vscode", ".gitlab",
]);

export interface SearchResult {
  path: string;
  name: string;
  line: number;
  column: number;
  text: string;
  context: string;
}

function escapeGrepPattern(s: string): string {
  return s.replace(/([.*+?^${}()|[\]\\])/g, "\\$1");
}

function buildExcludeArgs(): string[] {
  const exclude: string[] = [];
  for (const dir of SKIP_DIRS) {
    exclude.push("--exclude-dir", dir);
  }
  const binaryExts = [
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".webp",
    ".woff", ".woff2", ".ttf", ".eot",
    ".zip", ".tar", ".gz", ".bz2", ".xz",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx",
    ".mp4", ".mp3", ".mov", ".avi",
    ".pyc", ".so", ".dylib", ".dll", ".exe",
  ];
  for (const ext of binaryExts) {
    exclude.push("--exclude", `*${ext}`);
  }
  return exclude;
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const workspacePath = request.nextUrl.searchParams.get("workspace");
  const query = request.nextUrl.searchParams.get("query");
  const regexParam = request.nextUrl.searchParams.get("regex");

  if (!workspacePath) {
    throw new BadRequest("workspace param required", { field: "workspace" });
  }
  if (!query) {
    throw new BadRequest("query param required", { field: "query" });
  }
  if (query.length < 2) {
    throw new BadRequest("query too short (min 2 chars)");
  }

  const validated = resolveAndValidate(workspacePath, await getAllowedRoots(request));

  if (!validated) {
    throw new Forbidden("Path not within any registered workspace");
  }

  const useRegex = regexParam === "true";
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const maxResults = 500;

  if (useRegex) {
    // length cap — long patterns are slow regardless of structure
    if (query.length > 200) {
      throw new BadRequest("regex pattern too long (max 200 chars)");
    }

    // reject obvious catastrophic-backtracking shapes:
    //   - nested quantifiers: (a+)+, (a*)+, (a+)*, (a*)*
    //   - repeated alternation inside quantifier: (a|a)+, (ab|cd)+
    // these produce exponential matching time on near-miss input.
    const nestedQuantifier = /(\([^)]*[+*][^)]*\))[+*]/;
    const alternationInQuantifier = /\([^)]*\|[^)]*\)[+*]/;
    if (nestedQuantifier.test(query) || alternationInQuantifier.test(query)) {
      throw new BadRequest("regex pattern contains structures prone to catastrophic backtracking");
    }

    // compile-check: if JS can't parse it, grep probably can't either.
    // catches typos early and gives a clean error instead of grep's stderr.
    try {
      new RegExp(query);
    } catch (e) {
      throw new BadRequest(`invalid regex: ${(e as Error).message}`);
    }
  }

  const args = buildExcludeArgs();
  const rawPattern = useRegex ? query : escapeGrepPattern(query);
  const safePattern = "'" + rawPattern.replace(/'/g, "'\\''") + "'";
  const cmd = `cd "${validated}" && grep -r -n --color=never ${args.join(" ")} -e ${safePattern} . 2>/dev/null | head -n ${maxResults}`;

  try {
    const output = execSync(cmd, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      stdio: "pipe",
    });

    for (const line of output.split("\n")) {
      if (!line.trim()) continue;

      const lastColonIdx = line.lastIndexOf(":");
      const secondLastColonIdx = line.lastIndexOf(":", lastColonIdx - 1);

      if (lastColonIdx === -1 || secondLastColonIdx === -1) continue;

      const filePath = line.slice(0, secondLastColonIdx);
      if (filePath.includes("Binary")) continue;

      const lineNumStr = line.slice(secondLastColonIdx + 1, lastColonIdx);
      const content = line.slice(lastColonIdx + 1);

      const lineNum = parseInt(lineNumStr, 10);
      if (isNaN(lineNum)) continue;

      const key = `${filePath}:${lineNum}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const relativePath = filePath.startsWith(validated + "/")
        ? filePath.slice(validated.length + 1)
        : filePath;

      results.push({
        path: relativePath,
        name: filePath.split("/").pop() || filePath,
        line: lineNum,
        column: 1,
        text: content.trim(),
        context: "",
      });

      if (results.length >= maxResults) break;
    }
  } catch (err) {
    const errStr = String(err);
    if (!errStr.includes("returned non-zero")) {
      console.error("search error:", err);
    }
  }

  return apiSuccess({ results });
});
