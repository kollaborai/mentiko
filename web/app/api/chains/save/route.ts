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
): Promise<string[]> {
  const migrated: string[] = [];

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

    if (existsSync(agentPath)) {
      let counter = 2;
      while (existsSync(join(orgPath(namespaceId, orgId, "agents", `${agentSlug}-${counter}`), "agent.json"))) {
        counter++;
      }
      agentSlug = `${agentSlug}-${counter}`;
      agentDir = orgPath(namespaceId, orgId, "agents", agentSlug);
      agentPath = join(agentDir, "agent.json");
    }

    mkdirSync(agentDir, { recursive: true });

    const now = new Date().toISOString();
    const agentData = {
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
      authorities: inline.authorities,
      artifacts: inline.artifacts,
      created_at: now,
      updated_at: now,
    };

    writeFileSync(agentPath, JSON.stringify(agentData, null, 2));

    // Replace inline agent with reference, but keep routing metadata visible in
    // the chain so branch validation and editor views do not have to resolve
    // registry files just to know what event an agent emits.
    (agents[i] as { $ref: string; triggers?: string[]; emits?: string }) = {
      $ref: agentSlug,
      ...(inline.triggers ? { triggers: inline.triggers } : {}),
      ...(inline.emits ? { emits: inline.emits } : {}),
    };
    migrated.push(agentSlug);
  }

  return migrated;
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
  const migratedAgentIds = await migrateInlineAgents(agents, namespaceId, orgId);

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
