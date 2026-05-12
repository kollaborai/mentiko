import { NextRequest } from "next/server";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { getNamespaceConfig } from "@/lib/namespace-config";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

interface AgentEvent {
  filename: string;
  event: string;
  source: string;
  timestamp: string;
  processed: boolean;
  data: string;
}

function parseEventFile(content: string): Partial<AgentEvent> {
  const result: Partial<AgentEvent> = {};
  const lines = content.split("\n");
  const dataLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("event:")) {
      result.event = trimmed.slice(6).trim();
    } else if (trimmed.startsWith("source:")) {
      result.source = trimmed.slice(7).trim();
    } else if (trimmed.startsWith("timestamp:")) {
      result.timestamp = trimmed.slice(10).trim();
    } else if (trimmed.startsWith("processed:")) {
      const val = trimmed.slice(10).trim().toLowerCase();
      result.processed = val === "true";
    } else if (trimmed.startsWith("data:")) {
      dataLines.push(trimmed.slice(5).trim());
    } else if (trimmed && !trimmed.includes(":")) {
      dataLines.push(trimmed);
    }
  }

  result.data = dataLines.join(" ").trim();
  return result;
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceConfig = await getNamespaceConfig(request);
  const { searchParams } = new URL(request.url);
  const dir = searchParams.get("dir") || namespaceConfig.eventsDir;

  if (!existsSync(dir)) {
    return apiSuccess({ events: [] });
  }

  const events: AgentEvent[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile()) {
        const name = entry.name.toLowerCase();
        if (name.endsWith(".event") || name.endsWith(".md") || name.endsWith(".json")) {
          const fullPath = join(dir, entry.name);
          const content = readFileSync(fullPath, "utf-8");
          const parsed = parseEventFile(content);

          events.push({
            filename: entry.name,
            event: parsed.event || "unknown",
            source: parsed.source || "unknown",
            timestamp: parsed.timestamp || new Date().toISOString(),
            processed: parsed.processed ?? false,
            data: parsed.data || "",
          });
        }
      }
    }
  } catch {
    // return empty on error
  }

  events.sort((a, b) => {
    const da = new Date(a.timestamp).getTime();
    const db = new Date(b.timestamp).getTime();
    return db - da;
  });

  return apiSuccess({ events });
});
