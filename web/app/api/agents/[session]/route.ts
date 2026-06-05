import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { pty } from "@/lib/pty/pty-client";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
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

export const GET = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ session: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { session } = await context.params;
  const safeSession = validateSessionName(session);

  const output = await pty.capture(safeSession, 500);
  return apiSuccess({ output, session: safeSession });
});
