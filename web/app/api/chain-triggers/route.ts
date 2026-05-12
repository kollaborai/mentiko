import { NextRequest } from "next/server";
import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { config } from "@/lib/config";
import { requirePermission } from "@/lib/rbac-auth";
import { BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export interface ChainEventTrigger {
  event: string;
  source_chain?: string;
  condition?: string;
  pass_data?: boolean;
}

export interface ChainTriggerEntry {
  chain_name: string;
  chain_path: string;
  triggers: ChainEventTrigger[];
}

/**
 * GET /api/chain-triggers
 * Returns all event_triggers configured across all chains in the namespace.
 * Used by the UI to show the event-driven trigger graph.
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const chainsDir = config.chainsDir;
  const entries: ChainTriggerEntry[] = [];

  if (!existsSync(chainsDir)) {
    return apiSuccess({ triggers: [] });
  }

  const chainDirs = readdirSync(chainsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const chainName of chainDirs) {
    const chainFile = join(chainsDir, chainName, "chain.json");
    if (!existsSync(chainFile)) continue;

    try {
      const chain = JSON.parse(readFileSync(chainFile, "utf-8"));
      const triggers: ChainEventTrigger[] = chain?.config?.event_triggers ?? [];
      if (triggers.length > 0) {
        entries.push({
          chain_name: chainName,
          chain_path: chainFile,
          triggers,
        });
      }
    } catch {
      // skip malformed chain files
    }
  }

  return apiSuccess({ triggers: entries });
});

/**
 * POST /api/chain-triggers
 * Emit a test event to the namespace events dir.
 * Body: { event: string, source?: string, data?: string }
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const body = await request.json();
  const eventName = body.event as string;
  const source = (body.source as string) || "manual";
  const data = (body.data as string) || "";

  if (!eventName || typeof eventName !== "string") {
    throw new BadRequest("event name required");
  }

  const eventsDir = config.eventsDir;
  mkdirSync(eventsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `${timestamp}-${eventName}.event`;
  const filePath = join(eventsDir, filename);

  const content = [
    `event: ${eventName}`,
    `source: ${source}`,
    `timestamp: ${new Date().toISOString()}`,
    `processed: false`,
    `data: ${data}`,
  ].join("\n") + "\n";

  writeFileSync(filePath, content, "utf-8");

  return apiSuccess({ success: true, filename, path: filePath });
});
