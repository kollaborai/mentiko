import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { createHash } from "crypto";
import { orgPath } from "@/lib/config";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { Unauthorized, BadRequest, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

interface EventTrigger {
  id: string;
  sourceChain: string;
  emitEvent: string;
  targetChain: string;
  triggerEvent: string;
  enabled: boolean;
  createdAt?: string;
}

function triggerId(sourceChain: string, emitEvent: string, targetChain: string, triggerEvent: string): string {
  return `trigger-${createHash("sha1")
    .update([sourceChain, emitEvent, targetChain, triggerEvent].join("\0"))
    .digest("hex")
    .slice(0, 12)}`;
}

function fromRuntimeTrigger(chain: { name?: string }, trigger: Record<string, unknown>): EventTrigger {
  const sourceChain = typeof trigger.source_chain === "string" ? trigger.source_chain : "";
  const triggerEvent = typeof trigger.event === "string" ? trigger.event : "";
  const emitEvent = typeof trigger.emit_event === "string" ? trigger.emit_event : triggerEvent;
  const targetChain = chain.name || "";
  return {
    id: typeof trigger.id === "string" && trigger.id
      ? trigger.id
      : triggerId(sourceChain, emitEvent, targetChain, triggerEvent),
    sourceChain,
    emitEvent,
    targetChain,
    triggerEvent,
    enabled: trigger.enabled !== false,
    ...(typeof trigger.created_at === "string" && trigger.created_at ? { createdAt: trigger.created_at } : {}),
  };
}

async function readChainFiles(namespaceId: string, orgId: string) {
  const chainsDir = orgPath(namespaceId, orgId, "chains");
  const entries = await fs.readdir(chainsDir, { withFileTypes: true }).catch(() => []);
  const chains: Array<{ file: string; chain: Record<string, unknown> }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(chainsDir, entry.name, "chain.json");
    try {
      const chain = JSON.parse(await fs.readFile(file, "utf-8")) as Record<string, unknown>;
      chains.push({ file, chain });
    } catch {
      // skip malformed/missing chain files
    }
  }

  return chains;
}

async function findTrigger(namespaceId: string, orgId: string, id: string) {
  const chains = await readChainFiles(namespaceId, orgId);
  for (const item of chains) {
    const config = (item.chain.config && typeof item.chain.config === "object" ? item.chain.config : {}) as {
      event_triggers?: Record<string, unknown>[];
    };
    const eventTriggers = Array.isArray(config.event_triggers) ? config.event_triggers : [];
    const index = eventTriggers.findIndex((trigger) => {
      const view = fromRuntimeTrigger({ name: String(item.chain.name || "") }, trigger);
      return view.id === id;
    });
    if (index >= 0) return { ...item, config, eventTriggers, index };
  }
  throw new NotFound("Event trigger", id);
}

async function writeChain(file: string, chain: Record<string, unknown>): Promise<void> {
  await fs.writeFile(file, `${JSON.stringify(chain, null, 2)}\n`);
}

export const PATCH = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { id } = await params;
  const body = await request.json();
  const { enabled } = body;

  if (typeof enabled !== "boolean") {
    throw new BadRequest("Missing or invalid field: enabled (boolean required)", { field: "enabled" });
  }

  const target = await findTrigger(namespaceId, orgId, id);
  target.eventTriggers[target.index] = { ...target.eventTriggers[target.index], enabled };
  target.chain.config = { ...target.config, event_triggers: target.eventTriggers };
  await writeChain(target.file, target.chain);

  return apiSuccess({
    trigger: fromRuntimeTrigger({ name: String(target.chain.name || "") }, target.eventTriggers[target.index]),
  });
});

export const DELETE = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { id } = await params;

  const target = await findTrigger(namespaceId, orgId, id);
  const filteredTriggers = target.eventTriggers.filter((_, index) => index !== target.index);

  target.chain.config = { ...target.config, event_triggers: filteredTriggers };
  await writeChain(target.file, target.chain);

  return apiSuccess({ deleted: id });
});
