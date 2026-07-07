import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("tasks page source contract", () => {
  const source = readFileSync(join(process.cwd(), "app/tasks/page.tsx"), "utf8");

  it("keeps list/detail as a single-pane workflow until the large breakpoint", () => {
    expect(source).toContain('mobileView === "detail" ? "hidden lg:flex" : "flex"');
    expect(source).toContain('mobileView === "list" ? "hidden lg:flex" : "flex"');
    expect(source).toContain("} lg:flex`}");
    expect(source).not.toContain("hidden md:flex");
    expect(source).not.toContain("} md:flex`}");
  });

  it("clears stale selected task state when a selected detail fetch 404s", () => {
    expect(source).toContain("if (detailRes && detailRes.status === 404)");
    expect(source).toContain("setSelected((prev) => (prev?.id === task.id ? null : prev))");
  });

  it("refreshes the task tree after decision updates and deletes", () => {
    expect(source).toContain("const [treeRefreshSignal, setTreeRefreshSignal] = useState(0)");
    expect(source).toContain("setTreeRefreshSignal((value) => value + 1)");
    expect(source).toContain("refreshSignal={treeRefreshSignal}");
  });
});
