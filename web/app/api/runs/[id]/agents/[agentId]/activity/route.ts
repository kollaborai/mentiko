import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { resolveLogDir } from "@/lib/runs/session-log-resolver";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { sanitizeOutput } from "@/lib/sanitize-output";
import { checkRunAccess } from "@/lib/auth/run-acl";
import { Unauthorized, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveLinkRunsDir } from "@/lib/links/link-run-runtime";

export const dynamic = "force-dynamic";

function safeRead(p: string): string | null {
  try { return existsSync(p) ? readFileSync(p, "utf-8") : null; } catch { return null; }
}

function safeJson<T>(p: string, fallback: T): T {
  const txt = safeRead(p);
  if (!txt) return fallback;
  try { return JSON.parse(txt) as T; } catch { return fallback; }
}

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

function parseConversationText(content: unknown): string {
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

function parseConversationContent(entry: Record<string, unknown>): unknown {
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

function parseConversationRole(entry: Record<string, unknown>): string {
  if (typeof entry.type === "string") return entry.type;

  const payload = isRecord(entry.payload) ? entry.payload : undefined;
  if (payload?.type === "message") {
    const payloadMessage = isRecord(payload.message) ? payload.message : undefined;
    if (typeof payloadMessage?.role === "string") return payloadMessage.role;
  }

  return "";
}

function parseConversationTimestamp(entry: Record<string, unknown>): string {
  if (typeof entry.timestamp === "string") return entry.timestamp;
  const message = isRecord(entry.message) ? entry.message : undefined;
  if (typeof message?.created_at === "string") return message.created_at;
  const payload = isRecord(entry.payload) ? entry.payload : undefined;
  if (typeof payload?.timestamp === "string") return payload.timestamp;
  return "";
}

function getToolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Array<{ type?: string; text?: string }>)
    .filter((c) => c.type === "text")
    .map((c) => c.text || "")
    .join("\n");
}

function parseConversationToolCalls(content: unknown): ToolCall[] {
  if (!Array.isArray(content)) return [];
  return (content as Array<{ type?: string; name?: string; input?: Record<string, unknown> }>)
    .filter((b) => b.type === "tool_use" && b.name)
    .map((b) => ({
      name: b.name!,
      label: toolLabel(b.name!, b.input ?? {}),
      input: b.input ?? {},
    }));
}

interface ToolCall {
  name: string;
  label: string;  // human-readable primary descriptor (file path, command, etc)
  input: Record<string, unknown>;
}

interface ConvMessage {
  role: string;
  content: string;
  toolCalls?: ToolCall[];
  ts?: string;
}

interface AgentSummary {
  status?: string;
  agentId?: string;
  agentName?: string;
  runId?: string;
  event?: string;
  executiveSummary?: string;
  workCompleted?: string[];
  artifactsProduced?: string[];
  codeChanges?: string[];
  findings?: string[];
  risks?: string[];
  nextAgentHints?: string[];
}

// derive a short human-readable label from a tool call's input
function toolLabel(name: string, input: Record<string, unknown>): string {
  const primary: Record<string, string[]> = {
    Read: ["file_path"],
    Write: ["file_path"],
    Edit: ["file_path"],
    Glob: ["pattern"],
    Bash: ["command"],
    Grep: ["pattern", "path"],
    WebFetch: ["url"],
    TaskCreate: ["subject"],
    TaskUpdate: ["taskId"],
    NotebookEdit: ["notebook_path"],
  };
  const keys = primary[name] ?? Object.keys(input);
  return keys.map((k) => String(input[k] ?? "").slice(0, 120)).filter(Boolean).join(" | ") || name;
}

// parse a JSONL conversation file into messages with tool calls
// entry types: user | assistant | system | progress | file-history-snapshot
// message.content: string | Array<{type: text|thinking|tool_use|tool_result, ...}>
function parseConversation(filePath: string): ConvMessage[] {
  const txt = safeRead(filePath);
  if (!txt) return [];

  const msgs: ConvMessage[] = [];

  for (const line of txt.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      const role = parseConversationRole(entry);
      if (role !== "user" && role !== "assistant") continue;

      const content = parseConversationContent(entry);
      const text = parseConversationText(content);
      const toolCalls = role === "assistant" ? parseConversationToolCalls(content) : [];
      const ts = parseConversationTimestamp(entry);

      if (text) {
        const msg: ConvMessage = { role, content: text, ts };
        if (toolCalls.length > 0) {
          msg.toolCalls = toolCalls;
        }
        msgs.push(msg);
      } else {
        // include tool events even if no visible text
        if (toolCalls.length > 0) {
          msgs.push({ role, content: "", toolCalls, ts });
        } else if (Array.isArray(content)) {
          for (const block of content as Array<{ type?: string; content?: unknown }>) {
            if (block?.type !== "tool_result") continue;
            const toolResult = getToolResultText(block.content);
            if (toolResult) {
              msgs.push({
                role,
                content: toolResult.slice(0, 2000),
                ts,
              });
            }
          }
        }
      }
    } catch { /* skip malformed lines */ }
  }

  return msgs;
}

