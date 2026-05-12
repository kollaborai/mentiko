import { NextRequest } from "next/server";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { orgPath } from "@/lib/config";
import { requirePermission } from "@/lib/rbac-auth";
import { getJob } from "@/lib/job-store";
import { saveLink, slugifyLinkName } from "@/lib/link-utils";
import { BadRequest, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import type { Link, LinkAgent } from "@/lib/link-types";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { jobId } = await request.json();

  if (!jobId) {
    throw new BadRequest("jobId is required", { field: "jobId" });
  }

  const job = getJob(jobId, namespaceId);
  if (!job) throw new NotFound("Job", jobId);
  if (job.status !== "complete" || !job.result) {
    throw new BadRequest("Job not complete or missing result", { field: "jobId" });
  }

  const result = job.result as Record<string, unknown>;
  const agentsDir = orgPath(namespaceId, orgId, "agents");

  // create new agents if the AI generated inline definitions
  const createAgents = (result.create_agents || []) as Array<{
    id: string;
    name: string;
    role?: string;
    description?: string;
    prompt?: string;
  }>;

  const createdAgentIds: string[] = [];

  for (const agentDef of createAgents) {
    if (!agentDef.id || !agentDef.name) continue;

    const slug = agentDef.id.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    const agentDir = join(agentsDir, slug);

    // skip if agent already exists
    if (existsSync(join(agentDir, "agent.json"))) {
      createdAgentIds.push(slug);
      continue;
    }

    mkdirSync(agentDir, { recursive: true });
    const now = new Date().toISOString();
    const agentJson = {
      id: slug,
      name: agentDef.name,
      role: agentDef.role || "",
      description: agentDef.description || "",
      prompt: agentDef.prompt || "",
      triggers: ["manual"],
      emits: "task-complete",
      created_at: now,
      updated_at: now,
    };
    writeFileSync(join(agentDir, "agent.json"), JSON.stringify(agentJson, null, 2));
    createdAgentIds.push(slug);
  }

  // build link agent refs
  const agent1Raw = result.agent1 as Record<string, string> | undefined;
  const agent2Raw = result.agent2 as Record<string, string> | undefined;

  const resolveAgent = (raw: Record<string, string> | undefined): LinkAgent => {
    if (!raw) return { name: "Agent", role: "General purpose" };
    if (raw.$ref) return { $ref: raw.$ref };
    return { name: raw.name || "Agent", role: raw.role || "" };
  };

  const now = new Date().toISOString();
  const linkName = (result.name as string) || "Generated Link";
  const id = slugifyLinkName(linkName);

  const link: Link = {
    id,
    name: linkName,
    description: (result.description as string) || "",
    version: "1.0.0",
    agents: {
      agent1: resolveAgent(agent1Raw),
      agent2: resolveAgent(agent2Raw),
    },
    config: {
      max_rounds: (result.max_rounds as number) || 0,
      mode: (result.mode as "debate" | "collaboration" | "review") || "debate",
      stall_threshold: (result.stall_threshold as number) || 0,
      leading_prompt: (result.leading_prompt as string) || "",
      agent1_prompt: (result.agent1_prompt as string) || "",
      agent2_prompt: (result.agent2_prompt as string) || "",
      on_complete: "stop",
    },
    status: "active",
    created_at: now,
    updated_at: now,
  };

  const linksDir = orgPath(namespaceId, orgId, "links");
  saveLink(linksDir, link);

  return apiSuccess({ link, createdAgents: createdAgentIds });
});
