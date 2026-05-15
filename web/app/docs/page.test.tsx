import { render, screen } from "@testing-library/react";
import DocsIndexPage from "./page";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/components/ui/page-banner", () => ({
  PageBanner: ({ title, subtitle }: { title: string; subtitle: string }) => (
    <header>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </header>
  ),
}));

jest.mock("@aliimam/icons", () => {
  const Icon = (props: React.SVGProps<SVGSVGElement>) => <svg {...props} />;
  return {
    ActivityFilled: Icon,
    ArrowRight: Icon,
    BotMessageSquare: Icon,
    BoxFilled: Icon,
    CategoryFilled: Icon,
    ChartFilled: Icon,
    ClockFilled: Icon,
    CloudConnectionFilled: Icon,
    CodeFilled: Icon,
    ColorSwatchFilled: Icon,
    CommandSquareFilled: Icon,
    DirectSendFilled: Icon,
    DocumentTextFilled: Icon,
    HomeFilled: Icon,
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

describe("DocsIndexPage", () => {
  it("exposes docs search and card hooks for floating panel transparency", () => {
    render(<DocsIndexPage />);

    expect(screen.getByPlaceholderText("search docs... (cmd+k)")).toHaveAttribute("data-docs-search");
    expect(screen.getByRole("link", { name: /create a chain/i })).toHaveAttribute("data-docs-card");
    expect(screen.getByRole("link", { name: /chains agent pipeline definitions/i })).toHaveAttribute(
      "data-docs-card",
    );
    expect(screen.getByTestId("docs-architecture-panel")).toHaveAttribute("data-docs-card");
  });
});
