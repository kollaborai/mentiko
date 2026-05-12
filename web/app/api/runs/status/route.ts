import { NextRequest } from "next/server";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { getNamespaceConfig, getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { checkAuth } from "@/lib/api-auth";
import { pty } from "@/lib/pty-client";
import { checkRunAccess } from "@/lib/run-acl";
import { resolveLinkRunsDir } from "@/lib/link-run-runtime";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

interface StateFile {
  status: string;
  session: string;
  agent_id: string;
  emits?: string;
  started?: string;
  completed?: string;
}

export const GET = withErrorHandling(async (req: NextRequest) => {
  if (!(await checkAuth(req))) {
    throw new Unauthorized();
  }

  const { searchParams } = new URL(req.url);
  const runId = searchParams.get("run-id");

  // If run-id is provided, read from run-specific state directory
  if (runId) {
    const namespaceId = await getNamespaceIdFromRequest(req);
    const orgId = await getOrgIdFromRequest(req);
    const runsDir = resolveLinkRunsDir(namespaceId, orgId);

    // workspace ACL: user must have access to this run's workspace
    const acl = await checkRunAccess(req, runId, runsDir);
    if (!acl.ok) {
      if (acl.reason === "run-not-found") {
        return apiSuccess({ sessions: [], states: [] });
      }
      throw new Unauthorized();
    }
    const runStateDir = join(runsDir, runId, "state");
    if (!existsSync(runStateDir)) {
      return apiSuccess({ sessions: [], states: [] });
    }

    const files = readdirSync(runStateDir).filter((f) => f.endsWith(".state"));
    const states: StateFile[] = files.map((file) => {
      const content = readFileSync(join(runStateDir, file), "utf-8");
      const lines = content.split("\n").reduce((acc, line) => {
        const [key, ...rest] = line.split(":");
        if (key && rest.length > 0) {
          acc[key.trim()] = rest.join(":").trim();
        }
        return acc;
      }, {} as Record<string, string>);
      return {
        status: lines.status || "unknown",
        session: lines.session || "",
        agent_id: lines.agent_id || file.replace(".state", ""),
        emits: lines.emits,
        started: lines.started,
        completed: lines.completed,
      };
    });

    // filter sessions to only those in this run
    const sessionNames = new Set(states.map((s) => s.session).filter(Boolean));
    let sessions: Array<{ name: string; created: string }> = [];
    try {
      const allSessions = await pty.list();
      sessions = allSessions
        .filter((s) => sessionNames.has(s.name))
        .map((s) => ({ name: s.name, created: s.createdAt }));
    } catch {
      // no sessions
    }

    return apiSuccess({ sessions, states });
  }

  // NOTE: namespace-wide fallback mode below intentionally has NO workspace ACL.
  // Callers without a run-id receive namespace-wide state (admin/dashboard view
  // gated by checkAuth). Adding ACL here would break the intended behavior.
  const namespaceConfig = await getNamespaceConfig(req);
  const stateDir = namespaceConfig.stateDir;

  // Get sessions from pty-manager
  let sessions: Array<{ name: string; created: string }> = [];
  try {
    const allSessions = await pty.list();
    sessions = allSessions.map((s) => ({
      name: s.name,
      created: s.createdAt,
    }));
  } catch {
    // no sessions
  }

  // Get state files
  let states: StateFile[] = [];
  if (existsSync(stateDir)) {
    try {
      const files = readdirSync(stateDir).filter((f) => f.endsWith(".state"));
      states = files.map((file) => {
        const content = readFileSync(join(stateDir, file), "utf-8");
        const lines = content.split("\n").reduce((acc, line) => {
          const [key, ...rest] = line.split(":");
          if (key && rest.length > 0) {
            acc[key.trim()] = rest.join(":").trim();
          }
          return acc;
        }, {} as Record<string, string>);
        return {
          status: lines.status || "unknown",
          session: lines.session || "",
          agent_id: lines.agent_id || file.replace(".state", ""),
          emits: lines.emits,
          started: lines.started,
        };
      });
    } catch {
      // ignore state read errors
    }
  }

  return apiSuccess({ sessions, states });
});
