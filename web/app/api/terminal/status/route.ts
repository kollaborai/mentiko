/**
 * GET /api/terminal/status
 *
 * returns list of active pty-manager sessions for the ui to poll.
 */

import { NextRequest } from "next/server";
import { execFileSync } from "node:child_process";
import { join } from "path";
import config from "@/lib/config";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import { filterAccessibleSessions } from "@/lib/pty/session-owners";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (_req: NextRequest) => {
  const user = await getSessionUser(_req);
  if (!user) {
    throw new Unauthorized();
  }

  const scriptPath = join(config.binDir, "p");

  // get session list
  const output = execFileSync(scriptPath, ["list"], {
    cwd: config.root,
    stdio: "pipe",
  }).toString();

  // parse output (each line: session-name pid=... colsxrows alive|dead ...)
  // then hide sessions owned by a different user (see lib/pty/session-owners.ts)
  const sessions = filterAccessibleSessions(
    output
      .trim()
      .split("\n")
      .filter((line) => line.includes("alive"))
      .map((line) => line.split(/\s+/)[0]),
    user.id,
  );

  return apiSuccess({ sessions });
});
