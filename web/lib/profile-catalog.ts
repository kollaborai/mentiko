import { listProfiles } from "./agent-profile-storage";

/**
 * Builds the PROFILE_CATALOG string injected into chain generation prompts.
 * Lists available agent profile IDs so the AI uses real IDs instead of hallucinating.
 */
export function buildProfileCatalog(namespaceId: string, orgId: string): string {
  const profiles = listProfiles(namespaceId, orgId);

  if (profiles.length === 0) return "";

  const lines: string[] = [
    "AVAILABLE AGENT PROFILES (use the profile id as default_agent_profile):",
    "",
  ];

  for (const p of profiles) {
    let entry = `- id: "${p.id}" | name: "${p.name}" | cli: "${p.cli}"`;
    if (p.model) entry += ` | model: "${p.model}"`;
    if (p.isDefault) entry += " (DEFAULT)";
    lines.push(entry);
  }

  lines.push("");
  lines.push("Use one of these profile IDs for default_agent_profile. Do NOT invent profile IDs.");

  return lines.join("\n");
}
