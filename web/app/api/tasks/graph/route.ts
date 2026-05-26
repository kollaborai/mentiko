import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/api-auth";
import { taskList, taskGetAllDeps } from "@/lib/task-store";
import { getWorkspaceId, hasWorkspaceParam } from "@/lib/workspace-params";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

interface BdGraphAllIssue {
  id: string;
  title: string;
  status: string;
  issue_type: string;
  priority: number;
  parent_id?: string | null;
  created_at?: string;
  metadata?: string | Record<string, unknown>;
}

interface BdGraphAllEntry {
  Root: BdGraphAllIssue;
  Issues: BdGraphAllIssue[];
}

interface DepRow {
  task_id: string;
  depends_on_id: string;
  type: string;
}

// Build connected components from issue dependencies
function buildConnectedComponents(
  issues: Array<{
    id: string;
    title: string;
    status: string;
    issue_type: string;
    priority: number;
    parent_id?: string | null;
  }>,
  depRows: DepRow[]
): BdGraphAllEntry[] {
  const adj = new Map<string, Set<string>>();
  const issueMap = new Map(issues.map((i) => [i.id, i]));

  for (const issue of issues) {
    if (!adj.has(issue.id)) adj.set(issue.id, new Set());
  }

  // Connect via dependency rows
  for (const dep of depRows) {
    if (adj.has(dep.task_id) && issueMap.has(dep.depends_on_id)) {
      adj.get(dep.task_id)!.add(dep.depends_on_id);
    }
    if (adj.has(dep.depends_on_id) && issueMap.has(dep.task_id)) {
      adj.get(dep.depends_on_id)!.add(dep.task_id);
    }
  }

  // Also connect parent-child
  for (const issue of issues) {
    if (issue.parent_id && issueMap.has(issue.parent_id)) {
      adj.get(issue.id)!.add(issue.parent_id);
      adj.get(issue.parent_id)!.add(issue.id);
    }
  }

  // BFS connected components
  const visited = new Set<string>();
  const components: Array<Set<string>> = [];

  for (const issue of issues) {
    if (visited.has(issue.id)) continue;

    const component = new Set<string>();
    const queue = [issue.id];

    while (queue.length > 0) {
      const id = queue.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      component.add(id);

      const neighbors = adj.get(id) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }

    if (component.size > 0) {
      components.push(component);
    }
  }

  const entries: BdGraphAllEntry[] = [];

  for (const component of components) {
    const componentIssues = Array.from(component).map(
      (id) => issueMap.get(id)!
    );

    let root = componentIssues.find((i) => i.issue_type === "epic");
    if (!root) {
      root = componentIssues.find((i) => !i.parent_id || !component.has(i.parent_id));
    }
    if (!root) {
      root = componentIssues[0];
    }

    entries.push({
      Root: {
        id: root.id,
        title: root.title,
        status: root.status,
        issue_type: root.issue_type,
        priority: root.priority,
        parent_id: root.parent_id,
        created_at: (root as { created_at?: string }).created_at,
        metadata: (root as { metadata?: Record<string, unknown> }).metadata,
      },
      Issues: componentIssues.map((i) => ({
        id: i.id,
        title: i.title,
        status: i.status,
        issue_type: i.issue_type,
        priority: i.priority,
        parent_id: i.parent_id,
        created_at: (i as { created_at?: string }).created_at,
        metadata: (i as { metadata?: Record<string, unknown> }).metadata,
      })),
    });
  }

  return entries;
}

