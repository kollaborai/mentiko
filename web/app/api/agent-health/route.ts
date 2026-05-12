import { NextRequest } from "next/server";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import config from "@/lib/config";
import { checkAuth } from "@/lib/api-auth";
import { BadRequest, InternalServerError, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

const P_BINARY = join(config.binDir, "p");

interface AgentSession {
  name: string;
  pid: number;
  status: "alive" | "dead";
  command: string;
  startTime?: number;
  runId?: string;
  chain?: string;
  agentId?: string;
}

function parseSessions(output: string): AgentSession[] {
  const lines = output.trim().split("\n");
  const sessions: AgentSession[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    // format: name pid=XXX 80x50 alive command
    const match = line.match(/^(\S+)\s+pid=(\d+)\s+\d+x\d+\s+(\w+)\s+(.+)$/);
    if (!match) continue;

    const [, name, pid, status, command] = match;
    const session: AgentSession = {
      name,
      pid: parseInt(pid, 10),
      status: status as "alive" | "dead",
      command,
    };

    // extract metadata from session name
    // format: {platform}-{chain}-{agentId}-run-{runId}
    // or: {namespace}-chain-watcher-{chain}
    const runMatch = name.match(/run-(\d+)$/);
    if (runMatch) {
      session.runId = runMatch[1];
    }

    const chainMatch = name.match(/-(\w+)-run-/);
    if (chainMatch) {
      session.chain = chainMatch[1];
    }

    const agentMatch = name.match(/-(\w+-\w+|\w+)-run-/);
    if (agentMatch) {
      session.agentId = agentMatch[1];
    }

    // try to get start time from process
    try {
      const psOutput = execSync(`ps -p ${pid} -o lstart=`, { encoding: "utf-8" }).trim();
      if (psOutput) {
        session.startTime = new Date(psOutput).getTime();
      }
    } catch {
      // process may have exited
    }

    sessions.push(session);
  }

  return sessions;
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  if (!existsSync(P_BINARY)) {
    return apiSuccess({ sessions: [], error: "pty-manager not found" });
  }

  const output = execSync(`"${P_BINARY}" list`, { encoding: "utf-8" });
  const sessions = parseSessions(output);

  return apiSuccess({ sessions });
});

export const DELETE = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { searchParams } = new URL(request.url);
  const session = searchParams.get("session");

  if (!session) {
    throw new BadRequest("session parameter required", { field: "session" });
  }

  if (!existsSync(P_BINARY)) {
    throw new InternalServerError("pty-manager not found");
  }

  execSync(`"${P_BINARY}" kill "${session}"`, { encoding: "utf-8" });

  return apiSuccess({ success: true, killed: session });
});
