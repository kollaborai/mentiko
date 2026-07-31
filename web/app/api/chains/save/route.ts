import { NextRequest } from "next/server";
import { writeFileSync, mkdirSync, readFileSync, existsSync, copyFileSync } from "fs";
import { join } from "path";
import { orgPath } from "@/lib/config";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getDefaultVersion } from "@/lib/system/version-utils";
import { validateChain } from "@/lib/validators";
import { execAuditLog } from "@/lib/api/audit-exec";
import { addAuditLog } from "@/lib/api/audit-queue";
import { BadRequest, ValidationError } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveChainAgents } from "@/lib/agents/agent-loader";
import { normalizeMcpTaskToolDeclarations } from "@/lib/agents/mcp-task-tool-contract";
import {
  normalizeAgentAuthorities,
  rewriteBranchAgentIds,
} from "@/lib/chains/chain-postprocessor";
import { isGeneratedChainContract, validateGeneratedChainDeliveryContract } from "@/lib/chains/generated-chain-delivery-contract";
import {
  buildGeneratedChainRejectionEnvelope,
  canonicalGeneratedChainHash,
  findGeneratedChainRejection,
  recordGeneratedChainRejection,
} from "@/lib/chains/generated-chain-rejections";

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const firstIp = forwarded.split(",")[0].trim();
    if (/^[\d\.]+$/.test(firstIp) || /^[\da-f:]+$/i.test(firstIp)) {
      return firstIp;
    }
  }
  return request.headers.get("x-real-ip") || "unknown";
}

function logAuditEvent(eventType: string, description: string, metadata: Record<string, string>, ip: string) {
  // clip description to 200 chars, each metadata value to 500 chars (original behavior)
  const clippedMeta: Record<string, string> = {};
  for (const [k, v] of Object.entries(metadata)) {
    clippedMeta[k] = v.slice(0, 500);
  }
  execAuditLog(eventType, description.slice(0, 200), clippedMeta, { ip }).catch(() => {});
  addAuditLog({ eventType, description: description.slice(0, 200), metadata: clippedMeta, options: { ip } }).catch(() => {});
}

export const dynamic = "force-dynamic";

interface InlineAgent {
  id: string;
  name: string;
  prompt: string;
  role?: string;
  description?: string;
  triggers?: string[];
  emits?: string;
  timeout?: number;
  retry?: { max_retries?: number; backoff?: string; retry_on?: string };
  on_error?: string;
  on_timeout?: string;
  on_failure?: string;
  model?: string;
  tools?: string[];
  agent_profile?: string;
  gateway?: string;
  context?: { workspace?: string; read_first?: string[] };
  authorities?: { can?: string[]; needs_approval?: string[] };
  artifacts?: { produces?: Array<{ id: string } | { $ref: string }>; consumes?: Array<{ from: string; artifact: string; required?: boolean }> };
}

/**
 * Migrate inline agents to standalone agent files.
 * Returns the list of migrated agent IDs and updates the chain in place.
 */
