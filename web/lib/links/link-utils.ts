import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { loadAgent } from "../agents/agent-loader";
import type { Link, LinkAgent, LinkSummary } from "./link-types";

/**
 * Load a single link by ID from the links directory.
 * Each link lives in {linksDir}/{id}/link.json.
 */
export function loadLink(linksDir: string, linkId: string): Link | null {
  const linkPath = join(linksDir, linkId, "link.json");
  if (!existsSync(linkPath)) return null;

  try {
    const content = readFileSync(linkPath, "utf-8");
    return JSON.parse(content) as Link;
  } catch {
    return null;
  }
}

/**
 * Resolve a LinkAgent name. If it's a $ref, load the agent definition
 * and return its name. Otherwise return the inline name or "unnamed".
 */
export function resolveLinkAgentName(
  agent: LinkAgent,
  namespaceId?: string,
  orgId?: string
): string {
  if (agent.name) return agent.name;

  if (agent.$ref) {
    try {
      const def = loadAgent(agent.$ref, namespaceId, orgId);
      if (def) return def.name;
      return agent.$ref;
    } catch {
      return agent.$ref;
    }
  }

  return "unnamed";
}

/**
 * Scan the links directory and return summaries for all links.
 */
export function getAllLinks(
  linksDir: string,
  namespaceId?: string,
  orgId?: string
): LinkSummary[] {
  const summaries: LinkSummary[] = [];

  if (!existsSync(linksDir)) return summaries;

  try {
    const entries = readdirSync(linksDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const linkPath = join(linksDir, entry.name, "link.json");
      if (!existsSync(linkPath)) continue;

      try {
        const content = readFileSync(linkPath, "utf-8");
        const link = JSON.parse(content) as Link;

        summaries.push({
          id: link.id || entry.name,
          name: link.name || "Unnamed",
          description: link.description,
          mode: link.config?.mode || "collaboration",
          agent1Name: resolveLinkAgentName(link.agents?.agent1 || {}, namespaceId, orgId),
          agent2Name: resolveLinkAgentName(link.agents?.agent2 || {}, namespaceId, orgId),
          status: link.status || "draft",
          created_at: link.created_at || "",
          updated_at: link.updated_at || "",
        });
      } catch {
        // skip malformed link
      }
    }
  } catch {
    // dir might not exist or be unreadable
  }

  return summaries;
}

/**
 * Save a link to disk. Creates the directory if needed.
 */
export function saveLink(linksDir: string, link: Link): void {
  const linkDir = join(linksDir, link.id);
  mkdirSync(linkDir, { recursive: true });
  writeFileSync(join(linkDir, "link.json"), JSON.stringify(link, null, 2));
}

/**
 * Delete a link directory.
 */
export function deleteLink(linksDir: string, linkId: string): void {
  const linkDir = join(linksDir, linkId);
  if (existsSync(linkDir)) {
    rmSync(linkDir, { recursive: true, force: true });
  }
}

/**
 * Slugify a name into a filesystem-safe ID.
 */
export function slugifyLinkName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