export const GET = withErrorHandling(async (
  req: Request,
  context: { params: Promise<{ id: string; agentId: string }> }
) => {
  const { id: runId, agentId } = await context.params;
  const namespaceId = await getNamespaceIdFromRequest(req as Parameters<typeof getNamespaceIdFromRequest>[0]);
  const orgId = await getOrgIdFromRequest(req as Parameters<typeof getOrgIdFromRequest>[0]);
  const runsDir = resolveLinkRunsDir(namespaceId, orgId);
  const acl = await checkRunAccess(req, runId, runsDir);
  if (!acl.ok) {
    if (acl.reason === "run-not-found") throw new NotFound("Run", runId);
    throw new Unauthorized();
  }

  const artifactsDir = join(runsDir, runId, "artifacts");
  const hasArtifacts = existsSync(artifactsDir);

  const diff = hasArtifacts ? safeRead(join(artifactsDir, `${agentId}-diff.patch`)) : null;
  const filesChanged = hasArtifacts ? safeJson<Array<{ status: string; file: string }>>(
    join(artifactsDir, `${agentId}-files-changed.json`), []
  ) : [];

  // load conversations - read each JSONL file found
  const convMeta = hasArtifacts ? safeJson<Array<{ path: string }>>(
    join(artifactsDir, `${agentId}-conversations.json`), []
  ) : [];
  let conversations: Array<{ path: string; messages: ConvMessage[] }> = convMeta
    .filter((m) => m.path && existsSync(m.path))
    .map((m) => ({
      path: m.path,
      messages: parseConversation(m.path),
    }));

  // fallback: when no conversations captured in artifacts, resolve from session logs
  // this handles link runs where peer-manager may not have captured JSONL paths
  if (conversations.length === 0) {
    const runJson = safeJson<{
      started?: string;
      workspacePath?: string;
      agents?: Array<{ id: string; session?: string }>;
    } | null>(join(runsDir, runId, "run.json"), null);

    const searchParams = new URL(req.url).searchParams;
    const cli = searchParams.get("cli");

    if (runJson) {
      const agent = runJson.agents?.find((a) => a.id === agentId);
      const session = agent?.session;
      const cwd = runJson.workspacePath || process.cwd();
      const logDirs = resolveLogDirs(cwd, cli);

      if (session && logDirs.length > 0) {
        const startMs = runJson.started ? new Date(runJson.started).getTime() : 0;
        const agentName = session.replace(/-\d{8}-\d{6}$/, "").replace(/-/g, " ");
        try {
          const jsonlFiles = logDirs
            .flatMap((dir) =>
              readdirSync(dir)
                .filter((f) => f.endsWith(".jsonl"))
                .map((f) => {
                  const stat = statSync(join(dir, f));
                  return { name: f, path: join(dir, f), birthMs: stat.birthtimeMs };
                })
            )
            // files created within 2 minutes of run start
            .filter((f) => startMs ? Math.abs(f.birthMs - startMs) < 120000 : false)
            .sort((a, b) => Math.abs(a.birthMs - startMs) - Math.abs(b.birthMs - startMs));

          for (const jf of jsonlFiles) {
            const msgs = parseConversation(jf.path);
            if (msgs.length === 0) continue;

            const firstUser = msgs.find((m) => m.role === "user");
            const text = firstUser?.content || "";
            if (text.includes(agentName) || text.includes(session)) {
              conversations = [{ path: jf.path, messages: msgs }];
              break;
            }
          }

          // if no name match, try all files near start time and pick by content
          if (conversations.length === 0 && jsonlFiles.length > 0) {
            const agentIndex = runJson.agents?.findIndex((a) => a.id === agentId) ?? -1;
            const matchedFiles = jsonlFiles.filter((jf) => parseConversation(jf.path).length > 0);
            if (agentIndex >= 0 && agentIndex < matchedFiles.length) {
              const jf = matchedFiles[agentIndex];
              conversations = [{ path: jf.path, messages: parseConversation(jf.path) }];
            }
          }
        } catch { /* ignore filesystem errors */ }
      }
    }
  }

  const rawOutput = hasArtifacts ? safeRead(join(artifactsDir, `${agentId}-output.txt`)) : null;
  const output = rawOutput ? sanitizeOutput(rawOutput) : null;

  const eventData = hasArtifacts ? safeJson<{ agent_id: string; agent_name: string; event: string; session: string; timestamp: string } | null>(
    join(artifactsDir, `${agentId}-events.json`), null
  ) : null;

  const summary = hasArtifacts ? safeJson<AgentSummary | null>(
    join(artifactsDir, `${agentId}-summary.json`), null
  ) : null;
  const summaryMarkdown = hasArtifacts ? safeRead(join(artifactsDir, `${agentId}-summary.md`)) : null;

  return apiSuccess({
    agentId,
    runId,
    diff: diff || null,
    filesChanged,
    conversations,
    output: output?.trim() || null,
    event: eventData,
    summary,
    summaryMarkdown: summaryMarkdown?.trim() || null,
  });
});
