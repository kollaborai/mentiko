import { render, waitFor } from "@testing-library/react";
import * as React from "react";
import { RootLayoutClient } from "./layout-client";

let mockPathname = "/login";
let mockIsFloatingPanelSurface = false;
const mockHydrate = jest.fn();
let mockThemeProviderMounts = 0;
let mockThemeProviderUnmounts = 0;

function MockThemeProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    mockThemeProviderMounts += 1;
    return () => {
      mockThemeProviderUnmounts += 1;
    };
  }, []);
  return <div data-testid="theme-provider">{children}</div>;
}

jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("next-themes", () => ({
  ThemeProvider: MockThemeProvider,
}));

jest.mock("@/components/must-change-password-gate", () => ({
  MustChangePasswordGate: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="session-gate">{children}</div>
  ),
}));

jest.mock("@/lib/namespace-context", () => ({
  NamespaceProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@/lib/workspace-context", () => ({
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@/lib/user-context", () => ({
  UserProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@/components/notifications-panel", () => ({
  ToastContainer: () => null,
}));

jest.mock("@/hooks/use-notifications-listener", () => ({
  useNotificationsListener: jest.fn(),
}));

jest.mock("@/components/offline-indicator", () => ({
  OfflineIndicator: () => null,
  OnlineStatusBanner: () => null,
}));

jest.mock("@/lib/sync-queue", () => ({
  useSyncQueue: () => ({ process: jest.fn() }),
}));

jest.mock("@/hooks", () => ({
  useOnlineStatus: () => ({ isOnline: true, wasOffline: false }),
}));

jest.mock("@/lib/notification-preferences", () => ({
  useNotificationPreferences: () => ({ init: jest.fn() }),
}));

jest.mock("@/components/global-search-modal", () => ({
  GlobalSearchModal: () => null,
}));

jest.mock("@/components/keyboard-shortcuts-modal", () => ({
  KeyboardShortcutsModal: () => null,
}));

jest.mock("@/components/floating-terminal-panel", () => ({
  FloatingTerminalPanel: () => null,
}));

jest.mock("@/components/floating-pill-nav", () => ({
  FloatingPillNav: () => null,
}));

jest.mock("@/components/floating-app-panels", () => ({
  FloatingAppPanels: () => null,
}));

jest.mock("@/components/editor/floating-code-pill", () => ({
  FloatingCodePill: () => null,
}));

jest.mock("@/components/onboarding/floating-welcome-panel", () => ({
  FloatingWelcomePanel: () => null,
}));

jest.mock("@/components/floating-kollabor-bar", () => ({
  FloatingKollaborBar: () => null,
}));

jest.mock("@/lib/kollabor-bar-flag", () => ({
  isKollaborBarEnabled: () => false,
}));

jest.mock("@/lib/floating-app-panel-routing", () => ({
  getFloatingPanelSrc: (path: string) => path,
  isFloatingPanelRoute: () => false,
  isFloatingPanelSurface: () => mockIsFloatingPanelSurface,
}));

jest.mock("@/lib/pill-nav-preferences", () => ({
  usePillNavPreferences: (selector: (state: { hydrate: () => void }) => unknown) =>
    selector({ hydrate: mockHydrate }),
}));

jest.mock("@/lib/user-display-preferences", () => ({
  applyStoredUserDisplayPreferences: jest.fn(),
}));

