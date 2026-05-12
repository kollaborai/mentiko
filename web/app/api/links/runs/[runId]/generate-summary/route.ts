import { NextRequest } from "next/server";
import { readFileSync, readdirSync, existsSync, createReadStream, statSync } from "fs";
import { basename, join } from "path";
import { createInterface } from "readline";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { requirePermission } from "@/lib/rbac-auth";
import { checkRunAccess } from "@/lib/run-acl";
import { BadRequest, NotFound, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveLinkRunPaths, resolvePeerOutputDir, validateLinkRunId } from "@/lib/link-run-runtime";
import { getTemplate } from "@/lib/generation-template-storage";
import { resolveTemplate } from "@/lib/template-resolver";
import { createJob } from "@/lib/job-store";
import { launchJobRunner } from "@/lib/job-runner-launch";
import { getSessionUser } from "@/lib/auth-bridge";
import { resolveAuthorizedWorkspacePath } from "@/lib/workspace-auth";
import { resolveLogDir } from "@/lib/session-log-resolver";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function uniqueArray(items: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    output.push(item);
  }
  return output;
}

function parseProviderList(raw: string | null): string[] {
  if (!raw) return ["codex", "claude-code"];
  const providers = raw
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  return providers.length ? providers : ["codex", "claude-code"];
}

function resolveLogDirs(cwd: string, cli: string | null): string[] {
  const rawInputs = uniqueArray([cwd || process.cwd(), process.cwd()]);
  const providers = parseProviderList(cli);
  const dirs: string[] = [];
  const seen = new Set<string>();

  for (const input of rawInputs) {
    for (const provider of providers) {
      const dir = resolveLogDir(provider, input);
      if (!dir || seen.has(dir)) continue;
      if (!existsSync(dir)) continue;
      seen.add(dir);
      dirs.push(dir);
    }
  }

  return dirs;
}

function getMessageContent(entry: Record<string, unknown>): unknown {
  const message = isRecord(entry.message) ? entry.message : undefined;
  if (message?.content !== undefined) return message.content;

  const payload = isRecord(entry.payload) ? entry.payload : undefined;
  if (payload?.type === "message") {
    const payloadMessage = isRecord(payload.message) ? payload.message : undefined;
    if (payloadMessage?.content !== undefined) return payloadMessage.content;
  }

  if (entry.content !== undefined) return entry.content;
  return "";
}

function getTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return (content as Array<Record<string, unknown>>)
    .map((block) => {
      if (!isRecord(block)) return "";
      const type = typeof block.type === "string" ? block.type : "";
      const text = typeof block.text === "string" ? block.text : "";
      if (!text) return "";
      if (type === "text" || type === "input_text" || type === "output_text") {
        return text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function getMessageRole(entry: Record<string, unknown>): string {
  const type = typeof entry.type === "string" ? entry.type : "";
  if (type === "user" || type === "assistant") return type;
  if (type === "response_item") {
    const payload = isRecord(entry.payload) ? entry.payload : undefined;
    if (payload?.type === "message") {
      const payloadMessage = isRecord(payload.message) ? payload.message : undefined;
      if (typeof payloadMessage?.role === "string") {
        return payloadMessage.role;
      }
    }
    return "";
  }

  const payload = isRecord(entry.payload) ? entry.payload : undefined;
  if (payload?.type === "message") {
    const payloadMessage = isRecord(payload.message) ? payload.message : undefined;
    if (typeof payloadMessage?.role === "string") return payloadMessage.role;
  }
  return "";
}

async function isRelaySession(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const stream = createReadStream(filePath, { encoding: "utf-8" });
    const rl = createInterface({ input: stream });
    let checked = 0;
    let resolved = false;

    const done = (value: boolean) => {
      if (resolved) return;
      resolved = true;
      rl.close();
      stream.destroy();
      resolve(value);
    };

    rl.on("line", (line) => {
      if (resolved) return;
      checked++;
      if (checked > 10) { done(false); return; }

      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        if (getMessageRole(obj) === "user") {
          const content = getMessageContent(obj);
          const text = getTextFromContent(content);
          done(text.includes("Extract the most recent response"));
          return;
        }
      } catch { /* skip */ }
    });

    rl.on("close", () => done(false));
    rl.on("error", () => done(false));
  });
}

