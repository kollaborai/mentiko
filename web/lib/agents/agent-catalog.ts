import { getAllStandaloneAgents } from "./agent-loader";

/**
 * Builds the AGENT_CATALOG string injected into the chain generation template.
 * Returns empty string if no agents exist.
 */
export interface AgentCatalogOptions {
  query?: string;
  limit?: number;
}

const STOP_WORDS = new Set(["agent", "criteria", "task", "that", "this", "verification", "with"]);

function queryTerms(value: string): string[] {
  return [...new Set(
    value.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g)
      ?.filter((term) => !STOP_WORDS.has(term)) ?? [],
  )];
}

export function buildAgentCatalog(
  namespaceId: string,
  orgId: string,
  options: AgentCatalogOptions = {},
): string {
  let agents = getAllStandaloneAgents(namespaceId, orgId);

  // filter out test/fixture agents
  agents = agents.filter((a) => {
    if (a.id.includes("test") || a.id.includes("fixture")) return false;
    if (a.name.includes("Test")) return false;
    return true;
  });

  const terms = queryTerms(options.query || "");
  agents = agents
    .map((agent) => {
      const identity = `${agent.id} ${agent.name} ${agent.role || ""}`.toLowerCase();
      const detail = [
        agent.description || "",
        agent.prompt || "",
        ...(agent.tags || []),
        ...(agent.authorities?.can || []),
      ].join(" ").toLowerCase();
      const score = terms.reduce((sum, term) =>
        sum + (identity.includes(term) ? 5 : 0) + (detail.includes(term) ? 1 : 0), 0);
      return { agent, score };
    })
    .sort((a, b) => b.score - a.score || a.agent.name.localeCompare(b.agent.name))
    .slice(0, Math.max(1, options.limit ?? 24))
    .map(({ agent }) => agent);

  if (agents.length === 0) return "";

  const lines: string[] = [
    "AVAILABLE AGENTS IN YOUR REGISTRY (prefer $ref over creating new inline agents):",
    "",
  ];

  for (const agent of agents) {
    const role = agent.role || "";
    const triggersStr = Array.isArray(agent.triggers)
      ? JSON.stringify(agent.triggers)
      : `["${agent.triggers}"]`;
    const emitsStr = agent.emits || "";
    const produces = agent.artifacts?.produces?.map((p) => p.id) ?? [];
    const tags = agent.tags ?? [];
    const authorities = agent.authorities?.can ?? [];

    // prompt preview: first 120 chars, no newlines
    const promptPreview = agent.prompt
      ? agent.prompt.replace(/\n/g, " ").trim().slice(0, 120)
      : "";

    let entry = `- id: "${agent.id}" | name: "${agent.name}"`;
    if (role) entry += ` | role: "${role}"`;
    lines.push(entry);

    lines.push(`  triggers: ${triggersStr} | emits: "${emitsStr}"`);
    if (authorities.length > 0) {
      lines.push(`  authorities.can: ${JSON.stringify(authorities)}`);
    }

    if (produces.length > 0) {
      lines.push(`  produces: ${JSON.stringify(produces)}`);
    }
    if (tags.length > 0) {
      lines.push(`  tags: ${JSON.stringify(tags)}`);
    }
    if (promptPreview) {
      lines.push(`  prompt_preview: "${promptPreview}..."`);
    }
    lines.push("");
  }

  lines.push("USE INSTRUCTIONS:");
  lines.push(
    '- If an agent in the catalog matches what you need (same role, similar I/O), use {"$ref": "agent-id"}'
  );
  lines.push(
    '- You can add overrides alongside $ref for customization: {"$ref": "agent-id", "prompt": "Focus on SQL injection only"}'
  );
  lines.push(
    "- Only create a NEW inline agent when no catalog agent fits the purpose"
  );
  lines.push(
    '- If using multiple catalog agents that all trigger on "chain-start", that\'s fine (they\'re parallel)'
  );
  lines.push("");

  return lines.join("\n");
}
