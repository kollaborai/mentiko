import { NextRequest } from "next/server";
import { rename, stat } from "fs/promises";
import { checkAuth } from "@/lib/auth/api-auth";
import { resolveAndValidate, getAllowedRoots } from "@/lib/system/path-validation";
import { BadRequest, Conflict, Forbidden, NotFound, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const body = await request.json();
  const { oldPath, newPath } = body;

  if (!oldPath || typeof oldPath !== "string") {
    throw new BadRequest("oldPath is required", { field: "oldPath" });
  }

  if (!newPath || typeof newPath !== "string") {
    throw new BadRequest("newPath is required", { field: "newPath" });
  }

  const allowedRoots = await getAllowedRoots(request);

  const validatedOld = resolveAndValidate(oldPath, allowedRoots);
  if (!validatedOld) {
    throw new Forbidden("Source path not within any registered workspace");
  }

  const validatedNew = resolveAndValidate(newPath, allowedRoots);
  if (!validatedNew) {
    throw new Forbidden("Destination path not within any registered workspace");
  }

  try {
    await stat(validatedOld);
  } catch {
    throw new NotFound("Source path", oldPath);
  }

  // Check if destination already exists
  try {
    await stat(validatedNew);
    // If stat succeeds, the file exists -- conflict
    throw new Conflict("Destination path already exists", { path: validatedNew });
  } catch (e: unknown) {
    // Re-throw our own Conflict error
    if (e instanceof Conflict) {
      throw e;
    }
    // ENOENT means file doesn't exist -- that's what we want
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code !== "ENOENT") {
      throw e; // unexpected error, re-throw
    }
    // ENOENT: destination doesn't exist, safe to proceed
  }

  await rename(validatedOld, validatedNew);
  return apiSuccess({ success: true, path: validatedNew });
});
