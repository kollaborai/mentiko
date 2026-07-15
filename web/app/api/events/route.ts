import { NextRequest } from "next/server";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import config from "@/lib/config";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/auth/api-auth";
import { parseRunnerEvent } from "@/lib/runner-v2/events";

export const dynamic = "force-dynamic";

interface AgentEvent {
  filename: string;
  event: string;
  source: string;
  timestamp: string;
  processed: boolean;
  data: string;
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const dir = config.eventsDir;

  if (!existsSync(dir)) {
    return apiSuccess({ events: [] });
  }

  const events: AgentEvent[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile()) {
        const name = entry.name.toLowerCase();
        if (name.endsWith(".event")) {
          const fullPath = join(dir, entry.name);
          try {
            const parsed = parseRunnerEvent(readFileSync(fullPath, "utf-8"));
            events.push({
              filename: entry.name,
              event: parsed.event,
              source: parsed.source,
              timestamp: parsed.timestamp,
              processed: parsed.processed,
              data: parsed.data,
            });
          } catch {
            // Invalid raw event files are excluded; the Data Shapes catalog reports their drift.
          }
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
