import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { nsPath } from "@/lib/config";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
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
  } catch {
    return [];
  }
}

async function writeTriggers(namespaceId: string, triggers: EventTrigger[]): Promise<void> {
  const triggersPath = await getTriggersPath(namespaceId);
  await fs.writeFile(triggersPath, JSON.stringify({ triggers }, null, 2));
}

export const PATCH = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const namespaceId = await getNamespaceIdFromRequest(request);
  const { id } = await params;
  const body = await request.json();
  const { enabled } = body;

  if (typeof enabled !== "boolean") {
    throw new BadRequest("Missing or invalid field: enabled (boolean required)", { field: "enabled" });
  }

  const triggers = await readTriggers(namespaceId);
  const triggerIndex = triggers.findIndex((t) => t.id === id);

  if (triggerIndex === -1) {
    throw new NotFound("Event trigger", id);
  }

  triggers[triggerIndex].enabled = enabled;
  await writeTriggers(namespaceId, triggers);

  return apiSuccess({ trigger: triggers[triggerIndex] });
});

export const DELETE = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const namespaceId = await getNamespaceIdFromRequest(request);
  const { id } = await params;

  const triggers = await readTriggers(namespaceId);
  const filteredTriggers = triggers.filter((t) => t.id !== id);

  if (filteredTriggers.length === triggers.length) {
    throw new NotFound("Event trigger", id);
  }

  await writeTriggers(namespaceId, filteredTriggers);

  return apiSuccess({ deleted: id });
});
