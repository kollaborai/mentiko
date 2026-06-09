import { NextRequest } from "next/server";
import { BadRequest, InternalServerError, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/auth/api-auth";

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
    if (!(await checkAuth(request))) {
      throw new Unauthorized();
    }

    const { name } = await context.params;
    const sessionName = validateSessionName(name);
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
