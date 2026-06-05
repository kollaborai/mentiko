import { NextRequest } from "next/server";
import { execSync } from "child_process";
import { checkAuth } from "@/lib/auth/api-auth";
import { resolveAndValidate, getAllowedRoots } from "@/lib/system/path-validation";
import { BadRequest, Forbidden, InternalServerError, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

function parseStatusCode(raw: string): string {
  const x = raw[0];
  const y = raw[1];

  if (x === "?" && y === "?") return "?";
  if (x === "R" || y === "R") return "R";
  if (x === "A" || y === "A") return "A";
  if (x === "D" || y === "D") return "D";
  if (x === "M" || y === "M") return "M";

  return x.trim() || y.trim() || "M";
}

function parseGitStatus(output: string): Record<string, string> {
  const status: Record<string, string> = {};
  if (!output.trim()) return status;

  for (const line of output.split("\n")) {
    if (!line || line.length < 4) continue;

    const xy = line.slice(0, 2);
    let filePath = line.slice(3);

    if (xy[0] === "R" || xy[1] === "R") {
      const arrowIdx = filePath.indexOf(" -> ");
      if (arrowIdx !== -1) {
        filePath = filePath.slice(arrowIdx + 4);
      }
    }

    status[filePath] = parseStatusCode(xy);
  }

  return status;
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

  try {
    const output = execSync("git status --porcelain", {
      cwd: validated,
      encoding: "utf-8",
      timeout: 30000,
    });

    const status = parseGitStatus(output);
    return apiSuccess({ status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes("not a git repository")) {
      return apiSuccess({ error: "Not a git repository", status: {} });
    }

    throw new InternalServerError("Failed to get git status", { detail: message });
  }
});