// GET /api/tasks/graph - full project dependency graph (requires view_tasks)
export const GET = requirePermission("view_tasks")(
  withErrorHandling(async (request: NextRequest) => {
    const workspaceId = getWorkspaceId(request);
    const namespaceId = await getNamespaceIdFromRequest(request);
    const orgId = await getOrgIdFromRequest(request);

    if (hasWorkspaceParam(request) && !workspaceId) {
      return apiSuccess({ nodes: [], links: [], deps: [], layers: {} });
    }

    // one taskList call + one SQL call for all deps (include closed so tree toggle works)
    const issues = taskList(orgId, { status: "all" }, workspaceId, namespaceId);
    if (issues.length === 0) {
      return apiSuccess({ nodes: [], links: [], deps: [], layers: {} });
    }

    const depRows = taskGetAllDeps(orgId, namespaceId);

    // Build deps array {from: blocker, to: blocked}
    const issueIds = new Set(issues.map((i) => i.id));
    const deps: Array<{ from: string; to: string }> = [];
    for (const dep of depRows) {
      if (dep.type === "blocks" && issueIds.has(dep.task_id)) {
        deps.push({ from: dep.depends_on_id, to: dep.task_id });
      }
    }

    // Build connected components
    const entries = buildConnectedComponents(issues, depRows);

    // collect all unique issues
    const issueMap = new Map<string, BdGraphAllIssue>();
    for (const issue of issues) {
      issueMap.set(issue.id, {
        id: issue.id,
        title: issue.title,
        status: issue.status,
        issue_type: issue.issue_type,
        priority: issue.priority,
        parent_id: issue.parent_id,
        created_at: issue.created_at,
        metadata: issue.metadata,
      });
    }

    // build links from parent_id relationships + legacy ID hierarchy (parent.child)
    const links: Array<{ source: string; target: string }> = [];
    const linkSet = new Set<string>();
    // parent_id links (primary)
    for (const issue of issues) {
      if (issue.parent_id && issueMap.has(issue.parent_id)) {
        const key = `${issue.parent_id}->${issue.id}`;
        if (!linkSet.has(key)) {
          links.push({ source: issue.parent_id, target: issue.id });
          linkSet.add(key);
        }
      }
    }
    // legacy dot-notation links (backward compat)
    for (const issue of issueMap.values()) {
      const parts = issue.id.split(".");
      if (parts.length >= 2) {
        const parentId = parts.slice(0, -1).join(".");
        const key = `${parentId}->${issue.id}`;
        if (issueMap.has(parentId) && !linkSet.has(key)) {
          links.push({ source: parentId, target: issue.id });
          linkSet.add(key);
        }
      }
    }

    // build layer map (0 = no blockers, higher = more blockers)
    // index deps by task_id for fast lookup
    const depsByIssue = new Map<string, DepRow[]>();
    for (const dep of depRows) {
      if (!depsByIssue.has(dep.task_id)) depsByIssue.set(dep.task_id, []);
      depsByIssue.get(dep.task_id)!.push(dep);
    }

    const layerMap: Record<string, number> = {};
    const visited = new Set<string>();

    const assignLayer = (id: string, depth: number) => {
      if (visited.has(id)) return;
      visited.add(id);
      layerMap[id] = Math.max(layerMap[id] || 0, depth);

      const issueDeps = depsByIssue.get(id) || [];
      for (const dep of issueDeps) {
        if (dep.type === "blocks" && dep.depends_on_id) {
          assignLayer(dep.depends_on_id, depth + 1);
        }
      }
    };

    for (const entry of entries) {
      assignLayer(entry.Root.id, 0);
    }

    // build nodes with layer info
    const nodes = Array.from(issueMap.values()).map((issue) => {
      const metadata = (issue.metadata || {}) as Record<string, unknown>;

      const chainBinding = metadata.chain_id ? {
        chain_id: String(metadata.chain_id),
        chain_name: metadata.chain_name ? String(metadata.chain_name) : undefined,
        auto_run: (metadata.auto_run as boolean) ?? false,
      } : undefined;

      return {
        id: issue.id,
        label: issue.title,
        type: issue.issue_type,
        status: issue.status,
        priority: issue.priority,
        layer: layerMap[issue.id] ?? 0,
        createdAt: issue.created_at,
        metadata,
        chainBinding,
      };
    });

    return apiSuccess({ nodes, links, deps, layers: layerMap });
  })
);
