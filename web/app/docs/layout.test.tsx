import { render, screen } from "@testing-library/react";
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
});