describe("RootLayoutClient", () => {
  beforeEach(() => {
    mockPathname = "/login";
    mockIsFloatingPanelSurface = false;
    mockHydrate.mockReset();
    mockThemeProviderMounts = 0;
    mockThemeProviderUnmounts = 0;
    document.documentElement.removeAttribute("data-floating-panel-surface");
    document.body.removeAttribute("data-floating-panel-surface");
  });

  it("keeps the theme provider mounted when leaving standalone auth routes", async () => {
    const { rerender } = render(
      <RootLayoutClient>
        <div>page content</div>
      </RootLayoutClient>,
    );

    await waitFor(() => expect(mockThemeProviderMounts).toBe(1));

    mockPathname = "/dashboard";
    rerender(
      <RootLayoutClient>
        <div>page content</div>
      </RootLayoutClient>,
    );

    await waitFor(() => expect(mockThemeProviderMounts).toBe(1));
    expect(mockThemeProviderUnmounts).toBe(0);
  });

  it.each(["/login", "/signup", "/forgot-password", "/reset-password", "/welcome"])(
    "renders %s outside the session gate",
    (path) => {
      mockPathname = path;

      const { queryByTestId } = render(
        <RootLayoutClient>
          <div>public auth content</div>
        </RootLayoutClient>,
      );

      expect(queryByTestId("session-gate")).not.toBeInTheDocument();
    },
  );

  it("wraps protected pages in the session gate", () => {
    mockPathname = "/dashboard";

    const { getByTestId } = render(
      <RootLayoutClient>
        <div>dashboard content</div>
      </RootLayoutClient>,
    );

    expect(getByTestId("session-gate")).toBeInTheDocument();
  });

  it("marks panel-surface documents so iframe backgrounds stay transparent", async () => {
    mockPathname = "/runs";
    mockIsFloatingPanelSurface = true;

    const { container, unmount } = render(
      <RootLayoutClient>
        <div>panel content</div>
      </RootLayoutClient>,
    );

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-floating-panel-surface", "true");
      expect(document.body).toHaveAttribute("data-floating-panel-surface", "true");
    });
    expect(container.querySelector("[data-panel-mode-background]")).toBeInTheDocument();
    expect(container.querySelector("[data-app-background]")).not.toBeInTheDocument();
    expect(container.querySelector('[data-panel-mode-background-layer="0"]')).toHaveStyle({
      backgroundImage:
        "radial-gradient(circle at 1px 1px, #111113 0.5px, transparent 0)",
      backgroundSize: "8px 8px",
      opacity: "0.3",
    });
    expect(container.querySelector('[data-panel-mode-background-layer="1"]')).toHaveStyle({
      backgroundImage:
        "radial-gradient(circle at 1px 1px, #18181b 1px, transparent 0)",
      backgroundSize: "24px 24px",
      opacity: "0.2",
    });
    expect(container.querySelector('[data-panel-mode-background-layer="2"]')).toHaveStyle({
      backgroundImage:
        "radial-gradient(circle at 1px 1px, #242428 2px, transparent 0)",
      backgroundSize: "56px 56px",
      opacity: "0.15",
    });

    unmount();

    await waitFor(() => {
      expect(document.documentElement).not.toHaveAttribute("data-floating-panel-surface");
      expect(document.body).not.toHaveAttribute("data-floating-panel-surface");
    });
  });

  it("forwards setup wizard and cmd+k requests from panel documents to the parent shell", async () => {
    mockPathname = "/dashboard";
    mockIsFloatingPanelSurface = true;
    const postMessage = jest.spyOn(window.parent, "postMessage").mockImplementation(() => {});

    render(
      <RootLayoutClient>
        <div>panel content</div>
      </RootLayoutClient>,
    );

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-floating-panel-surface", "true");
    });

    window.dispatchEvent(new CustomEvent("open-welcome-panel"));
    window.dispatchEvent(new CustomEvent("open-global-search"));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));

    expect(postMessage).toHaveBeenCalledWith({ type: "mentiko-open-welcome-panel" }, window.location.origin);
    expect(postMessage).toHaveBeenCalledWith({ type: "mentiko-open-global-search" }, window.location.origin);
    expect(postMessage).toHaveBeenCalledTimes(3);
  });

  it("bridges panel messages back into parent shell events", async () => {
    mockPathname = "/dashboard";
    mockIsFloatingPanelSurface = false;
    const openWelcome = jest.fn();
    const openSearch = jest.fn();
    window.addEventListener("open-welcome-panel", openWelcome);
    window.addEventListener("open-global-search", openSearch);

    render(
      <RootLayoutClient>
        <div>page content</div>
      </RootLayoutClient>,
    );

    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      data: { type: "mentiko-open-welcome-panel" },
    }));
    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      data: { type: "mentiko-open-global-search" },
    }));
    window.dispatchEvent(new MessageEvent("message", {
      origin: "https://example.com",
      data: { type: "mentiko-open-global-search" },
    }));

    await waitFor(() => {
      expect(openWelcome).toHaveBeenCalledTimes(1);
      expect(openSearch).toHaveBeenCalledTimes(1);
    });

    window.removeEventListener("open-welcome-panel", openWelcome);
    window.removeEventListener("open-global-search", openSearch);
  });
});
