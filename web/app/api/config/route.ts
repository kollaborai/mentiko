import { NextRequest } from "next/server";
import { existsSync, mkdirSync } from "fs";
import { config } from "@/lib/config";
import { checkAuth } from "@/lib/auth/api-auth";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  // On tenant VPS (NAMESPACES_BASE is set), the code editor should browse
  // the user workspace dir, not the app installation directory.
  // In local dev, browse the project root as before.
  const hasExternalNamespaces = !!process.env.NAMESPACES_BASE;
  const editorRoot = hasExternalNamespaces ? config.workspaceDir : config.root;
  const workspacesDir = process.env.WORKSPACES_DIR || config.workspaceDir;

  // ensure the workspace dir exists so onboarding folder defaults don't error
  if (!existsSync(workspacesDir)) {
    try { mkdirSync(workspacesDir, { recursive: true }); } catch { /* ignore */ }
  }

  return apiSuccess({
    root: editorRoot,
    workspacesDir,
  });
});
