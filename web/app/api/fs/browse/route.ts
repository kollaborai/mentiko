import { NextRequest } from "next/server";
import { readdirSync, statSync, existsSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { config } from "@/lib/config";
import { checkAuth } from "@/lib/api-auth";
import { resolveAndValidate, getAllowedRoots } from "@/lib/path-validation";
import { Forbidden, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

const getDefaultDir = () => {
  if (existsSync(config.workspaceDir)) return config.workspaceDir;
  return homedir();
};

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const raw = request.nextUrl.searchParams.get("path") || getDefaultDir();
  const expanded = raw.startsWith("~") ? join(process.env.HOME || process.env.USERPROFILE || "", raw.slice(1)) : raw;
  const validated = resolveAndValidate(expanded, await getAllowedRoots(request));
  if (!validated) {
    throw new Forbidden("Path not within any registered workspace");
  }
  const dir = validated;

  const entries = readdirSync(dir, { withFileTypes: true });
  const VISIBLE_DOTDIRS = new Set([".claude"]);
  const dirs = entries
    .filter((e) => {
      if (!e.isDirectory()) return false;
      if (e.name.startsWith(".") && !VISIBLE_DOTDIRS.has(e.name)) return false;
      try {
        statSync(join(dir, e.name));
        return true;
      } catch {
        return false;
      }
    })
    .map((e) => {
      const st = statSync(join(dir, e.name));
      return { name: e.name, mtime: st.mtimeMs };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return apiSuccess({
    path: dir,
    parent: dirname(dir) !== dir ? dirname(dir) : null,
    dirs,
  });
});
