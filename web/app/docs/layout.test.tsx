import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import DocsLayout from "./layout";

jest.mock("next/navigation", () => ({
  usePathname: () => "/docs/mcp",
}));

jest.mock("@aliimam/icons", () => {
  const Icon = (props: React.SVGProps<SVGSVGElement>) => <svg {...props} />;
  return {
    ActivityFilled: Icon,
    BotMessageSquare: Icon,
    BoxFilled: Icon,
    CategoryFilled: Icon,
    ChartFilled: Icon,
    ChevronDown: Icon,
    ChevronRight: Icon,
    ClockFilled: Icon,
    CloudConnectionFilled: Icon,
    CodeFilled: Icon,
    ColorSwatchFilled: Icon,
    CommandSquareFilled: Icon,
    DirectSendFilled: Icon,
    Element2Filled: Icon,
    JudgeFilled: Icon,
    LinkFilled: Icon,
    MagicStarFilled: Icon,
    MessageCircleFilled: Icon,
    MonitorFilled: Icon,
    NotificationFilled: Icon,
    Palette: Icon,
    PeopleFilled: Icon,
    Rocket: Icon,
    RouteSquareFilled: Icon,
    Search: Icon,
    SendFilled: Icon,
    Shield: Icon,
    ShopFilled: Icon,
    TaskSquareFilled: Icon,
    Webhook: Icon,
  };
});

describe("DocsLayout", () => {
  it("includes MCP in the docs sidebar navigation", () => {
    render(
      <DocsLayout>
        <div>docs content</div>
      </DocsLayout>,
    );

    expect(screen.getByRole("link", { name: /mcp/i })).toHaveAttribute(
      "href",
      "/docs/mcp",
    );
  });

  it("exposes docs sidebar hooks for floating panel transparency", () => {
    render(
      <DocsLayout>
        <div>docs content</div>
      </DocsLayout>,
    );

    expect(screen.getByTestId("docs-sidebar")).toHaveAttribute("data-docs-sidebar");
    expect(screen.getByTestId("docs-sidebar-header")).toHaveAttribute("data-docs-sidebar-header");
    expect(screen.getByTestId("docs-content")).toHaveAttribute("data-docs-content");
    expect(screen.getByPlaceholderText("search... (cmd+k)")).toHaveAttribute("data-docs-search");
    expect(screen.getByRole("link", { name: /mcp/i })).toHaveAttribute("data-docs-link");
    expect(screen.getByRole("link", { name: /mcp/i })).toHaveAttribute("data-active", "true");
  });

  it("tunes docs chrome only inside floating panel documents", () => {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

    expect(css).toContain("html[data-floating-panel-surface] [data-docs-sidebar]");
    expect(css).toContain("html[data-floating-panel-surface] [data-docs-sidebar-header]");
    expect(css).toContain("html[data-floating-panel-surface] main#main-content");
    expect(css).toContain("html[data-floating-panel-surface] [data-docs-content] .bg-card");
    expect(css).toContain("html[data-floating-panel-surface] [data-docs-search]");
    expect(css).toContain("html[data-floating-panel-surface] [data-docs-link]");
    expect(css).toContain("html[data-floating-panel-surface] [data-docs-card]");
    expect(css).toContain("var(--muted) var(--floating-panel-docs-sidebar-mix), transparent) !important");
    expect(css).toContain("var(--background) var(--floating-panel-body-mix), transparent) !important");
    expect(css).toContain("var(--card) var(--floating-panel-docs-surface-mix), transparent) !important");
  });
});
