import { fireEvent, render, screen, within } from "@testing-library/react";
import SettingsLayout from "./layout";

const push = jest.fn();

jest.mock("next/navigation", () => ({
  usePathname: () => "/settings",
  useRouter: () => ({ push }),
}));

jest.mock("@/lib/auth-client", () => ({
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
    DocumentTextFilled: Icon,
    Element3Filled: Icon,
    ExportFilled: Icon,
    KeyFilled: Icon,
    LockFilled: Icon,
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
  });

  it("includes MCP in the settings sidebar navigation", () => {
    render(
      <SettingsLayout>
        <div>settings content</div>
      </SettingsLayout>,
    );

    const sidebar = screen.getByTestId("settings-sidebar-nav");
    const mcpButton = within(sidebar).getByRole("button", { name: /mcp/i });

    expect(mcpButton).toBeInTheDocument();
    fireEvent.click(mcpButton);
    expect(push).toHaveBeenCalledWith("/settings/mcp");
  });
});
