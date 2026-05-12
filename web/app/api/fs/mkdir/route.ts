import { NextRequest } from "next/server";
import { mkdirSync, existsSync } from "fs";
import { join } from "path";
import os from "os";
import { checkAuth } from "@/lib/api-auth";
import { resolveAndValidate, getAllowedRoots } from "@/lib/path-validation";
import { BadRequest, Conflict, Forbidden, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { parent, name } = await request.json();

  if (!parent || !name) {
    throw new BadRequest("parent and name required", { fields: ["parent", "name"] });
  }
  if (name.includes("/") || name.includes("..")) {
    throw new BadRequest("invalid folder name", { field: "name" });
  }

  const expanded = parent.startsWith("~") ? join(os.homedir(), parent.slice(1)) : parent;
  const validated = resolveAndValidate(expanded, await getAllowedRoots(request));
  if (!validated) {
    throw new Forbidden("Parent path not within any registered workspace");
  }

  const target = join(validated, name);

  if (existsSync(target)) {
    throw new Conflict("folder already exists", { path: target });
  }

  mkdirSync(target, { recursive: true });
  return apiSuccess({ path: target });
});
