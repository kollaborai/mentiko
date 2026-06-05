/**
 * GET /api/audit/explain
 *
 * "Why did agent X do Y?" query interface.
 * Aggregates: audit log entries, agent output, git diff, agent prompt, run context.
 *
 * Query params:
 *   - runId:    required  - the run to explain
 *   - agentId:  optional  - narrow to specific agent
 *   - action:   optional  - keyword to search in output/diff (e.g. "deleted", "modified")
 */

import { NextRequest, NextResponse } from "next/server";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { nsPath } from "@/lib/config";
import { BadRequest, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { requirePermission } from "@/lib/auth/rbac-auth";

export const dynamic = "force-dynamic";

interface AgentExplanation {
  agentId: string;
  agentName?: string;
  prompt?: string;
  goal?: string;
  actions: string[];
  filesChanged: string[];
  diffSummary?: string;
  outputExcerpt?: string;
  auditEntries: AuditEntry[];
  timestamp?: string;
}

interface AuditEntry {
  id?: string;
  timestamp?: string;
  event_type?: string;
  description?: string;
  [key: string]: unknown;
}

interface RunJson {
  id: string;
  chainName?: string;
  agents?: Array<{
    id: string;
    name?: string;
    prompt?: string;
    goal?: string;
    status?: string;
    startedAt?: string;
    completedAt?: string;
  }>;
}

interface ArtifactJson {
  agent?: string;
  agentId?: string;
  filesChanged?: string[];
  diff?: string;
  output?: string;
  outputHead?: string;
}

function loadRunJson(namespaceId: string, runId: string): RunJson | null {
  const p = nsPath(namespaceId, "runs", runId, "run.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as RunJson;
  } catch {
    return null;
  }
}

function loadArtifacts(namespaceId: string, runId: string): ArtifactJson[] {
  const artifactsDir = nsPath(namespaceId, "runs", runId, "artifacts");
  if (!existsSync(artifactsDir)) return [];
  return readdirSync(artifactsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(artifactsDir, f), "utf-8")) as ArtifactJson;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as ArtifactJson[];
}

function loadAuditForRun(namespaceId: string, runId: string): AuditEntry[] {
  const auditDir = nsPath(namespaceId, "audit");
  const auditFile = join(auditDir, "audit.log");
  if (!existsSync(auditFile)) return [];

  try {
    const lines = readFileSync(auditFile, "utf-8").split("\n").filter(Boolean);
    return lines
      .map((l) => {
        try {
          return JSON.parse(l) as AuditEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is AuditEntry => e !== null && String(e.run_id || e.id || "") === runId);
  } catch {
    return [];
  }
}

function extractActions(output: string | undefined, action?: string): string[] {
  if (!output) return [];
  const lines = output.split("\n").filter((l) => l.trim().length > 0);
  // action filter or pull meaningful lines (tool calls, decisions, key phrases)
  const keywords = action
    ? [action]
    : ["created", "modified", "deleted", "wrote", "ran", "executed", "decided", "approved", "rejected", "completed"];

  return lines
    .filter((l) =>
      keywords.some((k) => l.toLowerCase().includes(k))
    )
    .slice(0, 20);
}

export const GET = withErrorHandling(async (request: NextRequest): Promise<NextResponse> => {
  const perm = await requirePermission(request, "view_audit");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const { searchParams } = new URL(request.url);
  const runId = searchParams.get("runId");
  const agentIdFilter = searchParams.get("agentId");
  const actionFilter = searchParams.get("action") || undefined;

  if (!runId) {
    throw new BadRequest("runId required");
  }

  const run = loadRunJson(namespaceId, runId);
  if (!run) {
    throw new NotFound("Run", runId);
  }

  const artifacts = loadArtifacts(namespaceId, runId);
  const auditEntries = loadAuditForRun(namespaceId, runId);

  const agents = run.agents || [];
  const filteredAgents = agentIdFilter
    ? agents.filter((a) => a.id === agentIdFilter)
    : agents;

  const explanations: AgentExplanation[] = filteredAgents.map((agent) => {
    // find matching artifacts
    const agentArtifacts = artifacts.filter(
      (a) => a.agentId === agent.id || a.agent === agent.id
    );

    const filesChanged: string[] = agentArtifacts.flatMap(
      (a) => a.filesChanged || []
    );

    const diff = agentArtifacts.find((a) => a.diff)?.diff;
    const diffSummary = diff
      ? diff.slice(0, 500) + (diff.length > 500 ? "\n... (truncated)" : "")
      : undefined;

    const rawOutput = agentArtifacts.find((a) => a.output || a.outputHead);
    const outputExcerpt = rawOutput?.output?.slice(0, 800) || rawOutput?.outputHead;

    const agentAudit = auditEntries.filter(
      (e) => !agentIdFilter || String(e.agent_id || e.agent || "") === agent.id
    );

    const actions = extractActions(outputExcerpt, actionFilter);

    return {
      agentId: agent.id,
      agentName: agent.name,
      prompt: agent.prompt?.slice(0, 600),
      goal: agent.goal,
      actions,
      filesChanged: [...new Set(filesChanged)],
      diffSummary,
      outputExcerpt,
      auditEntries: agentAudit.slice(0, 20),
      timestamp: agent.startedAt || agent.completedAt,
    };
  });

  return apiSuccess({
    runId,
    chainName: run.chainName,
    explanations,
    totalAuditEntries: auditEntries.length,
  });
});
