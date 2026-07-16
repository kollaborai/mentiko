import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { orgPath } from "@/lib/config";
import type { AgentDefinition } from "@/lib/agents/agent-loader";
import { assertCanonicalMcpTaskToolReferences } from "@/lib/agents/mcp-task-tool-contract";

type AgentAuthorities = NonNullable<AgentDefinition["authorities"]>;

export interface ExtractedAgent {
  agent: AgentDefinition;
  originalId: string;
  finalId: string;
}

export interface PostProcessResult {
  chain: Record<string, unknown>;
  createdAgents: { id: string; name: string }[];
  extractedCount: number;
}

// fields that belong in the registry record — don't keep as overrides
const BASE_AGENT_FIELDS = new Set([
  "name",
  "description",
  "role",
  "version",
  "prompt",
  "authorities",
  "timeout",
  "retry",
  "model",
  "tools",
  "context",
  "artifacts",
  "created_at",
  "updated_at",
  "tags",
  "category",
  "author",
]);

function toKebabCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Generated chains historically used `authorities: string[]`, while the
 * persisted Agent Definition contract requires an object. Canonicalize that
 * known producer shorthand at the registry write boundary; malformed values
 * are rejected before they can become durable invalid agent.json records.
 */
export function normalizeAgentAuthorities(value: unknown): AgentAuthorities | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    if (!value.every((capability) => typeof capability === "string")) {
      throw new Error("agent authorities array must contain only strings");
    }
    return { can: [...value], needs_approval: [] };
  }
  if (!value || typeof value !== "object") {
    throw new Error("agent authorities must be an object or a string array");
  }

  const authorities = value as Record<string, unknown>;
  for (const field of ["can", "needs_approval"] as const) {
    const capabilities = authorities[field];
    if (capabilities !== undefined && (!Array.isArray(capabilities) || !capabilities.every((capability) => typeof capability === "string"))) {
      throw new Error(`agent authorities.${field} must be an array of strings`);
    }
  }
  return authorities as AgentAuthorities;
}

function normalizedAgentForRegistry(agent: AgentDefinition, id: string): AgentDefinition {
  assertCanonicalMcpTaskToolReferences(agent);
  const authorities = normalizeAgentAuthorities(agent.authorities);
  return {
    ...agent,
    id,
    ...(authorities ? { authorities } : {}),
  };
}

/**
 * Iterate chain agents array, extract inline agents (those with a prompt).
 * Skips pure $ref entries (has $ref but no prompt).
 */
export function extractInlineAgents(
  chainJson: Record<string, unknown>
): ExtractedAgent[] {
  const agents = chainJson.agents;
  if (!Array.isArray(agents) || agents.length === 0) return [];

  const extracted: ExtractedAgent[] = [];

  agents.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null) return;
    const agent = entry as Record<string, unknown>;

    // skip pure $ref (has $ref and no prompt)
    if ("$ref" in agent && !("prompt" in agent)) return;

    // must have a prompt to be worth extracting
    if (!agent.prompt) return;

    const rawId =
      typeof agent.id === "string" && agent.id
        ? agent.id
        : typeof agent.name === "string" && agent.name
        ? toKebabCase(agent.name)
        : `agent-${index}`;

    const agentDef: AgentDefinition = {
      id: rawId,
      name: (agent.name as string) || rawId,
      description: agent.description as string | undefined,
      role: agent.role as string | undefined,
      version: (agent.version as string) || "1.0.0",
      prompt: agent.prompt as string,
      triggers: (agent.triggers as string[]) || [],
      emits: (agent.emits as string) || "",
      context: agent.context as AgentDefinition["context"],
      authorities: normalizeAgentAuthorities(agent.authorities),
      retry: agent.retry as AgentDefinition["retry"],
      timeout: agent.timeout as number | undefined,
      model: agent.model as string | undefined,
      tools: agent.tools as string[] | undefined,
      on_error: agent.on_error as string | undefined,
      on_timeout: agent.on_timeout as string | undefined,
      artifacts: agent.artifacts as AgentDefinition["artifacts"],
      tags: agent.tags as string[] | undefined,
      category: agent.category as string | undefined,
      author: agent.author as string | undefined,
    };

    // strip undefined fields
    const agentDefRaw = agentDef as unknown as Record<string, unknown>;
    Object.keys(agentDefRaw).forEach((k) => {
      if (agentDefRaw[k] === undefined) {
        delete agentDefRaw[k];
      }
    });

    extracted.push({
      agent: agentDef,
      originalId: rawId,
      finalId: rawId, // updated by writeAgentToRegistry
    });
  });

  return extracted;
}

/**
 * Write agent to registry. Handles collisions by appending -v2 .. -v5.
 * Returns the final id used.
 */
