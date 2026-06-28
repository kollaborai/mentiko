import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { pty } from "@/lib/pty/pty-client";
import { BadRequest, Unauthorized } from "@/lib/api-errors";
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

export const POST = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ session: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized("Authentication required");
  }

  const { session } = await context.params;
  const safeSession = validateSessionName(session);
  const { message } = await request.json();

  if (!message) {
    throw new BadRequest("message is required", { field: "message" });
  }

  if (typeof message !== "string") {
    throw new BadRequest("message must be a string", { field: "message" });
  }

  if (message.length > 10000) {
    throw new BadRequest("message too long", { field: "message" });
  }

  await pty.sendKeys(safeSession, message);
  return apiSuccess({ success: true, session: safeSession });
});
