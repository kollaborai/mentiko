import { NextRequest } from "next/server";
import { Unauthorized, InternalServerError } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/auth/api-auth";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(
  async (request: NextRequest, context: { params: Promise<{ name: string }> }) => {
    if (!(await checkAuth(request))) {
      throw new Unauthorized();
    }

    const { name } = await context.params;

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
    if (!(await checkAuth(request))) {
      throw new Unauthorized();
    }

    const { name } = await context.params;

    try {
      const { pty } = await import("@/lib/pty/pty-client");
      await pty.remove(name);
      return apiSuccess({ ok: true });
    } catch (error) {
      throw new InternalServerError(
        error instanceof Error ? error.message : String(error)
      );
    }
  }
);
