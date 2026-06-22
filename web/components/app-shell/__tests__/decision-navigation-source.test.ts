import { readFileSync } from "fs";

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
  "app/api/mentiko-mcp/ops/meta/nav/route.ts",
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

  it("redirects the legacy decisions route before auth gating", () => {
    const proxy = readFileSync("proxy.ts", "utf8");

    expect(proxy).toContain('pathname === "/decisions"');
    expect(proxy).toContain('url.pathname = "/tasks"');
    expect(proxy).toContain('url.searchParams.set("type", "decision")');
    expect(proxy).toContain('url.searchParams.set("decisionId", decisionId)');
  });

  it("maps old decisionId links onto linked task rows in the task page", () => {
    const tasksPage = readFileSync("app/tasks/page.tsx", "utf8");

    expect(tasksPage).toContain('const decisionId = searchParams.get("decisionId")');
    expect(tasksPage).toContain('task.metadata?.decision_id === decisionId');
    expect(tasksPage).toContain("onDecisionUpdate={handleDecisionUpdate}");
  });
});
