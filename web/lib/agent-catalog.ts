import { getAllStandaloneAgents } from "./agent-loader";

/**
 * Builds the AGENT_CATALOG string injected into the chain generation template.
 * Returns empty string if no agents exist.
 */
export function buildAgentCatalog(namespaceId: string, orgId: string): string {
  let agents = getAllStandaloneAgents(namespaceId, orgId);

  // filter out test/fixture agents
  agents = agents.filter((a) => {
    if (a.id.includes("test") || a.id.includes("fixture")) return false;
    if (a.name.includes("Test")) return false;
    return true;
  });

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

    // prompt preview: first 120 chars, no newlines
    const promptPreview = agent.prompt
      ? agent.prompt.replace(/\n/g, " ").trim().slice(0, 120)
      : "";

    let entry = `- id: "${agent.id}" | name: "${agent.name}"`;
    if (role) entry += ` | role: "${role}"`;
    lines.push(entry);

    lines.push(`  triggers: ${triggersStr} | emits: "${emitsStr}"`);

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
