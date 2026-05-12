import { NextRequest } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import config from "@/lib/config";
import { checkAuth } from "@/lib/api-auth";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

interface Context {
  params: Promise<{ id: string }>;
}

export const GET = withErrorHandling(async (request: NextRequest, context: Context) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { id } = await context.params;
  const parts = decodeURIComponent(id).split("/");

  if (parts.length < 2) {
    throw new BadRequest("Invalid template id");
  }

  let readmePath: string;
  if (parts[0] === "community" && parts.length >= 3) {
    const subPath = parts.slice(1).join("/");
    readmePath = join(config.globalRoot, "marketplace", subPath, "README.md");
  } else {
    const [source, dirName] = parts;
    const sourceDir = source === "examples"
      ? join(config.root, "examples")
      : join(config.root, "templates");
    readmePath = join(sourceDir, dirName, "README.md");
  }

  if (!existsSync(readmePath)) {
    return apiSuccess({ readme: "" });
  }

  const readme = readFileSync(readmePath, "utf-8");

  return apiSuccess({ readme });
});
