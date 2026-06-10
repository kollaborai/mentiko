import { NextRequest } from "next/server";
import { Unauthorized, Forbidden, InternalServerError } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import { canAccessSession, removeSessionOwner } from "@/lib/pty/session-owners";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(
  async (request: NextRequest, context: { params: Promise<{ name: string }> }) => {
    const user = await getSessionUser(request);
    if (!user) {
      throw new Unauthorized();
    }

    const { name } = await context.params;

    if (!canAccessSession(name, user.id)) {
      throw new Forbidden("not your session");
    }

    try {
      const { pty } = await import("@/lib/pty/pty-client");
      const output = await pty.capture(name, 100);
      return apiSuccess({ output });
    } catch (error) {
      throw new InternalServerError(
        error instanceof Error ? error.message : String(error)
      );
    }
  }
);

export const DELETE = withErrorHandling(
  async (request: NextRequest, context: { params: Promise<{ name: string }> }) => {
    const user = await getSessionUser(request);
    if (!user) {
      throw new Unauthorized();
    }

    const { name } = await context.params;

    if (!canAccessSession(name, user.id)) {
      throw new Forbidden("not your session");
    }

    try {
      const { pty } = await import("@/lib/pty/pty-client");
      await pty.remove(name);
      removeSessionOwner(name);
      return apiSuccess({ ok: true });
    } catch (error) {
      throw new InternalServerError(
        error instanceof Error ? error.message : String(error)
      );
    }
  }
);
