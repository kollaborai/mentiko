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
});
