import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { pty } from "@/lib/pty/pty-client";
import { InternalServerError } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new InternalServerError("Authentication check failed");
  }

  const sessions = await pty.list();

  const agents = sessions
    .filter((s) => !s.name.startsWith("monitor-"))
    .map((s) => ({
      session: s.name,
      name: s.name,
      pid: s.childPid || s.bridgePid || null,
      createdAt: s.createdAt,
      status: s.alive ? "running" : "stopped",
    }));

  return apiSuccess({ agents });
});
