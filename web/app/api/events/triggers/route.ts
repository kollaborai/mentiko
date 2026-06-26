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
  description?: string;
  conditions?: string;
  createdAt?: string;
}

function triggerId(sourceChain: string, emitEvent: string, targetChain: string, triggerEvent: string): string {
  return `trigger-${createHash("sha1")
    .update([sourceChain, emitEvent, targetChain, triggerEvent].join("\0"))
    .digest("hex")
    .slice(0, 12)}`;
}

function toRuntimeTrigger(trigger: EventTrigger) {
  return {
    id: trigger.id,
    event: trigger.triggerEvent,
    source_chain: trigger.sourceChain,
    condition: trigger.conditions || "",
    pass_data: true,
    enabled: trigger.enabled,
    emit_event: trigger.emitEvent,
    description: trigger.description || "",
    created_at: trigger.createdAt || new Date().toISOString(),
  };
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
    ...(typeof trigger.description === "string" && trigger.description ? { description: trigger.description } : {}),
    ...(typeof trigger.condition === "string" && trigger.condition ? { conditions: trigger.condition } : {}),
    ...(typeof trigger.created_at === "string" && trigger.created_at ? { createdAt: trigger.created_at } : {}),
  };
}

async function readChainFiles(namespaceId: string, orgId: string) {
  const chainsDir = orgPath(namespaceId, orgId, "chains");
  const entries = await fs.readdir(chainsDir, { withFileTypes: true }).catch(() => []);
  const chains: Array<{ dir: string; file: string; chain: Record<string, unknown> }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(chainsDir, entry.name, "chain.json");
    try {
      const chain = JSON.parse(await fs.readFile(file, "utf-8")) as Record<string, unknown>;
      chains.push({ dir: entry.name, file, chain });
    } catch {
      // skip malformed/missing chain files
    }
  }

  return chains;
}

async function readTriggers(namespaceId: string, orgId: string): Promise<EventTrigger[]> {
  const chains = await readChainFiles(namespaceId, orgId);
  return chains.flatMap(({ chain }) => {
    const config = chain.config as { event_triggers?: Record<string, unknown>[] } | undefined;
    return (config?.event_triggers || []).map((trigger) => fromRuntimeTrigger({ name: String(chain.name || "") }, trigger));
  });
}

async function findTargetChain(namespaceId: string, orgId: string, targetChain: string) {
  const chains = await readChainFiles(namespaceId, orgId);
  const found = chains.find(({ dir, chain }) => dir === targetChain || chain.name === targetChain);
  if (!found) throw new NotFound("Target chain", targetChain);
  return found;
}

async function writeChain(file: string, chain: Record<string, unknown>): Promise<void> {
  await fs.writeFile(file, `${JSON.stringify(chain, null, 2)}\n`);
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const triggers = await readTriggers(namespaceId, orgId);
  return apiSuccess({ triggers });
});

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const body = await request.json();
  const { sourceChain, emitEvent, targetChain, triggerEvent, enabled = true, description, conditions } = body;

  if (!sourceChain || !emitEvent || !targetChain || !triggerEvent) {
    throw new BadRequest("Missing required fields: sourceChain, emitEvent, targetChain, triggerEvent", {
      fields: ["sourceChain", "emitEvent", "targetChain", "triggerEvent"],
    });
  }

  const newTrigger: EventTrigger = {
    id: triggerId(sourceChain, emitEvent, targetChain, triggerEvent),
    sourceChain,
    emitEvent,
    targetChain,
    triggerEvent,
    enabled,
    ...(description && { description }),
    ...(conditions && { conditions }),
    createdAt: new Date().toISOString(),
  };

  const target = await findTargetChain(namespaceId, orgId, targetChain);
  const chainConfig = (target.chain.config && typeof target.chain.config === "object" ? target.chain.config : {}) as {
    event_triggers?: Record<string, unknown>[];
  };
  const eventTriggers = Array.isArray(chainConfig.event_triggers) ? chainConfig.event_triggers : [];
  const runtimeTrigger = toRuntimeTrigger(newTrigger);
  const existingIndex = eventTriggers.findIndex((trigger) => trigger.id === newTrigger.id);
  const nextTriggers = [...eventTriggers];
  if (existingIndex >= 0) {
    nextTriggers[existingIndex] = runtimeTrigger;
  } else {
    nextTriggers.push(runtimeTrigger);
  }
  target.chain.config = { ...chainConfig, event_triggers: nextTriggers };
  await writeChain(target.file, target.chain);

  return apiSuccess({ trigger: newTrigger }, undefined, 201);
});
