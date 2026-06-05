import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { nsPath } from "@/lib/config";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
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

const TRIGGERS_FILE = "event-triggers.json";

async function getTriggersPath(namespaceId: string): Promise<string> {
  const eventsDir = nsPath(namespaceId, "events");
  await fs.mkdir(eventsDir, { recursive: true });
  return path.join(eventsDir, TRIGGERS_FILE);
}

async function readTriggers(namespaceId: string): Promise<EventTrigger[]> {
  const triggersPath = await getTriggersPath(namespaceId);
  try {
    const content = await fs.readFile(triggersPath, "utf-8");
    const data = JSON.parse(content);
    return data.triggers || [];
  } catch (_error) {
    return [];
  }
}

async function writeTriggers(namespaceId: string, triggers: EventTrigger[]): Promise<void> {
  const triggersPath = await getTriggersPath(namespaceId);
  await fs.writeFile(triggersPath, JSON.stringify({ triggers }, null, 2));
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const namespaceId = await getNamespaceIdFromRequest(request);
  const triggers = await readTriggers(namespaceId);
  return apiSuccess({ triggers });
});

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const namespaceId = await getNamespaceIdFromRequest(request);
  const body = await request.json();
  const { sourceChain, emitEvent, targetChain, triggerEvent, enabled = true, description, conditions } = body;

  if (!sourceChain || !emitEvent || !targetChain || !triggerEvent) {
    throw new BadRequest("Missing required fields: sourceChain, emitEvent, targetChain, triggerEvent", {
      fields: ["sourceChain", "emitEvent", "targetChain", "triggerEvent"],
    });
  }

  const triggers = await readTriggers(namespaceId);
  const newTrigger: EventTrigger = {
    id: `trigger-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    sourceChain,
    emitEvent,
    targetChain,
    triggerEvent,
    enabled,
    ...(description && { description }),
    ...(conditions && { conditions }),
    createdAt: new Date().toISOString(),
  };

  triggers.push(newTrigger);
  await writeTriggers(namespaceId, triggers);

  return apiSuccess({ trigger: newTrigger }, undefined, 201);
});
