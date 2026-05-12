/**
 * GET /api/workspaces/logs
 *
 * Server-Sent Events stream for remote workspace logs.
 * Streams stdout from a remote session (SSH or Docker) in real-time.
 *
 * Query params:
 *   workspaceId  - workspace ID to stream from
 *   sessionName  - pty-manager session name (or "tail" for file tail)
 *   lines        - initial tail lines (default 100)
 *   follow       - if "true", keep streaming new lines (SSE mode)
 *
 * For SSH workspaces: tail -f the remote log file.
 * For local: read from pty-manager output file.
 * For Docker: docker logs -f --tail N.
 *
 * Auth: standard session cookie or bearer token.
 */

import { NextRequest } from "next/server";
import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { listWorkspaces, checkWorkspaceAccess } from "@/lib/workspace-storage";
import { nsPath, config } from "@/lib/config";
import { Unauthorized, BadRequest, NotFound, Forbidden, ApiError } from "@/lib/api-errors";
import { apiError } from "@/lib/api-response";
import { getSessionUser } from "@/lib/auth-bridge";
import { buildChildEnv } from "@/lib/child-env";

export const dynamic = "force-dynamic";

interface Workspace {
  id: string;
  name: string;
  path?: string;
  execution?: {
    type: "local" | "ssh" | "docker";
    ssh?: { host: string; user?: string; port?: number; key?: string };
    docker?: { container: string };
  };
  members?: string[];
}

function buildStreamCommand(
  workspace: Workspace,
  sessionName: string,
  lines: number,
  namespaceId: string
): { cmd: string; args: string[] } | null {
  const execType = workspace.execution?.type || "local";

  if (execType === "ssh" && workspace.execution?.ssh) {
    const { host, user = "root", port = 22, key } = workspace.execution.ssh;
    const sshArgs = [
      "-o", "StrictHostKeyChecking=no",
      "-o", "BatchMode=yes",
      ...(key ? ["-i", key] : []),
      "-p", String(port),
      `${user}@${host}`,
      // tail the pty-manager output file for this session
      `tail -n ${lines} -f /tmp/mentiko-${sessionName}.log 2>/dev/null || journalctl -f -n ${lines} 2>/dev/null || echo "no log found"`,
    ];
    return { cmd: "ssh", args: sshArgs };
  }

  if (execType === "docker" && workspace.execution?.docker) {
    const { container } = workspace.execution.docker;
    return {
      cmd: "docker",
      args: ["logs", "--tail", String(lines), "-f", container],
    };
  }

  // local: read from pty-manager output file
  const logFile = nsPath(namespaceId, "state", `${sessionName}.output`);
  if (existsSync(logFile)) {
    return { cmd: "tail", args: ["-n", String(lines), "-f", logFile] };
  }

  return null;
}

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const user = await getSessionUser(request);
    if (!user) {
      throw new Unauthorized();
    }

    const namespaceId = await getNamespaceIdFromRequest(request);
    const orgId = await getOrgIdFromRequest(request);
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const sessionName = searchParams.get("sessionName") || "latest";
    const lines = parseInt(searchParams.get("lines") || "100", 10);
    const follow = searchParams.get("follow") !== "false";

    if (!workspaceId) {
      throw new BadRequest("workspaceId required", { field: "workspaceId" });
    }

    const workspaces = listWorkspaces(namespaceId, orgId);
    const workspace = workspaces.find((w) => w.id === workspaceId);

    if (!workspace) {
      throw new NotFound("Workspace", workspaceId);
    }

    // check workspace membership
    if (!checkWorkspaceAccess(workspace, user.id)) {
      throw new Forbidden("You do not have access to this workspace");
    }

    const streamCmd = buildStreamCommand(workspace, sessionName, lines, namespaceId);

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(controller) {
        if (!streamCmd) {
          controller.enqueue(
            encoder.encode(`data: {"error":"No log source available for this workspace type"}\n\n`)
          );
          if (!follow) controller.close();
          return;
        }

        const proc: ChildProcess = spawn(streamCmd.cmd, streamCmd.args, {
          env: buildChildEnv({
            MENTIKO_GLOBAL_ROOT: config.globalRoot,
            MENTIKO_CODE_ROOT: config.codeRoot,
            MENTIKO_PROJECT_ROOT: config.projectRoot,
            MENTIKO_ORG_ROOT: config.orgRoot,
            MENTIKO_NAMESPACE_ROOT: config.namespaceRoot,
            NAMESPACE_ID: namespaceId,
            ORG_ID: config.orgId,
          }),
          stdio: ["ignore", "pipe", "pipe"],
        });

        proc.stdout?.on("data", (chunk: Buffer) => {
          const lines = chunk.toString().split("\n");
          for (const line of lines) {
            if (line.trim()) {
              const payload = JSON.stringify({ line, ts: Date.now() });
              controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
            }
          }
        });

        proc.stderr?.on("data", (chunk: Buffer) => {
          const payload = JSON.stringify({ line: chunk.toString(), ts: Date.now(), type: "stderr" });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        });

        proc.on("close", () => {
          controller.enqueue(encoder.encode(`data: {"done":true}\n\n`));
          controller.close();
        });

        proc.on("error", (err: Error) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: err.message })}\n\n`)
          );
          controller.close();
        });

        if (follow) {
          setTimeout(() => {
            proc.kill();
            controller.close();
          }, 10 * 60 * 1000);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const errorResponse = apiError(error);
      return errorResponse;
    }
    const errorResponse = apiError(error);
    return errorResponse;
  }
}
