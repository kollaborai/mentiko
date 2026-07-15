import { NextResponse } from "next/server";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import config, { orgPath } from "@/lib/config";
import { requireOpsAuth } from "@/lib/ai-engine/mentiko-mcp-ops-auth";
import { readLogs, type LogEntry, type LogLevel } from "@/lib/system/system-logger";
import { parseRunnerEvent } from "@/lib/runner-v2/events";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 2 * 1024 * 1024;
const MAX_DIR_ENTRIES = 500;
const MAX_LOG_LIMIT = 500;
const RUN_ID_RE = /^[a-zA-Z0-9._:-]+$/;

const RUNTIME_SUBTREES = [
  "events",
  "runs",
  "watchdog-hooks",
  "reports",
] as const;

type RuntimeSubtree = (typeof RUNTIME_SUBTREES)[number];

interface RuntimeRoot {
  label: RuntimeSubtree;
  path: string;
}

interface RuntimePath {
  path: string;
  root: string;
}

interface RunJson {
  id?: string;
  runId?: string;
  status?: string;
  chain?: string;
  chainId?: string;
  error?: string;
  agents?: Array<{
    id?: string;
    name?: string;
    status?: string;
    startedAt?: string;
    completedAt?: string;
    error?: string;
    session?: string;
    sessionName?: string;
  }>;
  [key: string]: unknown;
}

function runtimeRoots(namespaceId: string, orgId: string): RuntimeRoot[] {
  const root = orgPath(namespaceId, orgId);
  return RUNTIME_SUBTREES.map((label) => ({
    label,
    path: label === "events"
      ? config.eventsDir
      : label === "runs"
        ? config.runsDir
        : join(root, label),
  }));
}

function resolveRuntimePath(rawPath: string, namespaceId: string, orgId: string): RuntimePath | null {
  if (!rawPath || rawPath.includes("\0")) return null;

  const roots = runtimeRoots(namespaceId, orgId);
  const matchingRoot = roots.find((root) => (
    rawPath === root.label ||
    rawPath.startsWith(`${root.label}/`) ||
    rawPath === root.path ||
    rawPath.startsWith(`${root.path}/`)
  ));
  if (!matchingRoot) return null;

  const pathWithinRoot = rawPath.startsWith(matchingRoot.path)
    ? rawPath.slice(matchingRoot.path.length)
    : rawPath.slice(matchingRoot.label.length);
  const cleanedRelative = pathWithinRoot.replace(/^\/+/, "");
  const resolved = resolve(matchingRoot.path, cleanedRelative || ".");
  const rootResolved = resolve(matchingRoot.path);
  if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}/`)) {
    return null;
  }
  return { path: resolved, root: rootResolved };
}

function realPathInRoot(path: string, root: string): boolean {
  const real = realpathSync(path);
  const realRoot = existsSync(root) ? realpathSync(root) : resolve(root);
  return real === realRoot || real.startsWith(`${realRoot}/`);
}

function safeRunId(runId: string | null): string | null {
  if (!runId || !RUN_ID_RE.test(runId) || runId.includes("..") || runId.includes("/")) {
    return null;
  }
  return runId;
}

function readRunJson(runId: string): RunJson | null {
  const runPath = join(config.runsDir, runId, "run.json");
  if (!existsSync(runPath)) return null;
  return JSON.parse(readFileSync(runPath, "utf-8")) as RunJson;
}

function deriveRunDiagnostics(run: RunJson) {
  const agents = Array.isArray(run.agents) ? run.agents : [];
  const lastCompletedAgent = [...agents].reverse().find((agent) => (
    agent.status === "completed" || agent.status === "success"
  )) ?? null;
  const pendingAgent = agents.find((agent) => (
    agent.status === "pending" ||
    agent.status === "running" ||
    agent.status === "stalled" ||
    agent.status === "waiting"
  )) ?? null;
  const failedAgent = agents.find((agent) => agent.status === "failed" || agent.error) ?? null;

  return {
    status: run.status ?? "unknown",
    chain: run.chain ?? run.chainId ?? null,
    agentCount: agents.length,
    lastCompletedAgent,
    pendingAgent,
    failedAgent,
    hasError: Boolean(run.error || failedAgent),
    error: run.error ?? failedAgent?.error ?? null,
  };
}

function findRunEvents(runId: string) {
  const eventsDir = config.eventsDir;
  if (!existsSync(eventsDir)) return [];

  return readdirSync(eventsDir, { withFileTypes: true, encoding: "utf8" })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".event"))
    .slice(0, MAX_DIR_ENTRIES)
    .flatMap((entry) => {
      const eventPath = join(eventsDir, entry.name);
      const stat = statSync(eventPath);
      let content = "";
      if (stat.size > MAX_FILE_SIZE) return [];
      content = readFileSync(eventPath, "utf-8");
      try {
        const parsed = parseRunnerEvent(content);
        if (parsed.runId !== runId) return [];
        return [{
          name: entry.name,
          path: eventPath,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          content,
          parsed,
        }];
      } catch {
        return [];
      }
    });
}

function parseLimit(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), MAX_LOG_LIMIT);
}

function filterLogs(entries: LogEntry[], params: URLSearchParams): LogEntry[] {
  const level = params.get("level") as LogLevel | null;
  const source = params.get("source");
  const query = params.get("query") || params.get("text");
  const since = params.get("since");
  const until = params.get("until");
  const sinceTime = since ? Date.parse(since) : null;
  const untilTime = until ? Date.parse(until) : null;
  const q = query?.toLowerCase();

  return entries.filter((entry) => {
    if (level && entry.level !== level) return false;
    if (source && entry.source !== source) return false;
    if (q) {
      const haystack = `${entry.source} ${entry.message} ${entry.detail ?? ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    const entryTime = Date.parse(entry.ts);
    if (sinceTime && entryTime < sinceTime) return false;
    if (untilTime && entryTime > untilTime) return false;
    return true;
  });
}

