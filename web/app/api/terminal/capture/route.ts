/**
 * GET /api/terminal/capture?session=<name>&lines=200
 *
 * captures rendered screen output from a pty-manager session.
 */

import { NextRequest } from "next/server";
import { execFileSync } from "node:child_process";
import { join } from "path";
import config from "@/lib/config";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import { canAccessSession } from "@/lib/pty/session-owners";
import { BadRequest, Forbidden, InternalServerError, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

const SESSION_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9\-_]{0,99}$/;

export const GET = withErrorHandling(async (req: NextRequest) => {
  const user = await getSessionUser(req);
  if (!user) {
    throw new Unauthorized();
  }

  const session = req.nextUrl.searchParams.get("session");
  const linesRaw = req.nextUrl.searchParams.get("lines") || "200";

  if (!session || !SESSION_NAME_RE.test(session)) {
    throw new BadRequest("invalid session", { field: "session" });
  }

  // a session's captured screen contains its secrets/output — owner only
  if (!canAccessSession(session, user.id)) {
    throw new Forbidden("not your session");
  }

  const lines = String(Math.min(Math.max(parseInt(linesRaw, 10) || 200, 1), 10000));

  try {
    const scriptPath = join(config.binDir, "p");
    const output = execFileSync(scriptPath, ["capture", session, lines], {
      cwd: config.root,
      stdio: "pipe",
    }).toString();

    return apiSuccess({ session, output });
  } catch {
    throw new InternalServerError("capture failed");
  }
});
