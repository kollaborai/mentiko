import { NextRequest } from "next/server";
import { readdirSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { config } from "@/lib/config";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { emitRunnerEvent } from "@/lib/runner-v2/event-emitter";
import { serializeRunnerEvent } from "@/lib/runner-v2/events";

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
  const eventName = body.event;
  const source = body.source === undefined ? "manual" : body.source;
  const data = body.data === undefined ? "" : body.data;

  if (!eventName || typeof eventName !== "string") {
    throw new BadRequest("event name required");
  }
  if (typeof source !== "string") {
    throw new BadRequest("source must be a string");
  }
  if (typeof data !== "string") {
    throw new BadRequest("data must be a string");
  }

  const eventsDir = config.eventsDir;
  mkdirSync(eventsDir, { recursive: true });

  const timestamp = new Date().toISOString();
  const filenameTimestamp = timestamp.replace(/[:.]/g, "-").slice(0, 19);
  const filename = `${filenameTimestamp}-${eventName}.event`;
  const runId = typeof body.runId === "string" ? body.runId : "";

  try {
    serializeRunnerEvent({
      event: eventName,
      source,
      runId,
      timestamp,
      data,
    });
  } catch (error) {
    throw new BadRequest(error instanceof Error ? error.message : "Invalid runner event");
  }

  let emitted;
  try {
    emitted = emitRunnerEvent({
      event: eventName,
      source,
      runId,
      scope: runId ? "run" : "ingress",
      filenameMode: "api",
      filename,
      timestamp,
      eventsDir,
      data,
    });
  } catch (error) {
    if (error instanceof Error && /run lifecycle event .* cannot use ingress scope/.test(error.message)) {
      throw new BadRequest(error.message);
    }
    throw error;
  }

  return apiSuccess({ success: true, filename: emitted.filename, path: emitted.path });
});
