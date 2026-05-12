import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { pty } from "@/lib/pty-client";
import { sanitizeOutput } from "@/lib/sanitize-output";
import { BadRequest, InternalServerError } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

function validateSessionName(session: string): string {
  const decoded = decodeURIComponent(session);
  if (!/^[a-zA-Z0-9\-_]+$/.test(decoded)) {
    throw new BadRequest("Invalid session name", { field: "session" });
  }
  if (decoded.length > 100) {
    throw new BadRequest("Session name too long", { field: "session" });
  }
  return decoded;
}

export const GET = withErrorHandling(async (request: NextRequest, context: { params: Promise<{ session: string }> }) => {
  if (!(await checkAuth(request))) {
    throw new InternalServerError("Authentication check failed");
  }

  const { session } = await context.params;
  const safeSession = validateSessionName(session);

  const isAlive = await pty.alive(safeSession);
  if (!isAlive) {
    return apiSuccess({ output: "", status: "stopped" });
  }

  const raw = await pty.capture(safeSession, 500);
  return apiSuccess({ output: sanitizeOutput(raw.trim()), status: "running" });
});

export const DELETE = withErrorHandling(async (request: NextRequest, context: { params: Promise<{ session: string }> }) => {
  if (!(await checkAuth(request))) {
    throw new InternalServerError("Authentication check failed");
  }

  const { session } = await context.params;
  const safeSession = validateSessionName(session);

  // kill monitor session if exists
  await pty.remove(`monitor-${safeSession}`);

  // kill main session
  await pty.remove(safeSession);

  return apiSuccess({ success: true, session: safeSession });
});