export async function GET(req: Request) {
  const ctx = await requireOpsAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  const { namespaceId, orgId } = ctx;
  if (namespaceId !== config.namespaceId || orgId !== config.orgId) {
    return new NextResponse("Runtime ops only supports the configured project scope", { status: 400 });
  }
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action") || "read_file";

  if (action === "read_file") {
    const requestedPath = searchParams.get("path") || "";
    const resolvedPath = resolveRuntimePath(requestedPath, namespaceId, orgId);
    if (!resolvedPath) return new NextResponse("Path outside allowed runtime roots", { status: 403 });
    const absPath = resolvedPath.path;
    if (!existsSync(absPath)) return new NextResponse("Not found", { status: 404 });
    if (!realPathInRoot(absPath, resolvedPath.root)) {
      return new NextResponse("Path outside allowed runtime roots", { status: 403 });
    }

    const stat = statSync(absPath);
    if (!stat.isFile()) return new NextResponse("Not a file", { status: 400 });
    if (stat.size > MAX_FILE_SIZE) return new NextResponse("File too large", { status: 413 });

    return NextResponse.json({
      path: absPath,
      content: readFileSync(absPath, "utf-8"),
      size: stat.size,
    });
  }

  if (action === "list_dir") {
    const requestedPath = searchParams.get("path") || "";
    const resolvedPath = resolveRuntimePath(requestedPath, namespaceId, orgId);
    if (!resolvedPath) return new NextResponse("Path outside allowed runtime roots", { status: 403 });
    const absPath = resolvedPath.path;
    if (!existsSync(absPath)) return new NextResponse("Not found", { status: 404 });
    if (!realPathInRoot(absPath, resolvedPath.root)) {
      return new NextResponse("Path outside allowed runtime roots", { status: 403 });
    }

    const stat = statSync(absPath);
    if (!stat.isDirectory()) return new NextResponse("Not a directory", { status: 400 });
    const entries = readdirSync(absPath, { withFileTypes: true, encoding: "utf8" })
      .slice(0, MAX_DIR_ENTRIES)
      .map((entry) => {
        const entryPath = join(absPath, entry.name);
        const entryStat = statSync(entryPath);
        return {
          name: entry.name,
          type: entry.isDirectory() ? "dir" : "file",
          path: entryPath,
          relativePath: relative(orgPath(namespaceId, orgId), entryPath),
          size: entryStat.size,
          modifiedAt: entryStat.mtime.toISOString(),
        };
      });
    return NextResponse.json({ path: absPath, entries, truncated: entries.length >= MAX_DIR_ENTRIES });
  }

  if (action === "get_run_state") {
    const runId = safeRunId(searchParams.get("runId"));
    if (!runId) return new NextResponse("Invalid runId", { status: 400 });
    const run = readRunJson(runId);
    if (!run) return new NextResponse("Run not found", { status: 404 });
    return NextResponse.json({
      runId,
      path: join(config.runsDir, runId, "run.json"),
      run,
      diagnostics: deriveRunDiagnostics(run),
    });
  }

  if (action === "get_run_events") {
    const runId = safeRunId(searchParams.get("runId"));
    if (!runId) return new NextResponse("Invalid runId", { status: 400 });
    return NextResponse.json({ runId, events: findRunEvents(runId) });
  }

  if (action === "get_system_logs") {
    const limit = parseLimit(searchParams.get("limit"), 200);
    const entries = filterLogs(readLogs(namespaceId, orgId, limit), searchParams);
    return NextResponse.json({ logs: entries, limit });
  }

  if (action === "roots") {
    return NextResponse.json({
      roots: runtimeRoots(namespaceId, orgId).map((root) => ({
        label: root.label,
        path: root.path,
        exists: existsSync(root.path),
      })),
    });
  }

  return new NextResponse(`Unknown action: ${action}`, { status: 400 });
}
