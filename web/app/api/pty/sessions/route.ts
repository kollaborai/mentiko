import { NextRequest } from "next/server";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import { canAccessSession } from "@/lib/pty/session-owners";

export const dynamic = "force-dynamic";

export interface PtySession {
  name: string;
  pid: number;
  cols: number;
  rows: number;
  status: string;
  statusCode: number | null;
  cmd: string;
  alive: boolean;
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  const user = await getSessionUser(request);
  if (!user) {
    throw new Unauthorized();
  }

  try {
    const { pty } = await import("@/lib/pty/pty-client");
    const rawSessions = await pty.list();

    const sessions: PtySession[] = rawSessions
      // hide sessions owned by another user (see lib/pty/session-owners.ts)
      .filter((s) => canAccessSession(s.name, user.id))
      .map((s) => {
      const dimMatch = s.terminalSize?.match(/^(\d+)x(\d+)$/);
      const cols = dimMatch ? parseInt(dimMatch[1], 10) : 80;
      const rows = dimMatch ? parseInt(dimMatch[2], 10) : 24;

      let status = "alive";
      if (!s.alive && s.exitCode !== null) {
        status = `exited(${s.exitCode})`;
      } else if (!s.alive) {
        status = "dead";
      }

      return {
        name: s.name,
        pid: s.pid ?? s.childPid ?? s.bridgePid ?? 0,
        cols,
        rows,
        status,
        statusCode: s.exitCode,
        cmd: s.cmd || "",
        alive: s.alive,
      };
    });

    return apiSuccess({ sessions });
  } catch {
    // pty-manager not running or no sessions
    return apiSuccess({ sessions: [] });
  }
});
