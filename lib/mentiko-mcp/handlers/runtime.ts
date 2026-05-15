import { opsGet } from "./ops-client.js";

export async function readRuntimeFile(path: string) {
  return await opsGet<{ path: string; content: string; size: number }>(
    "/api/mentiko-mcp/ops/runtime",
    { action: "read_file", path },
  );
}

export async function listRuntimeDir(path: string) {
  return await opsGet(
    "/api/mentiko-mcp/ops/runtime",
    { action: "list_dir", path },
  );
}

export async function getRunState(runId: string) {
  return await opsGet(
    "/api/mentiko-mcp/ops/runtime",
    { action: "get_run_state", runId },
  );
}

export async function getRunEvents(runId: string) {
  return await opsGet(
    "/api/mentiko-mcp/ops/runtime",
    { action: "get_run_events", runId },
  );
}

export async function getSystemLogs(input: {
  level?: string;
  source?: string;
  query?: string;
  since?: string;
  until?: string;
  limit?: number;
} = {}) {
  const query: Record<string, string> = { action: "get_system_logs" };
  if (input.level) query.level = input.level;
  if (input.source) query.source = input.source;
  if (input.query) query.query = input.query;
  if (input.since) query.since = input.since;
  if (input.until) query.until = input.until;
  if (input.limit) query.limit = String(input.limit);
  return await opsGet("/api/mentiko-mcp/ops/runtime", query);
}

