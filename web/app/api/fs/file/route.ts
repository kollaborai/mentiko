import { NextRequest } from "next/server";
import { readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { checkAuth } from "@/lib/api-auth";
import { resolveAndValidate, getAllowedRoots } from "@/lib/path-validation";
import { BadRequest, Forbidden, NotFound, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 2 * 1024 * 1024;

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const filePath = request.nextUrl.searchParams.get("path");
  if (!filePath) {
    throw new BadRequest("path param required", { field: "path" });
  }

  const validated = resolveAndValidate(filePath, await getAllowedRoots(request));
  if (!validated) {
    throw new Forbidden("Path not within any registered workspace");
  }

  if (!existsSync(validated)) {
    throw new NotFound("File", filePath);
  }

  const stat = statSync(validated);
  if (!stat.isFile()) {
    throw new BadRequest("Not a file");
  }

  if (stat.size > MAX_FILE_SIZE) {
    throw new BadRequest("File too large (max 2MB)");
  }

  const content = readFileSync(validated, "utf-8");
  return apiSuccess({ path: validated, content, size: stat.size });
});

export const PUT = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const filePath = request.nextUrl.searchParams.get("path");
  if (!filePath) {
    throw new BadRequest("path param required", { field: "path" });
  }

  const validated = resolveAndValidate(filePath, await getAllowedRoots(request));
  if (!validated) {
    throw new Forbidden("Path not within any registered workspace");
  }

  const body = await request.json();

  if (typeof body.content !== "string") {
    throw new BadRequest("content must be a string", { field: "content" });
  }

  if (body.content.length > MAX_FILE_SIZE) {
    throw new BadRequest("Content too large (max 2MB)");
  }

  writeFileSync(validated, body.content, "utf-8");
  return apiSuccess({ success: true, path: validated });
});
