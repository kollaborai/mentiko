import { NextRequest } from "next/server";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/api-auth";

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
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  try {
    const { pty } = await import("@/lib/pty-client");
    const rawSessions = await pty.list();

    const sessions: PtySession[] = rawSessions.map((s) => {
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
