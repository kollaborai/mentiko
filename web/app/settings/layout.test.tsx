import { fireEvent, render, screen, within } from "@testing-library/react";
import SettingsLayout from "./layout";

const push = jest.fn();

jest.mock("next/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({ push }),
}));

jest.mock("@/lib/auth/auth-client", () => ({
  useSession: () => ({
    data: {
      user: {
        name: "Marco",
        email: "marco@example.com",
      },
    },
  }),
}));

jest.mock("@aliimam/icons", () => {
  const Icon = () => <span data-testid="icon" />;
  return {
    ActivityFilled: Icon,
    ArrowLeftFilled: Icon,
    BotMessageSquare: Icon,
    CategoryFilled: Icon,
    ChartFilled: Icon,
    CloseCircleFilled: Icon,
    CloudConnectionFilled: Icon,
    ColorSwatchFilled: Icon,
    CommandSquareFilled: Icon,
    Code1Filled: Icon,
    DocumentTextFilled: Icon,
    Element3Filled: Icon,
    ExportFilled: Icon,
    KeyFilled: Icon,
    JudgeFilled: Icon,
    LockFilled: Icon,
    MagicStarFilled: Icon,
    MenuFilled: Icon,
    MessageQuestionFilled: Icon,
    NotificationFilled: Icon,
    PeopleFilled: Icon,
    SecurityFilled: Icon,
    Setting2Filled: Icon,
    ShieldTickFilled: Icon,
    SmsFilled: Icon,
    TrendUpFilled: Icon,
    UserFilled: Icon,
  };
});

describe("SettingsLayout", () => {
  beforeEach(() => {
    push.mockReset();
    window.history.pushState({}, "", "/settings");
  });

  it("does not include docs-only MCP in the settings sidebar navigation", () => {
    render(
      <SettingsLayout>
        <div>settings content</div>
      </SettingsLayout>,
    );

    const sidebar = screen.getByTestId("settings-sidebar-nav");

    expect(within(sidebar).queryByRole("button", { name: /mcp/i })).not.toBeInTheDocument();
  });

  it("includes decision settings in the sidebar navigation", () => {
    render(
      <SettingsLayout>
        <div>settings content</div>
      </SettingsLayout>,
    );

    const sidebar = screen.getByTestId("settings-sidebar-nav");

    expect(within(sidebar).getByRole("button", { name: /decisions/i })).toBeInTheDocument();
  });

  it("preserves panel surface when settings sidebar uses client routing", () => {
    window.history.pushState({}, "", "/settings?surface=panel");

    render(
      <SettingsLayout>
        <div>settings content</div>
      </SettingsLayout>,
    );

    fireEvent.click(screen.getByRole("button", { name: /navigation bar/i }));

    expect(push).toHaveBeenCalledWith("/settings/pill-nav?surface=panel");
  });
});