export function writeAgentToRegistry(
  agent: AgentDefinition,
  namespaceId: string,
  orgId: string
): string {
  let finalId = agent.id;

  for (let attempt = 0; attempt <= 4; attempt++) {
    const candidateId = attempt === 0 ? agent.id : `${agent.id}-v${attempt + 1}`;
    const agentPath = join(orgPath(namespaceId, orgId, "agents"), candidateId, "agent.json");

    if (!existsSync(agentPath)) {
      // no collision — write here
      finalId = candidateId;
      const agentWithId = normalizedAgentForRegistry(agent, finalId);
      mkdirSync(dirname(agentPath), { recursive: true });
      writeFileSync(agentPath, JSON.stringify(agentWithId, null, 2), "utf-8");
      return finalId;
    }

    // path exists — check if content is identical
    try {
      const existing = JSON.parse(readFileSync(agentPath, "utf-8")) as AgentDefinition;
      const incomingStr = JSON.stringify(normalizedAgentForRegistry(agent, candidateId), null, 2);
      const existingStr = JSON.stringify(existing, null, 2);
      if (incomingStr === existingStr) {
        // identical — no-op
        return candidateId;
      }
    } catch {
      // unreadable existing file — overwrite
      finalId = candidateId;
      const agentWithId = normalizedAgentForRegistry(agent, finalId);
      mkdirSync(dirname(agentPath), { recursive: true });
      writeFileSync(agentPath, JSON.stringify(agentWithId, null, 2), "utf-8");
      return finalId;
    }

    // different content, try next version suffix
  }

  // fallback: use -v5 and overwrite
  finalId = `${agent.id}-v5`;
  const agentPath = join(orgPath(namespaceId, orgId, "agents"), finalId, "agent.json");
  const agentWithId = normalizedAgentForRegistry(agent, finalId);
  mkdirSync(dirname(agentPath), { recursive: true });
  writeFileSync(agentPath, JSON.stringify(agentWithId, null, 2), "utf-8");
  return finalId;
}

/**
 * Rewrite inline agents in chain to $ref entries.
 * Keeps non-base fields alongside $ref as overrides.
 */
export function rewriteChainInlineToRef(
  chainJson: Record<string, unknown>,
  agentIdMap: Map<string, string>
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(chainJson)) as Record<string, unknown>;

  rewriteBranchAgentIds(clone, agentIdMap);

  if (!Array.isArray(clone.agents)) return clone;

  clone.agents = (clone.agents as Record<string, unknown>[]).map((entry) => {
    if (typeof entry !== "object" || entry === null) return entry;
    const agent = entry as Record<string, unknown>;

    // determine original id
    const originalId =
      typeof agent.id === "string" && agent.id
        ? agent.id
        : typeof agent.name === "string" && agent.name
        ? toKebabCase(agent.name)
        : null;

    if (!originalId || !agentIdMap.has(originalId)) return agent;

    const finalId = agentIdMap.get(originalId)!;

    // collect override fields (non-base, non-id)
    const overrides: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(agent)) {
      if (key === "id" || key === "$ref") continue;
      if (!BASE_AGENT_FIELDS.has(key)) {
        overrides[key] = val;
      }
    }

    return { $ref: finalId, ...overrides };
  });

  return clone;
}

function rewriteAgentId(value: unknown, agentIdMap: Map<string, string>): unknown {
  return typeof value === "string" && agentIdMap.has(value) ? agentIdMap.get(value) : value;
}

export function rewriteBranchAgentIds(
  chainJson: Record<string, unknown>,
  agentIdMap: Map<string, string>
): Record<string, unknown> {
  const branches = chainJson.branches;
  if (!branches || typeof branches !== "object" || Array.isArray(branches)) {
    return chainJson;
  }

  for (const [eventName, target] of Object.entries(branches as Record<string, unknown>)) {
    if (typeof target === "string") {
      (branches as Record<string, unknown>)[eventName] = rewriteAgentId(target, agentIdMap);
      continue;
    }

    if (Array.isArray(target)) {
      (branches as Record<string, unknown>)[eventName] = target.map((item) => rewriteAgentId(item, agentIdMap));
      continue;
    }

    if (!target || typeof target !== "object") continue;
    const branch = target as Record<string, unknown>;

    if (Array.isArray(branch.fan_out)) {
      branch.fan_out = branch.fan_out.map((item) => rewriteAgentId(item, agentIdMap));
    }
    if (typeof branch.fan_in === "string") {
      branch.fan_in = rewriteAgentId(branch.fan_in, agentIdMap);
    }
    if (typeof branch.default === "string") {
      branch.default = rewriteAgentId(branch.default, agentIdMap);
    }
    if (typeof branch.on_error === "string") {
      branch.on_error = rewriteAgentId(branch.on_error, agentIdMap);
    }
    if (Array.isArray(branch.conditions)) {
      branch.conditions = branch.conditions.map((condition) => {
        if (!condition || typeof condition !== "object" || Array.isArray(condition)) return condition;
        const next = { ...(condition as Record<string, unknown>) };
        if (typeof next.then === "string") {
          next.then = rewriteAgentId(next.then, agentIdMap);
        }
        return next;
      });
    }
  }

  return chainJson;
}

/**
 * Full post-processing pipeline.
 * Extracts inline agents → writes to registry → rewrites chain with $refs.
 */
export async function postProcessChain(
  chainJson: Record<string, unknown>,
  namespaceId: string,
  orgId: string
): Promise<PostProcessResult> {
  const extracted = extractInlineAgents(chainJson);

  if (extracted.length === 0) {
    return { chain: chainJson, createdAgents: [], extractedCount: 0 };
  }

  const agentIdMap = new Map<string, string>();
  const createdAgents: { id: string; name: string }[] = [];

  for (const item of extracted) {
    const finalId = writeAgentToRegistry(item.agent, namespaceId, orgId);
    agentIdMap.set(item.originalId, finalId);
    createdAgents.push({ id: finalId, name: item.agent.name });
  }

  const rewrittenChain = rewriteChainInlineToRef(chainJson, agentIdMap);

  return {
    chain: rewrittenChain,
    createdAgents,
    extractedCount: extracted.length,
  };
}
