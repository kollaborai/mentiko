import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { loadOrg, orgMatchesId } from "@/lib/orgs/org-storage";
import { nsPath } from "@/lib/config";
import { Unauthorized, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

// GET /api/orgs/[id]/stats - get org statistics
export const GET = withErrorHandling(
  async (request: NextRequest, context: RouteCtx) => {
    if (!(await checkAuth(request))) {
      throw new Unauthorized();
    }

    const namespaceId = await getNamespaceIdFromRequest(request);
    const { id } = await context.params;
    const org = await loadOrg(namespaceId);

    if (!org || !orgMatchesId(org, id)) {
      throw new NotFound("Org", id);
    }

    // count chains, tasks, runs in namespace directory
    const { promises: fs } = await import("fs");
    const { join } = await import("path");

    const namespaceRoot = nsPath(namespaceId);

    // count chains
    let chainCount = 0;
    try {
      const chainsDir = join(namespaceRoot, "chains");
      const chainDirs = await fs.readdir(chainsDir);
      chainCount = chainDirs.filter((d: string) =>
        d.endsWith(".json") === false
      ).length;
    } catch {
      chainCount = 0;
    }

    // count members (from members.json)
    let memberCount = 1; // default 1 (owner)
    try {
      const membersPath = join(namespaceRoot, "org", "members.json");
      const membersData = await fs.readFile(membersPath, "utf-8");
      const members = JSON.parse(membersData);
      memberCount = Array.isArray(members) ? members.length : 1;
    } catch {
      memberCount = 1;
    }

    // count tasks (from native sqlite task store)
    let taskCount = 0;
    try {
      const { taskList } = await import("@/lib/tasks/task-store");
      const tasks = taskList(id, { status: "all" }, undefined, namespaceId);
      taskCount = tasks.length;
    } catch {
      taskCount = 0;
    }

    // count runs (each run is a subdirectory)
    let runCount = 0;
    try {
      const runsDir = join(namespaceRoot, "runs");
      const entries = await fs.readdir(runsDir, { withFileTypes: true });
      runCount = entries.filter((e) => e.isDirectory()).length;
    } catch {
      runCount = 0;
    }

    return apiSuccess({
      stats: {
        chainCount,
        memberCount,
        taskCount,
        runCount,
      },
    });
  }
);
