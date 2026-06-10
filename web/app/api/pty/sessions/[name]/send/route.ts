import { NextRequest } from "next/server";
import { BadRequest, Forbidden, InternalServerError, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import { canAccessSession } from "@/lib/pty/session-owners";

export const dynamic = "force-dynamic";

function validateSessionName(name: string): string {
  const decoded = decodeURIComponent(name);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9\-_]{0,99}$/.test(decoded)) {
    throw new BadRequest("invalid session name", { field: "name" });
  }
  return decoded;
}

export const POST = withErrorHandling(
  async (request: NextRequest, context: { params: Promise<{ name: string }> }) => {
    const user = await getSessionUser(request);
    if (!user) {
      throw new Unauthorized();
    }

    const { name } = await context.params;
    const sessionName = validateSessionName(name);

    // sending keystrokes drives someone's live session — owner only
    if (!canAccessSession(sessionName, user.id)) {
      throw new Forbidden("not your session");
    }

    const { text } = await request.json();

    if (!text || typeof text !== "string") {
      throw new BadRequest("text is required", { field: "text" });
    }

    if (text.length > 10000) {
      throw new BadRequest("text too long", { field: "text" });
    }

    try {
      const { pty } = await import("@/lib/pty/pty-client");
      await pty.sendKeys(sessionName, text);
      return apiSuccess({ ok: true, session: sessionName });
    } catch (error) {
      throw new InternalServerError(
        error instanceof Error ? error.message : String(error)
      );
    }
  }
);