export const POST = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const { runId } = await params;
  if (!validateLinkRunId(runId)) {
    throw new BadRequest("Invalid run ID");
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { runsDir, runJsonPath: runPath, runDir } = resolveLinkRunPaths(namespaceId, orgId, runId);
  const acl = await checkRunAccess(request, runId, runsDir);
  if (!acl.ok) {
    if (acl.reason === "run-not-found") throw new NotFound("Run", runId);
    throw new Unauthorized();
  }

  if (!existsSync(runPath)) {
    throw new NotFound("Run not found");
  }

  const run = JSON.parse(readFileSync(runPath, "utf-8"));
  if (run.type !== "link") {
    throw new NotFound("Not a link run");
  }

  // already has summary
  if (existsSync(join(runDir, "summary.json"))) {
    return apiSuccess({ jobId: null, status: "already_exists" });
  }

  // --- gather transcript from peer output ---
  const peerOutputDir = resolvePeerOutputDir(namespaceId);
  let transcriptText = "(no transcript data)";
  if (existsSync(peerOutputDir)) {
    const sessions = run.agents
      .map((a: { session: string; name: string }) => ({ session: a.session, name: a.name }))
      .filter((a: { session: string }) => a.session);

    const entries: string[] = [];
    if (run.goal) {
      entries.push(`[PROMPT] ${run.goal}`);
    }

    for (const { session, name } of sessions) {
      const files = readdirSync(peerOutputDir)
        .filter((f: string) => f.startsWith(session) && f.endsWith(".txt"))
        .sort();

      for (const file of files) {
        const match = basename(file, ".txt").match(/-r(\d+)-(\d+)$/);
        if (!match) continue;
        const round = match[1];
        const content = readFileSync(join(peerOutputDir, file), "utf-8").trim();
        if (content) {
          entries.push(`[Round ${round}] ${name}:\n${content.slice(0, 4000)}`);
        }
      }
    }

    if (entries.length > 0) {
      transcriptText = entries.join("\n\n---\n\n");
    }
  }

  // --- gather moderator relay data ---
  let moderatorText = "(no moderator data)";
  const cwd = run.workspacePath || process.cwd();
  const searchParams = new URL(request.url).searchParams;
  const cli = searchParams.get("cli");
  const logDirs = resolveLogDirs(cwd, cli);

  for (const jsonlDir of logDirs) {
    const startedMs = run.started ? new Date(run.started).getTime() : 0;
    const completedMs = run.completed ? new Date(run.completed).getTime() : Date.now();

    const relayFiles: string[] = [];
    const files = readdirSync(jsonlDir)
      .filter((f: string) => f.endsWith(".jsonl"))
      .map((f: string) => ({ name: f, ctime: statSync(join(jsonlDir, f)).birthtimeMs }))
      .filter((f) => f.ctime >= startedMs - 60000 && f.ctime <= completedMs + 60000)
      .sort((a, b) => a.ctime - b.ctime);

    for (const file of files) {
      const filePath = join(jsonlDir, file.name);
      const isRelay = await isRelaySession(filePath);
      if (isRelay) relayFiles.push(file.name);
    }

    if (relayFiles.length > 0) {
      moderatorText = `${relayFiles.length} relay sessions found during run window`;
      break;
    }
  }

  // --- gather escalations ---
  let escalationsText = "(no escalations)";
  if (run.escalations && run.escalations.length > 0) {
    escalationsText = run.escalations
      .map((esc: { round?: number; trigger?: string; haiku_summary?: string; human_reply?: string }, i: number) =>
        `Escalation ${i + 1}: Round ${esc.round || "?"}, Trigger: ${esc.trigger || "unknown"}${esc.haiku_summary ? `\nSummary: ${esc.haiku_summary}` : ""}${esc.human_reply ? `\nHuman reply: ${esc.human_reply}` : ""}`
      )
      .join("\n\n");
  }

  // --- resolve template ---
  const session = await getSessionUser(request);
  const userId = session?.id;
  const authorizedWorkspacePath = resolveAuthorizedWorkspacePath(namespaceId, orgId, run.workspaceId, userId);
  const workspaceContext = authorizedWorkspacePath
    ? `\nWORKSPACE CONTEXT: The link run was executed in "${authorizedWorkspacePath}". Reference repo-relative paths.\n`
    : "";

  const template = getTemplate(namespaceId, orgId, "link_summary");
  const summaryPrompt = resolveTemplate(template.content, {
    LINK_RUN_DATA: JSON.stringify({
      id: run.id,
      goal: run.goal,
      mode: run.mode,
      status: run.status,
      started: run.started,
      completed: run.completed,
      rounds: run.rounds,
      agents: run.agents?.map((a: { id: string; name?: string; status: string }) => ({
        id: a.id,
        name: a.name,
        status: a.status,
      })),
      linkName: run.linkName,
    }, null, 2),
    LINK_TRANSCRIPT: transcriptText,
    LINK_MODERATOR: moderatorText,
    LINK_ESCALATIONS: escalationsText,
    WORKSPACE_CONTEXT: workspaceContext,
  });

  // --- create and launch job ---
  const job = createJob(
    "link_summary",
    {
      prompt: summaryPrompt,
      runId: run.id,
      workspacePath: authorizedWorkspacePath,
    },
    undefined,
    undefined,
    userId,
    namespaceId
  );

  launchJobRunner({
    job,
    namespaceId,
    orgId,
    origin: request.nextUrl.origin,
  });

  return apiSuccess({ jobId: job.id, status: "generating" });
});
