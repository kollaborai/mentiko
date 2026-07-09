import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/api-auth";
import { taskGet, taskGetAllDeps, taskList } from "@/lib/tasks/task-store";
import { sortTasksByDependencyOrder } from "@/lib/tasks/task-ordering";
import { filterVisibleTaskRecords } from "@/lib/tasks/task-visibility";
import { validateTaskId } from "@/lib/tasks/task-store";
import { getWorkspaceId } from "@/lib/workspaces/workspace-params";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { resolveTaskAutoRunDefault } from "@/lib/tasks/task-auto-run-default";
import { apiSuccess, apiError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

interface DepNode {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: number;
  issue_type: string;
  owner: string;
  created_at: string;
  created_by: string;
  updated_at: string;
  dependency_type?: string;
}

interface DepGraphOutput {
  issues: DepNode[];
  layout: {
    Nodes: Record<string, {
      Issue: DepNode;
      Layer: number;
      Position: number;
      DependsOn: string[] | null;
    }>;
    Layers: string[][];
    MaxLayer: number;
    RootID: string;
  };
  root: DepNode;
}

// GET /api/tasks/[id]/deps?format=graph|tree - get dependency info (requires view_tasks)
export const GET = requirePermission("view_tasks")(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  try {
    const { id } = await context.params;
    const safeId = validateTaskId(decodeURIComponent(id));
    const workspaceId = getWorkspaceId(request);
    const namespaceId = await getNamespaceIdFromRequest(request);
    const orgId = await getOrgIdFromRequest(request);

    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format");

    if (format === "graph") {
      // taskGet returns expanded dependencies and dependents
      const taskData = taskGet(orgId, safeId, namespaceId);
      if (!taskData) {
        return apiSuccess({ graph: null });
      }

      const toDepNode = (d: { id: string; title?: string | undefined; description?: string; status?: string; priority?: number; issue_type?: string; owner?: string; created_at?: string; created_by?: string; updated_at?: string }): DepNode => ({
        id: d.id,
        title: d.title || "",
        description: d.description || "",
        status: d.status || "open",
        priority: d.priority ?? 2,
        issue_type: d.issue_type || "task",
        owner: d.owner || "",
        created_at: d.created_at || "",
        created_by: d.created_by || "",
        updated_at: d.updated_at || "",
      });

      // blocking = tasks this issue depends on (from dependencies)
      // filter out parent-child relationships - only include real dep links
      const blocking = filterVisibleTaskRecords(taskData.dependencies || [])
        .filter(d => d.type !== "parent-child")
        .map(d => toDepNode(d));
      // blocked = tasks that depend on this issue (from dependents)
      const blocked = filterVisibleTaskRecords(taskData.dependents || [])
        .filter(d => d.type !== "parent-child")
        .map(d => toDepNode(d));

      // build graph structure
      const issues: DepNode[] = [
        ...blocking,
        {
          id: taskData.id,
          title: taskData.title,
          description: taskData.description,
          status: taskData.status,
          priority: taskData.priority,
          issue_type: taskData.issue_type,
          owner: taskData.owner,
          created_at: taskData.created_at,
          created_by: taskData.created_by,
          updated_at: taskData.updated_at,
        },
        ...blocked,
      ];

      const nodes: Record<string, {
        Issue: DepNode;
        Layer: number;
        Position: number;
        DependsOn: string[] | null;
      }> = {};

      // blocking tasks (layer 2, 1, ...)
      blocking.forEach((dep: DepNode, i: number) => {
        nodes[dep.id] = {
          Issue: dep,
          Layer: blocking.length - i,
          Position: 0,
          DependsOn: null,
        };
      });

      // current task (layer 0)
      nodes[taskData.id] = {
        Issue: {
          id: taskData.id,
          title: taskData.title,
          description: taskData.description,
          status: taskData.status,
          priority: taskData.priority,
          issue_type: taskData.issue_type,
          owner: taskData.owner,
          created_at: taskData.created_at,
          created_by: taskData.created_by,
          updated_at: taskData.updated_at,
        },
        Layer: 0,
        Position: 0,
        DependsOn: blocking.map((d: DepNode) => d.id),
      };

      // blocked tasks (layer -1, -2, ...)
      blocked.forEach((dep: DepNode, i: number) => {
        nodes[dep.id] = {
          Issue: dep,
          Layer: -(i + 1),
          Position: 0,
          DependsOn: [taskData.id],
        };
      });

      // build layers array
      const maxLayer = Math.max(...Object.values(nodes).map(n => n.Layer));
      const minLayer = Math.min(...Object.values(nodes).map(n => n.Layer));
      const layers: string[][] = [];

      for (let l = maxLayer; l >= minLayer; l--) {
        const layerIds = Object.values(nodes)
          .filter(n => n.Layer === l)
          .map(n => n.Issue.id);
        if (layerIds.length > 0) {
          layers.push(layerIds);
        }
      }

      const graph: DepGraphOutput = {
        issues,
        layout: {
          Nodes: nodes,
          Layers: layers,
          MaxLayer: maxLayer,
          RootID: taskData.id,
        },
        root: nodes[taskData.id].Issue,
      };

      return apiSuccess({ graph });
    }

    // tree format - list children
    const allIssues = filterVisibleTaskRecords(
      taskList(orgId, { status: "all" }, workspaceId, namespaceId),
    );
    const children = allIssues.filter(i => i.parent_id === safeId);
    const childIds = new Set(children.map((child) => child.id));
    const deps = taskGetAllDeps(orgId, namespaceId).filter(
      (dep) =>
        dep.type === "blocks" &&
        childIds.has(dep.task_id) &&
        childIds.has(dep.depends_on_id)
    );

    // Enrich children with the fs-backed workspace auto-run default (cached per
    // workspace) so client-side toTask() resolves Task.autoRun for each child --
    // mirrors GET /api/tasks and the task detail route.
    const sortedChildren = sortTasksByDependencyOrder(children, deps);
    const wsDefaultCache = new Map<string, boolean>();
    const enrichedChildren = sortedChildren.map((child) => {
      const wsPath = typeof child.workspace_id === "string" ? child.workspace_id : "";
      if (!wsPath) return { ...child, workspace_auto_run_default: false };
      let wsDefault = wsDefaultCache.get(wsPath);
      if (wsDefault === undefined) {
        wsDefault = resolveTaskAutoRunDefault({ namespaceId, orgId, workspacePath: wsPath });
        wsDefaultCache.set(wsPath, wsDefault);
      }
      return { ...child, workspace_auto_run_default: wsDefault };
    });
    return apiSuccess({ children: enrichedChildren });
  } catch (error: unknown) {
    return apiError(error);
  }
});
