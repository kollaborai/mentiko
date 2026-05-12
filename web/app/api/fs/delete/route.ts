import { NextRequest } from "next/server";
import { unlink, rmdir, rm, stat, readdir } from "fs/promises";
import { resolve } from "path";
import { checkAuth } from "@/lib/api-auth";
import { resolveAndValidate, getAllowedRoots } from "@/lib/path-validation";
import { BadRequest, Forbidden, NotFound, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const body = await request.json();
  const { path: targetPath, force } = body as { path?: string; force?: boolean };

  if (!targetPath || typeof targetPath !== "string") {
    throw new BadRequest("path is required", { field: "path" });
  }

  const allowedRoots = await getAllowedRoots(request);
  const validated = resolveAndValidate(targetPath, allowedRoots);

  if (!validated) {
    throw new Forbidden("Path not within any registered workspace");
  }

  for (const root of allowedRoots) {
    const resolvedRoot = resolve(root);
    if (validated === resolvedRoot) {
      throw new Forbidden("Cannot delete a workspace root");
    }
  }

  let fileStat;
  try {
    fileStat = await stat(validated);
  } catch {
    throw new NotFound("File", targetPath);
  }

  if (fileStat.isDirectory()) {
    const entries = await readdir(validated);
    if (entries.length > 0) {
      if (!force) {
        throw new BadRequest("Directory is not empty. Remove contents first.");
      }
      await rm(validated, { recursive: true, force: true });
    } else {
      await rmdir(validated);
    }
  } else {
    await unlink(validated);
  }

  return apiSuccess({ success: true });
});
