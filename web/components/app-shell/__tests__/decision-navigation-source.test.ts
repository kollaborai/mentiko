import { existsSync, readFileSync } from "fs";

const staleDecisionLinkFiles = [
  "components/app-shell/global-search-modal.tsx",
  "components/dashboard/pending-decisions.tsx",
  "components/dashboard/emergency-mode.tsx",
  "components/task/task-detail-header.tsx",
  "components/ui/entity-hover-card.tsx",
  "app/settings/decisions/page.tsx",
  "app/docs/icon-system/page.tsx",
  "app/docs/tasks/page.tsx",
  "app/docs/decisions/page.tsx",
  "app/api/notifications/route.ts",
  "app/api/notifications/dispatch/route.ts",
];

describe("decision navigation", () => {
  it.each(staleDecisionLinkFiles)(
    "%s routes decision work through task decisions",
    (file) => {
      const source = readFileSync(file, "utf8");
      expect(source).not.toContain('href: "/decisions"');
      expect(source).not.toContain('href="/decisions"');
      expect(source).not.toContain("href={`/decisions?");
      expect(source).toContain("/tasks?type=decision");
    },
  );

  it("keeps MCP nav metadata aligned with the single Tasks workspace entry", () => {
    const source = readFileSync("app/api/mentiko-mcp/ops/meta/nav/route.ts", "utf8");

    expect(source).toContain('{ href: "/tasks", label: "Tasks" }');
    expect(source).not.toContain('label: "Decisions"');
    expect(source).not.toContain('href: "/decisions"');
    expect(source).not.toContain("/tasks?type=decision");
  });

  it("keeps task creation behind one sidebar entry and modal flags", () => {
    const filters = readFileSync("components/task/task-filters.tsx", "utf8");
    const tasksPage = readFileSync("app/tasks/page.tsx", "utf8");
    const dialog = readFileSync("components/task/task-generate-dialog.tsx", "utf8");

    expect(filters).not.toContain("onGenerateDecision");
    expect(filters).not.toContain("onCreate?");
    expect(filters).not.toContain("title=\"New task\"");
    expect(filters).not.toContain("title=\"Generate decision with AI\"");
    expect(tasksPage).not.toContain("<TaskCreateDialog");
    expect(tasksPage).toContain('presentation="panel"');
    expect(dialog).toContain("Create Work Item");
    expect(dialog).toContain("bg-background p-4");
    expect(dialog).toContain("w-full h-56");
    expect(dialog).not.toContain("min-h-48 flex-1");
    expect(dialog).toContain("Task</span>");
    expect(dialog).toContain("Decision</span>");
    expect(dialog).not.toContain('modeButtonClass("manual")');
    expect(dialog).toContain("setTaskEntryMode(\"manual\")");
    expect(dialog).not.toContain("Human</span>");
    expect(dialog).not.toContain("Plain</span>");
    expect(dialog).toContain("Decision if warranted");
  });

  it("gives decision work a gate treatment in task graph views", () => {
    const tree = readFileSync("components/task/task-tree-view.tsx", "utf8");
    const overview = readFileSync("components/task/task-overview.tsx", "utf8");
    const listItem = readFileSync("components/task/task-list-item.tsx", "utf8");

    expect(tree).toContain('node.type === "decision"');
    expect(tree).toContain("gate");
    expect(overview).toContain('task.type === "decision"');
    expect(overview).toContain("gate");
    expect(listItem).toContain("human decision gate");
  });

  it("does not keep the standalone decisions route alive", () => {
    const proxy = readFileSync("proxy.ts", "utf8");

    expect(existsSync("app/decisions/page.tsx")).toBe(false);
    expect(existsSync("app/decisions/page.test.tsx")).toBe(false);
    expect(proxy).not.toContain('pathname === "/decisions"');
    expect(proxy).not.toContain('url.pathname = "/tasks"');
  });

  it("does not keep decisionId task-url compatibility paths", () => {
    const tasksPage = readFileSync("app/tasks/page.tsx", "utf8");
    const taskGenerateDialog = readFileSync("components/task/task-generate-dialog.tsx", "utf8");
    const emergencyMode = readFileSync("components/dashboard/emergency-mode.tsx", "utf8");
    const pendingDecisions = readFileSync("components/dashboard/pending-decisions.tsx", "utf8");
    const entityHoverCard = readFileSync("components/ui/entity-hover-card.tsx", "utf8");
    const notificationsRoute = readFileSync("app/api/notifications/route.ts", "utf8");

    for (const source of [
      tasksPage,
      taskGenerateDialog,
      emergencyMode,
      pendingDecisions,
      entityHoverCard,
      notificationsRoute,
    ]) {
      expect(source).not.toContain("decisionId=");
      expect(source).not.toContain('searchParams.get("decisionId")');
    }
    expect(tasksPage).toContain("onDecisionUpdate={handleDecisionUpdate}");
  });
});
