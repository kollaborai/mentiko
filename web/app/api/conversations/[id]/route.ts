import { NextRequest } from "next/server";
import { createReadStream, statSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { createInterface } from "readline";
import { checkAuth } from "@/lib/api-auth";
import { resolveLogDir } from "@/lib/session-log-resolver";
import { NotFound, BadRequest, Unauthorized } from "@/lib/api-errors";
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
      if (existsSync(dir)) dirs.push(dir);
    }
  }
  return dirs;
}

function resolveConversationPath(cwd: string, id: string, cli: string | null): string | null {
  const logDirs = resolveLogDirs(cwd, cli);
  for (const dir of logDirs) {
    const candidate = join(dir, `${id}.jsonl`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function extractConversationContent(entry: Record<string, unknown>): unknown {
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

function extractConversationText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Array<Record<string, unknown>>)
    .map((block) => {
      if (!isRecord(block)) return "";
      const type = typeof block.type === "string" ? block.type : "";
      const text = typeof block.text === "string" ? block.text : "";
      if (!text) return "";
      if (type === "text" || type === "input_text" || type === "output_text") return text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function extractConversationRole(entry: Record<string, unknown>): "user" | "assistant" | "" {
  if (typeof entry.type === "string") {
    if (entry.type === "user" || entry.type === "assistant") {
      return entry.type;
    }
  }
  const payload = isRecord(entry.payload) ? entry.payload : undefined;
  if (payload?.type === "message") {
    const payloadMessage = isRecord(payload.message) ? payload.message : undefined;
    if (typeof payloadMessage?.role === "string") {
      if (payloadMessage.role === "user" || payloadMessage.role === "assistant") {
        return payloadMessage.role;
      }
    }
  }
  return "";
}

function extractConversationTimestamp(entry: Record<string, unknown>): string {
  if (typeof entry.timestamp === "string") return entry.timestamp;
  const message = isRecord(entry.message) ? entry.message : undefined;
  if (typeof message?.created_at === "string") return message.created_at;
  const payload = isRecord(entry.payload) ? entry.payload : undefined;
  if (typeof payload?.timestamp === "string") return payload.timestamp;
  return "";
}

function extractToolResult(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Array<{ type?: string; text?: string }>)
    .filter((c) => c.type === "text")
    .map((c) => c.text || "")
    .join("\n");
}

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string | Array<{ type: string; text?: string }>;
  id?: string;
}

interface ParsedMessage {
  type: "user" | "assistant" | "tool_use" | "tool_result";
  timestamp?: string;
  text?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  toolId?: string;
}

async function parseConversation(
  filePath: string,
  offset: number,
  limit: number
): Promise<{ messages: ParsedMessage[]; total: number; sessionId: string; slug: string }> {
  return new Promise((resolve) => {
    const messages: ParsedMessage[] = [];
    let total = 0;
    let slug = "";
    let sessionId = "";

    const stream = createReadStream(filePath, { encoding: "utf-8" });
    const rl = createInterface({ input: stream });

    rl.on("line", (line) => {
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;

        if (!isRecord(obj)) return;

        if (!sessionId && typeof obj.sessionId === "string") sessionId = obj.sessionId;
        if (!slug && typeof obj.slug === "string") slug = obj.slug;

        const role = extractConversationRole(obj);
        if (!role) return;

        total++;
        if (total <= offset) return;
        if (messages.length >= limit) return;

        const content = extractConversationContent(obj);
        const timestamp = extractConversationTimestamp(obj);

        if (typeof content === "string") {
          messages.push({
            type: role,
            timestamp,
            text: content,
          });
        } else if (Array.isArray(content)) {
          for (const block of content as ContentBlock[]) {
            if (block.type === "text" && block.text) {
              messages.push({
                type: role,
                timestamp,
                text: block.text,
              });
            } else if (block.type === "tool_use") {
              messages.push({
                type: "tool_use",
                timestamp,
                toolName: block.name,
                toolInput: block.input as Record<string, unknown>,
                toolId: block.id,
              });
            } else if (block.type === "tool_result") {
              const resultText = extractToolResult(block.content);
              messages.push({
                type: "tool_result",
                timestamp,
                toolResult: resultText.slice(0, 2000), // cap result size
                toolId: block.id,
              });
            }
          }
        }
      } catch {
        // skip malformed
      }
    });

    rl.on("close", () => resolve({ messages, total, sessionId, slug }));
    rl.on("error", () => resolve({ messages, total, sessionId, slug }));
  });
}

// stream the last N messages (tail mode for live watching)
async function tailConversation(
  filePath: string,
  tailCount: number
): Promise<{ messages: ParsedMessage[]; total: number; slug: string }> {
  return new Promise((resolve) => {
    const allMessages: ParsedMessage[] = [];
    let slug = "";

    const stream = createReadStream(filePath, { encoding: "utf-8" });
    const rl = createInterface({ input: stream });

    rl.on("line", (line) => {
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        if (!isRecord(obj)) return;

        if (!slug && typeof obj.slug === "string") slug = obj.slug;
        const role = extractConversationRole(obj);
        if (!role) return;

        const content = extractConversationContent(obj);
        const timestamp = extractConversationTimestamp(obj);

        if (typeof content === "string") {
          allMessages.push({ type: role, timestamp, text: content });
        } else if (Array.isArray(content)) {
          for (const block of content as ContentBlock[]) {
            if (block.type === "text" && block.text) {
              allMessages.push({ type: role, timestamp, text: block.text });
            } else if (block.type === "tool_use") {
              allMessages.push({
                type: "tool_use",
                timestamp,
                toolName: block.name,
                toolInput: block.input as Record<string, unknown>,
                toolId: block.id,
              });
            } else if (block.type === "tool_result") {
              const resultText = extractToolResult(block.content);
              allMessages.push({
                type: "tool_result",
                timestamp,
                toolResult: resultText.slice(0, 2000),
                toolId: block.id,
              });
            }
          }
        }
      } catch {
        // skip
      }
    });

    rl.on("close", () => {
      const total = allMessages.length;
      const messages = allMessages.slice(-tailCount);
      resolve({ messages, total, slug });
    });
    rl.on("error", () => resolve({ messages: [], total: 0, slug }));
  });
}

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { id } = await context.params;
  const { searchParams } = new URL(request.url);
  const cwd = searchParams.get("cwd") || process.cwd();
  const mode = searchParams.get("mode") || "tail";
  const cli = searchParams.get("cli");
  const tail = parseInt(searchParams.get("tail") || "50", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  const filePath = resolveConversationPath(cwd, id, cli);
  if (!filePath) {
    throw new NotFound("Conversation", id);
  }

  if (mode === "tail") {
    const result = await tailConversation(filePath, tail);
    return apiSuccess(result);
  } else {
    const result = await parseConversation(filePath, offset, limit);
    return apiSuccess(result);
  }
});

