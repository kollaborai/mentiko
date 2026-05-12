import { NextRequest } from "next/server";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getAllChains } from "@/lib/chain-utils";
import { getAllStandaloneAgents } from "@/lib/agent-loader";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import config from "@/lib/config";
import { taskList } from "@/lib/task-store";
import { getWorkspaceId, hasWorkspaceParam } from "@/lib/workspace-params";

export const dynamic = "force-dynamic";

interface ChainResult {
  id: string;
  name: string;
  description?: string;
  url: string;
}

interface AgentResult {
  id: string;
  name: string;
  description?: string;
  role?: string;
  url: string;
}

interface RunResult {
  id: string;
  chain: string;
  goal: string;
  status: string;
  url: string;
}

interface TaskResult {
  id: string;
  title: string;
  description?: string;
  status: string;
  issue_type: string;
  priority: number;
  url: string;
}

interface SearchResponse {
  chains: ChainResult[];
  agents: AgentResult[];
  runs: RunResult[];
  tasks: TaskResult[];
}

function matchesQuery(text: string | undefined, query: string): boolean {
  if (!text) return false;
  return text.toLowerCase().includes(query.toLowerCase());
}

// GET /api/search?q=query - search chains, agents, runs, tasks
export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim().toLowerCase();
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const workspaceId = getWorkspaceId(request);

  if (!query) {
    return apiSuccess<SearchResponse>({
      chains: [],
      agents: [],
      runs: [],
      tasks: [],
    });
  }

  const results: SearchResponse = {
    chains: [],
    agents: [],
    runs: [],
    tasks: [],
  };

  // search chains
  try {
    const chains = getAllChains(config.chainsDir, config.cliBin, config.runsDir, namespaceId);
    for (const chain of chains) {
      if (
        matchesQuery(chain.name, query) ||
        matchesQuery(chain.description, query) ||
        chain.id.toLowerCase().includes(query)
      ) {
        results.chains.push({
          id: chain.id,
          name: chain.name,
          description: chain.description,
          url: `/chains/${chain.id}`,
        });
      }
    }
  } catch {
    // skip chain search on error
  }

  // search agents
  try {
    const agents = getAllStandaloneAgents(namespaceId);
    for (const agent of agents) {
      if (
        matchesQuery(agent.name, query) ||
        matchesQuery(agent.description, query) ||
        matchesQuery(agent.role, query) ||
        agent.id.toLowerCase().includes(query)
      ) {
        results.agents.push({
          id: agent.id,
          name: agent.name,
          description: agent.description,
          role: agent.role,
          url: `/agents/${agent.id}`,
        });
      }
    }
  } catch {
    // skip agent search on error
  }

  // search runs
  try {
    const runsDir = config.runsDir;
    if (existsSync(runsDir)) {
      const entries = readdirSync(runsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.startsWith("run-"))
        .sort((a, b) => b.name.localeCompare(a.name))
        .slice(0, 50); // limit search to 50 most recent runs

      for (const entry of entries) {
        const runFile = join(runsDir, entry.name, "run.json");
        if (!existsSync(runFile)) continue;

        try {
          const content = readFileSync(runFile, "utf-8");
          const run = JSON.parse(content);
          const runId = run.id || entry.name;

          if (
            matchesQuery(run.chain, query) ||
            matchesQuery(run.goal, query) ||
            runId.toLowerCase().includes(query)
          ) {
            results.runs.push({
              id: runId,
              chain: run.chain,
              goal: run.goal,
              status: run.status,
              url: `/runs?runId=${runId}`,
            });
          }
        } catch {
          // skip invalid run files
        }
      }
    }
  } catch {
    // skip run search on error
  }

  // search tasks
  try {
    // workspace was explicitly requested but has no tasks
    if (!hasWorkspaceParam(request) || workspaceId) {
      const issues = taskList(orgId, { query }, workspaceId, namespaceId);
      for (const issue of issues) {
        results.tasks.push({
          id: issue.id,
          title: issue.title,
          description: issue.description?.slice(0, 200),
          status: issue.status,
          issue_type: issue.issue_type,
          priority: issue.priority,
          url: `/tasks/${issue.id}`,
        });
      }
    }
  } catch {
    // skip task search on error
  }

  return apiSuccess<SearchResponse>(results);
});
