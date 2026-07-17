import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import config, { orgPath } from "../config";
import type { RetryConfig, AgentAuthority, AgentContext, ArtifactType } from "../types";

export interface ArtifactProduces {
  id: string;
  type?: ArtifactType;
  template?: string;
  description?: string;
}

export interface ArtifactConsumes {
  from: string;
  artifact: string;
  required?: boolean;
}

export interface AgentArtifacts {
  produces?: ArtifactProduces[];
  consumes?: ArtifactConsumes[];
}

export interface AgentDefinition {
  id: string;
  name: string;
  description?: string;
  role?: string;
  version?: string;
  prompt?: string;
  triggers: string[];
  emits: string;
  context?: AgentContext;
  authorities?: AgentAuthority;
  retry?: RetryConfig;
  timeout?: number;
  model?: string;
  tools?: string[];
  on_error?: string;
  on_timeout?: string;
  created_at?: string;
  updated_at?: string;
  artifacts?: AgentArtifacts;
  /** Generated-chain contract: concrete output this agent hands to the next stage. */
  deliverable?: string;
  /** Generated-chain contract: repeatable check for that output. */
  verification?: string;
  /** Marks the terminal acceptance gate in a generated chain. */
  final_verifier?: boolean;
  /** Says the terminal gate evaluates the task acceptance criteria, not activity. */
  verifies_acceptance_criteria?: boolean;
  /** The precise condition the terminal verifier may assert as successful. */
  success_assertion?: string;
  source_skill?: {
    tool: string;
    path: string;
    last_synced?: string;
  };
  // marketplace metadata
  tags?: string[];
  category?: string;
  author?: string;
}

export interface AgentRef {
  $ref: string;
  [key: string]: unknown;
}

function isAgentRef(obj: unknown): obj is AgentRef {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "$ref" in obj &&
    typeof (obj as AgentRef).$ref === "string"
  );
}

/**
 * Get the agent directories (org-scoped, marketplace).
 * Org dir checked first during resolution.
 */
function getAgentDirs(namespaceId: string, orgId: string): string[] {
  const orgDir = orgPath(namespaceId, orgId, "agents");
  const marketplaceDir = join(config.globalRoot, "marketplace", "agents");
  return [orgDir, marketplaceDir];
}

/**
 * Load a single agent definition by ID.
 * Checks org dir first, falls back to shared dir.
 */
export function loadAgent(
  agentId: string,
  namespaceId: string = config.namespaceId,
  orgId: string = config.orgId
): AgentDefinition | null {
  const dirs = getAgentDirs(namespaceId, orgId);

  for (const dir of dirs) {
    const agentPath = join(dir, agentId, "agent.json");
    if (existsSync(agentPath)) {
      try {
        const content = readFileSync(agentPath, "utf-8");
        return JSON.parse(content) as AgentDefinition;
      } catch {
        // malformed json, skip
      }
    }
  }

  return null;
}

/**
 * Resolve a $ref agent reference.
 * Loads the base agent, then merges any override fields on top.
 */
export function resolveAgentRef(
  ref: AgentRef,
  namespaceId: string = config.namespaceId,
  orgId: string = config.orgId
): AgentDefinition {
  const agent = loadAgent(ref.$ref, namespaceId, orgId);
  if (!agent) {
    throw new Error(`Agent not found: ${ref.$ref}`);
  }

  // extract overrides (everything except $ref)
  const { $ref: _ref, ...overrides } = ref;

  if (Object.keys(overrides).length === 0) {
    return agent;
  }

  // merge overrides on top of loaded agent
  return { ...agent, ...overrides } as AgentDefinition;
}

/**
 * Resolve all agents in a chain's agents array.
 * Handles: inline objects, $ref objects, mixed arrays.
 */
export function resolveChainAgents(
  agents: unknown[],
  namespaceId: string = config.namespaceId,
  orgId: string = config.orgId
): AgentDefinition[] {
  return agents.map((entry) => {
    if (isAgentRef(entry)) {
      return resolveAgentRef(entry, namespaceId, orgId);
    }
    // inline agent object - pass through
    return entry as AgentDefinition;
  });
}

/**
 * Get all standalone agent definitions from org and marketplace dirs.
 * Org agents win on ID conflicts.
 */
export function getAllStandaloneAgents(
  namespaceId: string = config.namespaceId,
  orgId: string = config.orgId
): AgentDefinition[] {
  const agentMap = new Map<string, AgentDefinition>();
  const dirs = getAgentDirs(namespaceId, orgId);

  // scan shared first, then namespace (namespace overwrites)
  for (const dir of [...dirs].reverse()) {
    if (!existsSync(dir)) continue;

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const agentPath = join(dir, entry.name, "agent.json");
        if (!existsSync(agentPath)) continue;

        try {
          const content = readFileSync(agentPath, "utf-8");
          const agent = JSON.parse(content) as AgentDefinition;
          if (agent.id && agent.name) {
            agentMap.set(agent.id, agent);
          }
        } catch {
          // skip malformed
        }
      }
    } catch {
      // dir unreadable
    }
  }

  return Array.from(agentMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}
