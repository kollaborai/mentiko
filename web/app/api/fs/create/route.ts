import { NextRequest } from "next/server";
import { mkdir, writeFile, stat } from "fs/promises";
import { dirname } from "path";
import { checkAuth } from "@/lib/auth/api-auth";
import { resolveAndValidate, getAllowedRoots } from "@/lib/system/path-validation";
import { BadRequest, Conflict, Forbidden, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const body = await request.json();
  const { path: targetPath, type } = body;

  if (!targetPath || typeof targetPath !== "string") {
    throw new BadRequest("path is required", { field: "path" });
  }

  if (type !== "file" && type !== "dir") {
    throw new BadRequest("type must be \"file\" or \"dir\"", { field: "type" });
  }

  const validated = resolveAndValidate(targetPath, await getAllowedRoots(request));
  if (!validated) {
    throw new Forbidden("Path not within any registered workspace");
  }

  try {
    await stat(validated);
    throw new Conflict("Path already exists", { path: validated });
  } catch {
    if (type === "dir") {
      await mkdir(validated, { recursive: true });
    } else {
      await mkdir(dirname(validated), { recursive: true });
      await writeFile(validated, "", "utf-8");
    }
  }

  return apiSuccess({ success: true, path: validated });
});
