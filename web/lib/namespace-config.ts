import config, { orgPath } from "./config";
import { getNamespaceFromSession, getSessionUser } from "./auth-bridge";

/**
 * Namespace-scoped config resolved from the authenticated request/session.
 *
 * Splits dirs into their proper tiers:
 *   org-level: chains, agents, profiles, templates, webhooks, emails
 *   project-level: runs, jobs, events, state, decisions, schedules
 */
export interface NamespaceConfig {
  namespaceId: string;
  orgId: string;
  // org-level (definitions)
  chainsDir: string;
  linksDir: string;
  agentsDir: string;
  agentProfilesDir: string;
  configProfilesDir: string;
  templatesDir: string;
  webhooksDir: string;
  emailsDir: string;
  // project-level (execution) - uses default project from config
  stateDir: string;
  eventsDir: string;
  workspaceDir: string;
  reportsDir: string;
  runsDir: string;
  schedulesDir: string;
  debugDir: string;
  jobsDir: string;
  decisionsDir: string;
}

/**
 * Get namespace-scoped config from session (request-derived).
 * Falls back to config defaults if no session present.
 */
export async function getNamespaceConfig(request: Request): Promise<NamespaceConfig> {
  const namespaceId = await getNamespaceFromSession(request);
  const user = await getSessionUser(request);
  let oId = user?.orgId ?? config.orgId;
  // when org slug matches namespace slug, collapse to "default" so paths
  // resolve to namespace root (e.g. /app/namespaces/tech/chains not /app/namespaces/tech/orgs/tech/chains)
  if (oId === namespaceId) oId = "default";

  return {
    namespaceId,
    orgId: oId,
    // org-level
    chainsDir: orgPath(namespaceId, oId, "chains"),
    linksDir: orgPath(namespaceId, oId, "links"),
    agentsDir: orgPath(namespaceId, oId, "agents"),
    agentProfilesDir: orgPath(namespaceId, oId, "agent-profiles"),
    configProfilesDir: orgPath(namespaceId, oId, "config-profiles"),
    templatesDir: orgPath(namespaceId, oId, "templates"),
    webhooksDir: orgPath(namespaceId, oId, "webhooks"),
    emailsDir: orgPath(namespaceId, oId, "emails"),
    // project-level (uses current project from config, not request-scoped)
    // TODO: project-level dirs need x-project-id header convention for multi-project support
    // see: workspace/tenant-isolation-spec.md P-M6
    stateDir: config.stateDir,
    eventsDir: config.eventsDir,
    workspaceDir: config.workspaceDir,
    reportsDir: config.reportsDir,
    runsDir: config.runsDir,
    schedulesDir: config.schedulesDir,
    debugDir: config.debugDir,
    jobsDir: config.jobsDir,
    decisionsDir: config.decisionsDir,
  };
}

/**
 * Get namespace ID from request (session-derived).
 */
export async function getNamespaceIdFromRequest(request: Request): Promise<string> {
  return await getNamespaceFromSession(request);
}

/**
 * Get org ID from request (session-derived).
 */
export async function getOrgIdFromRequest(request: Request): Promise<string> {
  const nsId = await getNamespaceFromSession(request);
  const user = await getSessionUser(request);
  let oId = user?.orgId ?? config.orgId;
  if (oId === nsId) oId = "default";
  return oId;
}
