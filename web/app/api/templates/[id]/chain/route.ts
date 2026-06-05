import { NextRequest } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import config from "@/lib/config";
import { checkAuth } from "@/lib/auth/api-auth";
import { Unauthorized, BadRequest, NotFound } from "@/lib/api-errors";
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

  let chainPath: string;
  if (parts[0] === "community" && parts.length >= 3) {
    // community/chains/{slug} -> ~/.mentiko/marketplace/chains/{slug}/chain.json
    const subPath = parts.slice(1).join("/");
    chainPath = join(config.globalRoot, "marketplace", subPath, "chain.json");
  } else {
    const [source, dirName] = parts;
    const sourceDir = source === "examples"
      ? join(config.root, "examples")
      : join(config.root, "templates");
    chainPath = join(sourceDir, dirName, "chain.json");
  }

  if (!existsSync(chainPath)) {
    throw new NotFound("Template", id);
  }

  const chain = JSON.parse(readFileSync(chainPath, "utf-8"));

  return apiSuccess({ chain });
});
