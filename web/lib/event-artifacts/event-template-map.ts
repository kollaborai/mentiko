import { existsSync, readFileSync } from "fs";
import { basename, join } from "path";
import { orgPath } from "@/lib/config";

export type EventArtifactAction = "draft_tasks";
export type EventArtifactEventName = "quality_gate.failed";

export interface EventTemplateMapping {
  id: string;
  event: EventArtifactEventName;
  enabled: boolean;
  generationTemplateId: string;
  artifactTemplateId: string;
  artifactSchema: "generated-tasks/v1";
  outputArtifact: string;
  actions: EventArtifactAction[];
  maxChildren: number;
  requireHumanReview: true;
  dedupeKey: string;
}

const STORE_FILE = "event-artifact-mappings.json";
const DEFAULT_DEDUPE = "{{namespace.id}}:{{org.id}}:{{task.id}}:{{run.id}}:quality_gate.failed";

export const DEFAULT_EVENT_TEMPLATE_MAPPINGS: EventTemplateMapping[] = [{
  id: "quality-gate-failed-draft-tasks",
  event: "quality_gate.failed",
  enabled: true,
  generationTemplateId: "failure_triage",
  artifactTemplateId: "generated_tasks",
  artifactSchema: "generated-tasks/v1",
  outputArtifact: "triage-result.json",
  actions: ["draft_tasks"],
  maxChildren: 3,
  requireHumanReview: true,
  dedupeKey: DEFAULT_DEDUPE,
}];

export function getEventTemplateMappingsPath(namespaceId: string, orgId: string): string {
  return orgPath(namespaceId, orgId, STORE_FILE);
}

export function readEventTemplateMappings(namespaceId: string, orgId: string): EventTemplateMapping[] {
  const path = getEventTemplateMappingsPath(namespaceId, orgId);
  if (!existsSync(path)) return DEFAULT_EVENT_TEMPLATE_MAPPINGS;

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_EVENT_TEMPLATE_MAPPINGS;
    const normalized = parsed
      .map((item) => normalizeEventTemplateMapping(item))
      .filter((item): item is EventTemplateMapping => Boolean(item));
    return normalized.length ? normalized : DEFAULT_EVENT_TEMPLATE_MAPPINGS;
  } catch {
    return DEFAULT_EVENT_TEMPLATE_MAPPINGS;
  }
}

export function getEnabledMappingsForEvent(
  mappings: EventTemplateMapping[],
  event: EventArtifactEventName,
): EventTemplateMapping[] {
  return mappings.filter((mapping) => mapping.enabled && mapping.event === event);
}

export function normalizeEventTemplateMapping(value: unknown): EventTemplateMapping | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const id = slug(String(raw.id || ""));
  const event = raw.event === "quality_gate.failed" ? raw.event : null;
  const generationTemplateId = String(raw.generationTemplateId || "").trim();
  const artifactTemplateId = String(raw.artifactTemplateId || "").trim();
  const artifactSchema = raw.artifactSchema === "generated-tasks/v1" ? raw.artifactSchema : null;
  const outputArtifact = basename(String(raw.outputArtifact || "triage-result.json").trim());

  if (!id || !event || !generationTemplateId || !artifactTemplateId || !artifactSchema || !outputArtifact) {
    return null;
  }

  const actions = Array.isArray(raw.actions) && raw.actions.includes("draft_tasks")
    ? ["draft_tasks" as const]
    : ["draft_tasks" as const];
  const maxChildrenRaw = typeof raw.maxChildren === "number" ? raw.maxChildren : 3;

  return {
    id,
    event,
    enabled: raw.enabled !== false,
    generationTemplateId,
    artifactTemplateId,
    artifactSchema,
    outputArtifact,
    actions,
    maxChildren: Math.max(1, Math.min(5, Math.floor(maxChildrenRaw))),
    requireHumanReview: true,
    dedupeKey: typeof raw.dedupeKey === "string" && raw.dedupeKey.trim()
      ? raw.dedupeKey.trim()
      : DEFAULT_DEDUPE,
  };
}

export function evaluateMappingDedupeKey(
  template: string,
  values: {
    namespaceId: string;
    orgId: string;
    taskId?: string;
    runId: string;
  },
): string {
  return template
    .replaceAll("{{namespace.id}}", values.namespaceId)
    .replaceAll("{{org.id}}", values.orgId)
    .replaceAll("{{task.id}}", values.taskId || "no-task")
    .replaceAll("{{run.id}}", values.runId);
}

export function mappingsStoreDir(namespaceId: string, orgId: string): string {
  return join(orgPath(namespaceId, orgId), ".");
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}