async function migrateInlineAgents(
  agents: unknown[],
  namespaceId: string,
  orgId: string
): Promise<{ migratedIds: string[]; agentIdMap: Map<string, string> }> {
  const migrated: string[] = [];
  const agentIdMap = new Map<string, string>();
  const reservedAgentSlugs = new Set<string>();
  const pendingAgentWrites: Array<{ path: string; data: Record<string, unknown> }> = [];

  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i] as Partial<InlineAgent> & Record<string, unknown>;

    // Skip if already a reference
    if ("$ref" in agent && typeof agent["$ref"] === "string") continue;

    // Skip if no prompt (not an inline agent)
    if (!agent.prompt || typeof agent.prompt !== "string") continue;

    // Skip if no name or id (required for inline agent)
    if (!agent.name || typeof agent.name !== "string") continue;

    const inline = agent as InlineAgent;
    const agentId = inline.id || inline.name.toLowerCase().replace(/\s+/g, "-");

    // Create standalone agent file, suffix with counter if slug already taken
    let agentSlug = agentId.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    let agentDir = orgPath(namespaceId, orgId, "agents", agentSlug);
    let agentPath = join(agentDir, "agent.json");

    if (existsSync(agentPath) || reservedAgentSlugs.has(agentSlug)) {
      let counter = 2;
      const baseSlug = agentSlug;
      while (
        reservedAgentSlugs.has(`${baseSlug}-${counter}`)
        || existsSync(join(orgPath(namespaceId, orgId, "agents", `${baseSlug}-${counter}`), "agent.json"))
      ) {
        counter++;
      }
      agentSlug = `${baseSlug}-${counter}`;
      agentDir = orgPath(namespaceId, orgId, "agents", agentSlug);
      agentPath = join(agentDir, "agent.json");
    }
    reservedAgentSlugs.add(agentSlug);

    mkdirSync(agentDir, { recursive: true });

    const now = new Date().toISOString();
    let agentData: Record<string, unknown>;
    try {
      agentData = normalizeMcpTaskToolDeclarations({
        id: agentSlug,
        name: inline.name,
        description: inline.description,
        role: inline.role,
        prompt: inline.prompt,
        triggers: inline.triggers || [],
        emits: inline.emits || "",
        timeout: inline.timeout,
        retry: inline.retry,
        on_error: inline.on_error,
        on_timeout: inline.on_timeout,
        model: inline.model,
        tools: inline.tools,
        agent_profile: inline.agent_profile,
        gateway: inline.gateway,
        context: inline.context,
        // Generated chains may use the legacy string-array shorthand here,
        // but standalone agent.json records have the object-only schema.
        // Normalize at this write boundary so an inline save cannot persist
        // a record the Agent Definition contract will reject.
        authorities: normalizeAgentAuthorities(inline.authorities),
        artifacts: inline.artifacts,
        created_at: now,
        updated_at: now,
      });
    } catch (error) {
      throw new BadRequest(error instanceof Error ? error.message : "Invalid MCP task tool declaration");
    }

    pendingAgentWrites.push({ path: agentPath, data: agentData });

    // Replace inline agent with reference, but keep routing metadata visible in
    // the chain so branch validation and editor views do not have to resolve
    // registry files just to know what event an agent emits.
    (agents[i] as { $ref: string; triggers?: string[]; emits?: string }) = {
      $ref: agentSlug,
      ...(inline.triggers ? { triggers: inline.triggers } : {}),
      ...(inline.emits ? { emits: inline.emits } : {}),
    };
    migrated.push(agentSlug);
    agentIdMap.set(agentId, agentSlug);
  }

  // Agent-level failure targets can point at a later inline agent. Delay the
  // writes until every collision suffix is known, then rewrite those targets
  // with the same map used for branches and chain-level routing.
  for (const pending of pendingAgentWrites) {
    for (const field of ["on_error", "on_timeout"] as const) {
      const value = pending.data[field];
      if (typeof value === "string" && agentIdMap.has(value)) {
        pending.data[field] = agentIdMap.get(value);
      }
    }
    writeFileSync(pending.path, JSON.stringify(pending.data, null, 2));
  }

  return { migratedIds: migrated, agentIdMap };
}

/**
 * Repair the one branch shape the chain validator hard-rejects but the AI chain
 * generator still emits intermittently: a fan_in (join) agent that also appears
 * in its own fan_out (parallel) list. That would launch the agent twice — once as
 * a fan-out worker and again when the group joins — so validateChain returns 422
 * ("fan_in must not also appear in fan_out"), which surfaces as the recurring
 * "Chain save failed ... 422" the interactive assign, manual editor, and headless
 * auto-run paths all hit here (every producer routes through this save endpoint).
 * The fix is deterministic and unambiguous — drop the join agent from the worker
 * list — so normalize at this single write boundary rather than failing the save.
 * Mutates branches in place (chainForValidation shares this object).
 */
function normalizeBranchFanInFanOut(chain: Record<string, unknown>): void {
  const branches = chain.branches;
  if (!branches || typeof branches !== "object" || Array.isArray(branches)) return;
  for (const target of Object.values(branches as Record<string, unknown>)) {
    if (!target || typeof target !== "object" || Array.isArray(target)) continue;
    const branch = target as Record<string, unknown>;
    if (typeof branch.fan_in === "string" && Array.isArray(branch.fan_out)) {
      branch.fan_out = branch.fan_out.filter((member) => member !== branch.fan_in);
    }
  }
}

