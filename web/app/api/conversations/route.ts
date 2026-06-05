import { NextRequest } from "next/server";
import { readdirSync, statSync, createReadStream } from "fs";
import { join } from "path";
import { createInterface } from "readline";
import { checkAuth } from "@/lib/auth/api-auth";
import { resolveLogDir } from "@/lib/runs/session-log-resolver";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function uniqueArray(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function parseProviderList(raw: string | null): string[] {
  if (!raw) return ["codex", "claude-code"];
  const providers = raw.split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
  return providers.length ? providers : ["codex", "claude-code"];
}

function resolveLogDirs(cwd: string, cli: string | null): string[] {
  const rawInputs = uniqueArray([cwd || process.cwd(), process.cwd()]);
  const providers = uniqueArray(parseProviderList(cli));
  const dirs: string[] = [];
  for (const input of rawInputs) {
    for (const provider of providers) {
      const dir = resolveLogDir(provider, input);
      if (!dir || dirs.includes(dir)) continue;
      if (statSyncSafe(dir)) dirs.push(dir);
    }
  }
  return dirs;
}

function statSyncSafe(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function extractContent(entry: Record<string, unknown>): unknown {
  const message = isRecord(entry.message) ? entry.message : undefined;
  if (message?.content !== undefined) return message.content;

  const payload = isRecord(entry.payload) ? entry.payload : undefined;
  if (payload?.type === "message") {
    const payloadMessage = isRecord(payload.message) ? payload.message : undefined;
    if (payloadMessage?.content !== undefined) return payloadMessage.content;
  }

  return "";
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  for (const block of content as Array<Record<string, unknown>>) {
    if (!isRecord(block)) continue;
    const type = typeof block.type === "string" ? block.type : "";
    if (type !== "text" && type !== "input_text" && type !== "output_text") continue;
    if (typeof block.text === "string") return block.text;
  }
  return "";
}

function isUserEntry(entry: Record<string, unknown>): boolean {
  const type = typeof entry.type === "string" ? entry.type : "";
  if (type === "user") return true;

  const payload = isRecord(entry.payload) ? entry.payload : undefined;
  if (payload?.type === "message") {
    const payloadMessage = isRecord(payload.message) ? payload.message : undefined;
    return payloadMessage?.role === "user";
  }
  return false;
}

interface ConversationSummary {
  sessionId: string;
  slug: string;
  startTime: string;
  lastModified: string;
  sizeKb: number;
  messageCount: number;
  firstMessage: string;
  agentRole: string;
}

async function parseJsonlSummary(filePath: string): Promise<Partial<ConversationSummary>> {
  return new Promise((resolve) => {
    const result: Partial<ConversationSummary> = {
      slug: "",
      messageCount: 0,
      firstMessage: "",
      agentRole: "",
    };

    const stream = createReadStream(filePath, { encoding: "utf-8" });
    const rl = createInterface({ input: stream });
    let lineCount = 0;

    rl.on("line", (line) => {
      lineCount++;
      // only parse first 50 lines for summary (perf)
      if (lineCount > 50) {
        rl.close();
        stream.destroy();
        return;
      }

      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        if (!isRecord(obj)) return;

        if (!result.slug && typeof obj.slug === "string") {
          result.slug = obj.slug;
        }

        const role = typeof obj.type === "string" ? obj.type : "";
        if (role === "user" || role === "assistant") {
          result.messageCount = (result.messageCount || 0) + 1;
        }

        // extract first user message as preview
        if (!result.firstMessage && isUserEntry(obj)) {
          const content = extractContent(obj);
          if (typeof content === "string") {
            result.firstMessage = content.slice(0, 200);
          } else if (Array.isArray(content)) {
            const text = extractText(content);
            if (text) {
              result.firstMessage = text.slice(0, 200);
            }
          }

          // detect agent type from first message content
          const msg = (result.firstMessage || "").toLowerCase();
          // chain-spawned agents start with "you are: <role>"
          const roleMatch = msg.match(/^you are:\s*(.+?)[\n\r]/);
          if (roleMatch) {
            result.agentRole = roleMatch[1].trim();
          } else if (msg.includes("codex")) {
            result.agentRole = "codex";
          } else if (msg.includes("kollab")) {
            result.agentRole = "kollab";
          } else if (msg.includes("aider")) {
            result.agentRole = "aider";
          } else {
            result.agentRole = "claude";
          }
        }
      } catch {
        // skip malformed lines
      }
    });

    rl.on("close", () => resolve(result));
    rl.on("error", () => resolve(result));
  });
}

// count total messages by scanning full file (separate pass for accuracy)
async function countMessages(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    let count = 0;
    const stream = createReadStream(filePath, { encoding: "utf-8" });
    const rl = createInterface({ input: stream });

    rl.on("line", (line) => {
      try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (!isRecord(obj)) return;
      const role = typeof obj.type === "string" ? obj.type : "";
      if (role === "user" || role === "assistant") count++;
      } catch {
        // skip
      }
    });

    rl.on("close", () => resolve(count));
    rl.on("error", () => resolve(count));
  });
}

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { searchParams } = new URL(request.url);
  const cwd = searchParams.get("cwd") || process.cwd();
  const limit = parseInt(searchParams.get("limit") || "20", 10);
  const countAll = searchParams.get("countAll") === "true";
  const cli = searchParams.get("cli");

  const jsonlDirs = resolveLogDirs(cwd, cli);

  let files: string[];
  try {
    files = jsonlDirs
      .flatMap((jsonlDir) =>
        readdirSync(jsonlDir)
          .filter((f) => f.endsWith(".jsonl"))
          .map((f) => {
            const stat = statSync(join(jsonlDir, f));
            return {
              dir: jsonlDir,
              name: f,
              mtime: stat.mtimeMs,
              size: stat.size,
            };
          })
      )
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit)
      .map((f) => `${f.dir}::${f.name}`);
  } catch {
    return apiSuccess({ conversations: [], dir: jsonlDirs, error: "directory not found" });
  }

  const conversations: ConversationSummary[] = [];

  for (const file of files) {
    const [dir, fileName] = file.split("::");
    const filePath = join(dir, fileName);
    const stat = statSync(filePath);
    const sessionId = fileName.replace(".jsonl", "");

    const summary = await parseJsonlSummary(filePath);
    const msgCount = countAll ? await countMessages(filePath) : (summary.messageCount || 0);

    conversations.push({
      sessionId,
      slug: summary.slug || "",
      startTime: stat.birthtime.toISOString(),
      lastModified: stat.mtime.toISOString(),
      sizeKb: Math.round(stat.size / 1024),
      messageCount: msgCount,
      firstMessage: summary.firstMessage || "",
      agentRole: summary.agentRole || "",
    });
  }

  return apiSuccess({ conversations, dir: jsonlDirs });
});
