import { NextRequest } from "next/server";
import { readFileSync, readdirSync, statSync, existsSync, createReadStream } from "fs";
import { join } from "path";
import { createInterface } from "readline";
import { resolveLogDir } from "@/lib/session-log-resolver";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { requirePermission } from "@/lib/rbac-auth";
import { checkRunAccess } from "@/lib/run-acl";
import { BadRequest, NotFound, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveLinkRunPaths, validateLinkRunId } from "@/lib/link-run-runtime";

export const dynamic = "force-dynamic";

interface RelayMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

interface RelaySession {
  id: string;
  createdAt: number;
  messages: RelayMessage[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseProviderList(raw: string | null): string[] {
  if (!raw) return ["codex", "claude-code"];
  const providers = raw.split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
  return providers.length ? providers : ["codex", "claude-code"];
}

function resolveLogDirs(cwd: string, cli: string | null): string[] {
  const providers = parseProviderList(cli);
  const dirs: string[] = [];
  for (const provider of providers) {
    const dir = resolveLogDir(provider, cwd);
    if (!dir || dirs.includes(dir)) continue;
    if (existsSync(dir)) dirs.push(dir);
  }
  return dirs;
}

function extractMessageContent(entry: Record<string, unknown>): unknown {
  const message = isRecord(entry.message) ? entry.message : undefined;
  if (message?.content !== undefined) return message.content;

  const payload = isRecord(entry.payload) ? entry.payload : undefined;
  if (payload?.type === "message") {
    const payloadMessage = isRecord(payload.message) ? payload.message : undefined;
    if (payloadMessage?.content !== undefined) return payloadMessage.content;
  }

  return "";
}

function getText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  for (const block of content as Array<Record<string, unknown>>) {
    if (!isRecord(block)) continue;
    const blockType = typeof block.type === "string" ? block.type : "";
    if ((blockType === "text" || blockType === "input_text" || blockType === "output_text") && typeof block.text === "string") {
      return block.text;
    }
  }
  return "";
}

// check if a JSONL file is a relay session (first user message starts with "Extract the most recent response")
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
      if (checked > 10) {
        done(false);
        return;
      }

      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        const objType = typeof obj.type === "string" ? obj.type : "";
        if (objType === "user" || objType === "assistant" || objType === "response_item") {
          const role = objType === "user" || objType === "assistant"
            ? objType
            : (() => {
              const payload = isRecord(obj.payload) ? obj.payload : undefined;
              if (payload?.type === "message") {
                const payloadMessage = isRecord(payload.message) ? payload.message : undefined;
                if (typeof payloadMessage?.role === "string") return payloadMessage.role;
              }
              return "";
            })();

          if (role === "user") {
            const text = getText(extractMessageContent(obj));
            done(text.includes("Extract the most recent response"));
            return;
          }
        }
      } catch {
        // skip
      }
    });

    rl.on("close", () => done(false));
    rl.on("error", () => done(false));
  });
}

// parse a relay JSONL into messages
async function parseRelaySession(filePath: string): Promise<RelayMessage[]> {
  return new Promise((resolve) => {
    const messages: RelayMessage[] = [];
    const stream = createReadStream(filePath, { encoding: "utf-8" });
    const rl = createInterface({ input: stream });

    rl.on("line", (line) => {
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        const objType = typeof obj.type === "string" ? obj.type : "";
        const payload = isRecord(obj.payload) ? obj.payload : undefined;
        const role = objType === "user" || objType === "assistant"
          ? objType
          : payload?.type === "message" && isRecord(payload.message) && typeof payload.message.role === "string"
            ? payload.message.role
            : "";
        if (role !== "user" && role !== "assistant") return;

        const text = getText(extractMessageContent(obj));

        if (!text) return;

        messages.push({
          role: role as "user" | "assistant",
          content: text,
          timestamp:
            (typeof obj.timestamp === "string" && obj.timestamp) ||
            (isRecord(obj.message) && typeof obj.message.created_at === "string" ? obj.message.created_at : undefined),
        });
      } catch {
        // skip
      }
    });

    rl.on("close", () => resolve(messages));
    rl.on("error", () => resolve([]));
  });
}

export const GET = withErrorHandling(async (
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
  const { runsDir, runJsonPath: runPath } = resolveLinkRunPaths(namespaceId, orgId, runId);
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

  const startedMs = run.started ? new Date(run.started).getTime() : 0;
  const completedMs = run.completed
    ? new Date(run.completed).getTime()
    : Date.now();

  // find the JSONL directory for this workspace
  const cwd = run.workspacePath || process.cwd();
  const searchParams = new URL(request.url).searchParams;
  const cli = searchParams.get("cli");
  const logDirs = resolveLogDirs(cwd, cli);

  if (logDirs.length === 0) {
    return apiSuccess({ sessions: [], runId });
  }

  // find relay sessions created during the run window
  const files = logDirs.flatMap((jsonlDir) =>
    readdirSync(jsonlDir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => {
      const stat = statSync(join(jsonlDir, f));
      return {
        name: f,
        ctime: stat.birthtimeMs,
        path: join(jsonlDir, f),
      };
    })
    // allow 60s before start for clock skew
    .filter((f) => f.ctime >= startedMs - 60000 && f.ctime <= completedMs + 60000)
    .sort((a, b) => a.ctime - b.ctime)
  );

  const sessions: RelaySession[] = [];

  for (const file of files) {
    const filePath = file.path;
    const isRelay = await isRelaySession(filePath);
    if (!isRelay) continue;

    const messages = await parseRelaySession(filePath);
    sessions.push({
      id: file.name.replace(".jsonl", ""),
      createdAt: file.ctime,
      messages,
    });
  }

  return apiSuccess({ sessions, runId });
});