export const POST = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const ip = getClientIp(request);
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { chain, name, createVersion = true }: { chain: Record<string, unknown>; name: string; createVersion?: boolean } = await request.json();

  if (!chain || !name) {
    throw new BadRequest("chain and name are required", { field: "chain" });
  }

  normalizeBranchFanInFanOut(chain);

  const chainForValidation = { ...chain };
  if (Array.isArray(chain.agents)) {
    try {
      chainForValidation.agents = resolveChainAgents(chain.agents, namespaceId, orgId) as unknown[];
    } catch {
      chainForValidation.agents = chain.agents;
    }
  }

  // validate chain before saving
  const validation = validateChain(chainForValidation);
  if (!validation.valid) {
    throw new ValidationError("Invalid chain", { errors: validation.errors });
  }
  if (isGeneratedChainContract(chain)) {
    // Ledger check BEFORE revalidating (A4): an artifact already rejected under
    // the current validator revision fails identically, so answer from the
    // shared rejection record. `duplicate: true` lets the auto-run caller stop
    // its retry loop immediately instead of counting another attempt.
    const artifactHash = canonicalGeneratedChainHash(chain);
    const priorRejection = findGeneratedChainRejection(namespaceId, orgId, artifactHash);
    if (priorRejection) {
      throw new ValidationError("Invalid generated chain delivery contract", {
        errors: [priorRejection.message],
        rejection: { ...priorRejection, phase: "save" as const },
        duplicate: true,
      });
    }
    const generatedContractErrors = validateGeneratedChainDeliveryContract(chainForValidation);
    if (generatedContractErrors.length) {
      const envelope = buildGeneratedChainRejectionEnvelope({
        phase: "save",
        chain,
        errors: generatedContractErrors,
      });
      recordGeneratedChainRejection(namespaceId, orgId, envelope);
      throw new ValidationError("Invalid generated chain delivery contract", {
        errors: generatedContractErrors,
        rejection: envelope,
      });
    }
  }

  const chainDir = orgPath(namespaceId, orgId, "chains", name);
  const chainPath = join(chainDir, "chain.json");

  let version: string = (chain.version as string) || "";
  const isNewChain = !existsSync(chainPath);

  mkdirSync(chainDir, { recursive: true });

  if (!version) {
    if (existsSync(chainPath)) {
      const current = JSON.parse(readFileSync(chainPath, "utf-8"));
      version = (current.version as string) || "1.0.0";
    } else {
      version = getDefaultVersion();
    }
  }

  chain.version = version;

  if (createVersion && !isNewChain) {
    const versionsDir = orgPath(namespaceId, orgId, "agents", "versions", name);
    mkdirSync(versionsDir, { recursive: true });

    const versionFilePath = join(versionsDir, `${version}.json`);
    if (!existsSync(versionFilePath)) {
      copyFileSync(chainPath, versionFilePath);
    }
  }

  // Migrate inline agents to standalone before saving
  const agents = (chain.agents as unknown[]) || [];
  const { migratedIds: migratedAgentIds, agentIdMap } = await migrateInlineAgents(
    agents,
    namespaceId,
    orgId,
  );
  // Validation above runs against the original inline IDs. Registry collisions
  // can suffix those IDs during migration, so rewrite every supported branch
  // and chain-level routing target before persisting the now-ref-based chain.
  // Without this, a chain can validate successfully and then become invalid at
  // the write boundary.
  rewriteBranchAgentIds(chain, agentIdMap);

  writeFileSync(chainPath, JSON.stringify(chain, null, 2));

  // Log chain save/modify
  const action = isNewChain ? "created" : "modified";
  const agentsArray = Array.isArray(chain.agents) ? chain.agents : [];
  logAuditEvent("chain_edit", `Chain ${action}: ${name}`, {
    chain_name: name,
    chain_path: chainPath,
    action: action,
    version: version,
    namespace_id: namespaceId,
    agent_count: String(agentsArray.length),
    migrated_agents: migratedAgentIds.join(","),
  }, ip);

  return apiSuccess({
    success: true,
    path: chainPath,
    version,
    migratedAgents: migratedAgentIds,
  });
});
