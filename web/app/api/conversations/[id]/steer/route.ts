import { NextRequest } from "next/server";
import { createReadStream } from "fs";
import { join } from "path";
import { createInterface } from "readline";
import { checkAuth } from "@/lib/auth/api-auth";
import { pty, listSessionNames } from "@/lib/pty/pty-client";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { claudeProjectPath, config } from "@/lib/config";
import { BadRequest, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { buildChildEnv } from "@/lib/runs/child-env";

export const dynamic = "force-dynamic";

function validateSessionName(session: string): string {
  if (!/^[a-zA-Z0-9\-_]+$/.test(session)) {
    throw new BadRequest("Invalid session name", { session });
  }
  if (session.length > 100) {
    throw new BadRequest("Session name too long (max 100 chars)", { maxLength: 100 });
  }
  return session;
}

// find session matching a conversation by scanning session list
function findMatchingSession(
  sessionId: string,
  slug: string,
  agentRole: string,
  sessionNames: string[]
): string | null {
  const idLower = sessionId.toLowerCase();
  const slugLower = slug.toLowerCase();
  const roleLower = agentRole.toLowerCase();

  // priority 1: exact match on sessionId
  const exact = sessionNames.find((s) => s.toLowerCase() === idLower);
  if (exact) return exact;

  // priority 2: starts with sessionId
  const prefix = sessionNames.find((s) => s.toLowerCase().startsWith(idLower));
  if (prefix) return prefix;

  // priority 3: contains sessionId
  const contains = sessionNames.find((s) => s.toLowerCase().includes(idLower));
  if (contains) return contains;

  // priority 4: contains slug
  if (slugLower) {
    const slugMatch = sessionNames.find((s) => s.toLowerCase().includes(slugLower));
    if (slugMatch) return slugMatch;
  }

  // priority 5: contains agent role
  if (roleLower) {
    const roleMatch = sessionNames.find((s) => s.toLowerCase().includes(roleLower));
    if (roleMatch) return roleMatch;
  }

  return null;
}

// extract slug and agentRole from first few lines of jsonl
async function getConversationMeta(
  filePath: string
): Promise<{ slug: string; agentRole: string }> {
  return new Promise((resolve) => {
    let slug = "";
    let agentRole = "";
    let lineCount = 0;

    const stream = createReadStream(filePath, { encoding: "utf-8" });
    const rl = createInterface({ input: stream });

    rl.on("line", (line) => {
      lineCount++;
      if (lineCount > 20) {
        rl.close();
        stream.destroy();
        return;
      }
      try {
        const obj = JSON.parse(line);
        if (!slug && obj.slug) slug = obj.slug;
        if (!agentRole && obj.type === "user") {
          const content = obj.message?.content;
          let text = "";
          if (typeof content === "string") text = content;
          else if (Array.isArray(content)) {
            for (const b of content) {
              if (b.type === "text") { text = b.text; break; }
            }
          }
          const msg = text.toLowerCase();
          if (msg.includes("solutions architect")) agentRole = "Solutions Architect";
          else if (msg.includes("account executive")) agentRole = "Account Executive";
          else if (msg.includes("project manager")) agentRole = "Project Manager";
          else if (msg.includes("reviewer")) agentRole = "Reviewer";
          else if (msg.includes("researcher")) agentRole = "Researcher";
          else if (msg.includes("writer")) agentRole = "Writer";
        }
      } catch {
        // skip
      }
    });

    rl.on("close", () => resolve({ slug, agentRole }));
    rl.on("error", () => resolve({ slug, agentRole }));
  });
}

export const POST = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { id } = await context.params;
  const body = await request.json();
  const { message, cwd } = body;

  if (!message || typeof message !== "string") {
    throw new BadRequest("message is required", { field: "message" });
  }

  if (message.length > 10000) {
    throw new BadRequest("message too long (max 10000 chars)", { maxLength: 10000 });
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const projectCwd = cwd || process.cwd();
  const jsonlDir = claudeProjectPath(projectCwd);
  const jsonlPath = join(jsonlDir, `${id}.jsonl`);

  // get conversation metadata for matching
  let slug = "";
  let agentRole = "";
  try {
    const meta = await getConversationMeta(jsonlPath);
    slug = meta.slug;
    agentRole = meta.agentRole;
  } catch {
    // conversation file may not exist, still try session matching by id
  }

  // get active sessions
  const sessionNames = await listSessionNames();

  let matched = findMatchingSession(id, slug, agentRole, sessionNames);

  // no live session - resume in a new pty-manager session
  if (!matched) {
    const sessionName = slug
      ? slug.replace(/[^a-zA-Z0-9\-_]/g, "-").slice(0, 80)
      : `resume-${id.slice(0, 12)}`;

    const safeName = validateSessionName(sessionName);

    // check session doesn't already exist (race condition guard)
    const exists = sessionNames.some(
      (s) => s.toLowerCase() === safeName.toLowerCase()
    );
    if (exists) {
      matched = safeName;
    } else {
      // spawn session with claude --resume
      await pty.spawn(safeName, "env", ["-u", "CLAUDECODE", "sh", "-c", `cd "${projectCwd}" && claude --resume "${id}"`], {
        cwd: projectCwd,
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

      // return immediately - message will be queued client-side
      return apiSuccess({
        success: true,
        session: safeName,
        conversationId: id,
        resumed: true,
        pending: true,
      });
    }
  }

  const safeSession = validateSessionName(matched);
  await pty.sendKeys(safeSession, message);

  return apiSuccess({
    success: true,
    session: safeSession,
    conversationId: id,
    resumed: false,
  });
});
