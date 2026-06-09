import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import PtySessionsPage from "./page";
import { useTerminalPreferences } from "@/lib/ui/terminal-preferences";

jest.mock("@/lib/hooks/use-namespace-fetch", () => ({
  useNamespaceFetch: () => ({
    fetchWithNamespace: jest.fn(async (url: string) => {
      if (url === "/api/pty/sessions") {
        return {
          ok: true,
          json: async () => ({ data: { sessions: [] } }),
        };
      }
      return { ok: true, json: async () => ({ data: {} }) };
    }),
  }),
}));

jest.mock("@/components/ui/page-banner", () => ({
  PageBanner: ({ title }: { title: string }) => <div>{title}</div>,
}));

jest.mock("@aliimam/icons", () => {
  const icon = (name: string) =>
    function MockIcon({ className }: { className?: string }) {
      return <svg data-testid={`icon-${name}`} className={className} />;
    };
  return {
    RefreshFilled: icon("refresh"),
    CommandSquareFilled: icon("command-square"),
    ArrowDown2Filled: icon("arrow-down"),
    ArrowUp2Filled: icon("arrow-up"),
    CloseCircleFilled: icon("close-circle"),
    RotateLeftFilled: icon("rotate-left"),
    DocumentTextFilled: icon("document-text"),
    Setting2Filled: icon("setting"),
  };
});

describe("PtySessionsPage terminal preferences", () => {
  beforeEach(() => {
    localStorage.clear();
    useTerminalPreferences.setState({
      prefs: { autoCdFloatingTerminalToWorkspace: false },
    });
  });

  it("persists the floating terminal auto-cd feature flag", async () => {
    render(<PtySessionsPage />);

    const toggle = screen.getByRole("switch", {
      name: "Auto-cd floating terminal to active workspace",
    });
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);

    await waitFor(() => expect(toggle).toBeChecked());
    expect(JSON.parse(localStorage.getItem("terminal-preferences") ?? "{}")).toMatchObject({
      autoCdFloatingTerminalToWorkspace: true,
    });
  });
});
