import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("task API visibility source contract", () => {
  const apiRoot = join(process.cwd(), "app/api/tasks");
  const detailSource = readFileSync(join(apiRoot, "[id]/route.ts"), "utf8");
  const depsSource = readFileSync(join(apiRoot, "[id]/deps/route.ts"), "utf8");
  const graphSource = readFileSync(join(apiRoot, "graph/route.ts"), "utf8");
  const epicsSource = readFileSync(join(apiRoot, "epics/route.ts"), "utf8");

  it("hides superseded decision gates from direct task detail fetches", () => {
    expect(detailSource).toContain('from "@/lib/tasks/task-visibility"');
    expect(detailSource).toContain("filterVisibleTaskRecords(");
    expect(detailSource).toContain("if (!visibleTaskIds.has(issue.id))");
  });

  it("hides superseded decision gates from child/dependency APIs", () => {
    expect(depsSource).toContain("filterVisibleTaskRecordsWithVisibleParents(");
    expect(depsSource).toContain("if (!allIssues.some((issue) => issue.id === safeId))");
    expect(graphSource).toContain("filterVisibleTaskRecordsWithVisibleParents(");
    expect(graphSource).toContain("issueIds.has(dep.task_id) && issueIds.has(dep.depends_on_id)");
  });

  it("keeps epic progress on the same visibility and terminal-status contract", () => {
    expect(epicsSource).toContain("filterVisibleTaskRecordsWithVisibleParents(");
    expect(epicsSource).toContain("isTerminalTaskStatus(child.status)");
  });
});