// PUT /api/conversations/[id] - update conversation slug (title)
export const PUT = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { id } = await context.params;
  const { searchParams } = new URL(request.url);
  const cwd = searchParams.get("cwd") || process.cwd();
  const cli = searchParams.get("cli");
  const body = await request.json();
  const newSlug = body?.slug?.trim();

  if (!newSlug) {
    throw new BadRequest("slug is required", { field: "slug" });
  }

  const filePath = resolveConversationPath(cwd, id, cli);

  if (!filePath || !existsSync(filePath)) {
    throw new NotFound("Conversation", id);
  }

  // Read all lines, update slug in lines that have it
  const lines: string[] = [];
  let slugUpdated = false;

  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream });

  for await (const line of rl) {
    try {
      const obj = JSON.parse(line);
      // Update slug if present (usually in first line or early lines)
      if (obj.slug !== undefined) {
        obj.slug = newSlug;
        slugUpdated = true;
        lines.push(JSON.stringify(obj));
      } else {
        lines.push(line);
      }
    } catch {
      lines.push(line);
    }
  }

  // If no slug field found, try to add it to the first line
  if (!slugUpdated && lines.length > 0) {
    try {
      const firstObj = JSON.parse(lines[0]);
      firstObj.slug = newSlug;
      lines[0] = JSON.stringify(firstObj);
      slugUpdated = true;
    } catch {
      // First line not valid JSON, prepend a slug line
      lines.unshift(JSON.stringify({ slug: newSlug, type: "meta" }));
      slugUpdated = true;
    }
  }

  // Write back
  writeFileSync(filePath, lines.join("\n") + "\n");

  return apiSuccess({ success: true, slug: newSlug });
});

// DELETE /api/conversations/[id] - delete conversation
export const DELETE = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { id } = await context.params;
  const { searchParams } = new URL(request.url);
  const cwd = searchParams.get("cwd") || process.cwd();
  const cli = searchParams.get("cli");

  const filePath = resolveConversationPath(cwd, id, cli);

  if (!filePath || !existsSync(filePath)) {
    throw new NotFound("Conversation", id);
  }

  unlinkSync(filePath);

  return apiSuccess({ success: true, deleted: id });
});
