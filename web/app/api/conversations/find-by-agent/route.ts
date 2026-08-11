import { NextRequest } from "next/server";
import { existsSync, readdirSync, statSync, createReadStream, readFileSync } from "fs";
import { basename, join } from "path";
import { createInterface } from "readline";
import { resolveLogDir } from "@/lib/runs/session-log-resolver";
import { resolveAgentWorkspacePaths } from "@/lib/runs/agent-workspace-resolver";
import { checkAuth } from "@/lib/auth/api-auth";
import { BadRequest, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { matchesAgentConversationBootstrap, matchesAgentNameBootstrap } from "@/lib/runs/session-conversation-identity";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { resolveLinkRunsDir } from "@/lib/links/link-run-runtime";
import { checkRunAccess } from "@/lib/auth/run-acl";

export const dynamic = "force-dynamic";

const MAX_SCAN_LINES = 120;
const MAX_FILES_PER_DIR = 50;

function uniqueArray(items: string[]): string[] {
  const unique = new Set<string>();
  const output: string[] = [];
  for (const item of items) {
    if (!item || unique.has(item)) continue;
    unique.add(item);
    output.push(item);
  }
  return output;
}

function parseProviderList(raw: string | null): string[] {
  if (!raw) return ["codex", "claude-code"];
  const providers = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return providers.length ? providers : ["codex", "claude-code"];
}

function resolveLogPaths(cwds: string[], providers: string[]): string[] {
  const rawInputs = uniqueArray([...cwds, process.cwd()]);
  const dirs: string[] = [];
  const providerList = uniqueArray(providers);

  for (const input of rawInputs) {
    for (const provider of providerList) {
      const resolved = resolveLogDir(provider, input);
      if (!resolved || dirs.includes(resolved) || !existsSync(resolved)) {
        continue;
      }
      dirs.push(resolved);
    }
  }

  return dirs;
}

function listConversationFiles(
  dirs: string[],
  filterMs: number
): { path: string; ctime: number }[] {
  const files: { path: string; ctime: number }[] = [];

  for (const dir of dirs) {
    try {
      const names = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
      for (const name of names) {
        const filePath = join(dir, name);
        const stat = statSync(filePath);
        const ctime = Number.isFinite(stat.birthtimeMs) ? stat.birthtimeMs : stat.mtimeMs;
        if (!filterMs || ctime >= filterMs) {
          files.push({ path: filePath, ctime });
        }
      }
    } catch {
      continue;
    }
  }

  return files;
}

function readRunJson(path: string): {
  started?: string;
  workspacePath?: string;
  agents?: Array<{ id: string; started?: string }>;
} | null {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractMessageContent(entry: Record<string, unknown>): unknown {
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

function extractTextFromContent(content: unknown): string {
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

function extractMessageRole(entry: Record<string, unknown>): string {
  const payload = isRecord(entry.payload) ? entry.payload : undefined;
  if (payload?.type === "message") {
    const payloadMessage = isRecord(payload.message) ? payload.message : undefined;
    if (typeof payloadMessage?.role === "string") return payloadMessage.role;
  }

  if (typeof entry.role === "string") return entry.role;
  if (typeof entry.type === "string") return entry.type;

  return "";
}

function getMessageText(obj: unknown): string {
  if (!isRecord(obj)) return "";

  const messageText = extractTextFromContent(extractMessageContent(obj));
  if (messageText) return messageText;

  const eventMsg = obj.event_msg;
  if (typeof eventMsg === "string") return eventMsg;
  if (isRecord(eventMsg) && typeof eventMsg.message === "string") {
    return eventMsg.message;
  }

  return "";
}

// scan conversation entries for agent name match
async function checkFirstUserMessage(
  filePath: string,
  agentName: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const stream = createReadStream(filePath, { encoding: "utf-8" });
    const rl = createInterface({ input: stream });
    let found = false;
    let checked = 0;

    rl.on("line", (line) => {
      checked++;
      if (checked > MAX_SCAN_LINES) {
        rl.close();
        stream.destroy();
        return;
      }

      try {
        const obj = JSON.parse(line);
        const text = getMessageText(obj);
        if (isRecord(obj)) {
          const role = extractMessageRole(obj);
          if (role === "user") {
            found = matchesAgentNameBootstrap(text, agentName);
            rl.close();
            stream.destroy();
            return;
          }
        }
      } catch {
        // skip malformed
      }
    });

    rl.on("close", () => resolve(found));
    rl.on("error", () => resolve(false));
  });
}

// scan conversation entries for unique agent identifier (runId + agentId)
async function checkAgentIdentifier(
  filePath: string,
  runId: string,
  agentId: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const stream = createReadStream(filePath, { encoding: "utf-8" });
    const rl = createInterface({ input: stream });
    let found = false;
    let checked = 0;

    rl.on("line", (line) => {
      checked++;
      if (checked > MAX_SCAN_LINES) {
        rl.close();
        stream.destroy();
        return;
      }

      try {
        const obj = JSON.parse(line);
        if (isRecord(obj) && extractMessageRole(obj) === "user") {
          found = matchesAgentConversationBootstrap(getMessageText(obj), { runId, agentId });
          rl.close();
          stream.destroy();
        }
      } catch {
        // skip malformed
      }
    });

    rl.on("close", () => resolve(found));
    rl.on("error", () => resolve(false));
  });
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { searchParams } = new URL(request.url);
  const agentName = searchParams.get("name") || "";
  const runId = searchParams.get("runId") || "";
  const agentId = searchParams.get("agentId") || "";
  const cli = searchParams.get("cli");
  const cwd = searchParams.get("cwd") || process.cwd();
  const since = searchParams.get("since") || "";
  const useIdentifier = !!(runId && agentId);

  if (!agentName && !useIdentifier) {
    throw new BadRequest("name param required unless runId and agentId are provided", {
      field: "name",
    });
  }

  const providers = parseProviderList(cli);
  let workspacePaths = [cwd];
  let effectiveSince = since;

  if (runId) {
    try {
      const namespaceId = await getNamespaceIdFromRequest(request);
      const orgId = await getOrgIdFromRequest(request);
      const runsDir = resolveLinkRunsDir(namespaceId, orgId);
      const acl = await checkRunAccess(request, runId, runsDir);
      if (acl.ok) {
        const runDir = join(runsDir, runId);
        const runJson = readRunJson(join(runDir, "run.json"));
        const agent = runJson?.agents?.find((candidate) => candidate.id === agentId);
        workspacePaths = resolveAgentWorkspacePaths(
          join(runDir, "artifacts"),
          agentId,
          runJson?.workspacePath || cwd,
        );
        if (agent?.started) effectiveSince = agent.started;
      }
    } catch {
      // Preserve the request-provided cwd fallback when run context is absent.
    }
  }

  const jsonlDirs = resolveLogPaths(workspacePaths, providers);

  let files: { path: string; ctime: number }[];
  try {
    const sinceRaw = effectiveSince ? new Date(effectiveSince).getTime() : 0;
    const sinceMs = Number.isFinite(sinceRaw) ? sinceRaw : 0;
    // use birthtime (creation time) for filtering - agent conversations
    // are created when the run starts. also allow 60s before since
    // for clock skew
    const filterMs = sinceMs ? sinceMs - 60000 : 0;

    files = listConversationFiles(jsonlDirs, filterMs)
      // sort by proximity to since time (closest first)
      // this picks the conversation created nearest to run start
      .sort((a, b) => {
        if (sinceMs) {
          return Math.abs(a.ctime - sinceMs) - Math.abs(b.ctime - sinceMs);
        }
        return b.ctime - a.ctime;
      })
      .slice(0, MAX_FILES_PER_DIR);
  } catch {
    return apiSuccess({ conversationId: null });
  }

  // use unique identifier (runId + agentId) if provided - this is more precise
  for (const file of files) {
    let match = false;

    if (useIdentifier) {
      match = await checkAgentIdentifier(file.path, runId, agentId);
    } else {
      match = await checkFirstUserMessage(file.path, agentName);
    }

    if (match) {
      const conversationId = basename(file.path).replace(".jsonl", "");
      if (!conversationId) continue;
      return apiSuccess({ conversationId });
    }
  }

  return apiSuccess({ conversationId: null });
});
