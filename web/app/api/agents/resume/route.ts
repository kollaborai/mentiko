import { NextRequest } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import { checkAuth } from "@/lib/auth/api-auth";
import { pty } from "@/lib/pty/pty-client";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import config from "@/lib/config";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { buildChildEnv } from "@/lib/runs/child-env";
import { mutateExistingRunJson } from "@/lib/runs/run-json-mutation";

export const dynamic = "force-dynamic";

// POST /api/agents/resume
// body: { conversationId, agentId, runId?, cwd? }
// spawns: claude --resume <conversationId> in a new pty session
// patches run.json so pollStatus doesn't overwrite the new session
// returns: { session: string }
export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const body = await request.json();
  const { conversationId, agentId, runId } = body as {
    conversationId: string;
    agentId: string;
    runId?: string;
    cwd?: string;
  };
  const cwd: string = body.cwd || config.root;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  if (!conversationId || !agentId) {
    throw new BadRequest("conversationId and agentId required", {
      fields: ["conversationId", "agentId"]
    });
  }

  if (!/^[a-f0-9-]{36}$/.test(conversationId)) {
    throw new BadRequest("invalid conversationId format (UUID expected)", {
      field: "conversationId"
    });
  }

  const ts = Date.now();
  const safeName = agentId.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 40);
  const sessionName = `resume-${safeName}-${ts}`;

  await pty.spawn(sessionName, "env", ["-u", "CLAUDECODE", "claude", "--resume", conversationId], {
    cwd,
    env: buildChildEnv({
      MENTIKO_GLOBAL_ROOT: config.globalRoot,
      MENTIKO_CODE_ROOT: config.codeRoot,
      MENTIKO_PROJECT_ROOT: config.projectRoot,
      MENTIKO_ORG_ROOT: config.orgRoot,
      MENTIKO_NAMESPACE_ROOT: config.namespaceRoot,
      NAMESPACE_ID: namespaceId,
      ORG_ID: orgId,
    }),
  });

  if (runId) {
    const runJsonPath = join(config.runsDir, runId, "run.json");
    if (existsSync(runJsonPath)) {
      try {
        mutateExistingRunJson<{ agents?: Array<{ id: string; session?: string; status?: string }> }>(runJsonPath, (run) => ({
          ...run, agents: (run.agents || []).map((a) => a.id === agentId ? { ...a, session: sessionName, status: "running" } : a),
        }));
      } catch {
        // non-fatal: poll will eventually catch up
      }
    }
  }

  return apiSuccess({ session: sessionName });
});
