import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import MentikoAgentSettingsPage from "./page";
import {
  FONT_SCALE_DEFAULT,
  KOLLABOR_BAR_APPEARANCE_DEFAULTS,
  BAR_SHUTDOWN_ERROR,
  LS_YOLO_KEY,
  setKollaborBarStorageScope,
  useKollaborBarStore,
} from "@/lib/ui/kollabor-bar-store";

let mockScopeError: string | null = null;
let mockShutdownRetryable = false;
let mockShutdownSessionUnknown = false;
let mockShutdownCancellationUnverifiable = false;
const mockRetryScope = jest.fn();
const mockRetryShutdown = jest.fn();

jest.mock("@/components/app-shell/floating-bar-storage-scope", () => ({
  useFloatingBarStorageScope: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useKollaborBarStore: store } = require("@/lib/ui/kollabor-bar-store") as typeof import("@/lib/ui/kollabor-bar-store");
    const state = store();
    return {
      storageScopeReady: state.storageScopeReady,
      storageScope: state.storageScope,
      scopeError: mockScopeError,
      bridgeError: null,
      bridgePending: false,
      shutdownRetryable: mockShutdownRetryable,
      shutdownSessionUnknown: mockShutdownSessionUnknown,
      shutdownCancellationUnverifiable: mockShutdownCancellationUnverifiable,
      retryScope: mockRetryScope,
      retryBridge: jest.fn(),
      retryShutdown: mockRetryShutdown,
      setEnabled: state.setEnabled,
      setBarWidth: state.setBarWidth,
      setAppearance: state.setAppearance,
    };
  },
}));

jest.mock("@/components/ui/page-banner", () => ({
  PageBanner: ({ title, subtitle }: { title: string; subtitle: string }) => (
    <div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </div>
  ),
}));

jest.mock("@aliimam/icons", () => {
  const Icon = (props: React.SVGProps<SVGSVGElement>) => <svg {...props} />;
  return {
    AddFilled: Icon,
    CloseCircleFilled: Icon,
    CloudConnectionFilled: Icon,
    MagicStarFilled: Icon,
    FlashFilled: Icon,
    RefreshFilled: Icon,
    Setting2Filled: Icon,
    ShieldTickFilled: Icon,
    TickCircleFilled: Icon,
    TrashFilled: Icon,
    ArrowDown2Filled: Icon,
  };
});

jest.mock(
  "@aliimam/logos",
  () => {
    const Logo = (props: React.SVGProps<SVGSVGElement>) => <svg {...props} />;
    return {
      ClaudeAI: Logo,
      GoogleGemini: Logo,
      OpenAI: Logo,
    };
  },
  { virtual: true },
);

async function renderSettingsPage() {
  await act(async () => {
    render(<MentikoAgentSettingsPage />);
  });
}

describe("MentikoAgentSettingsPage font settings", () => {
  beforeEach(() => {
    localStorage.clear();
    mockScopeError = null;
    mockShutdownRetryable = false;
    mockShutdownSessionUnknown = false;
    mockShutdownCancellationUnverifiable = false;
    mockRetryScope.mockReset();
    mockRetryShutdown.mockReset();
    setKollaborBarStorageScope(null);
    setKollaborBarStorageScope("settings:test:user");
    useKollaborBarStore.getState().setFontScale(FONT_SCALE_DEFAULT);
    useKollaborBarStore.setState({
      enabled: true,
      storageScope: "settings:test:user",
      storageScopeReady: true,
      preferenceReadResolved: true,
      preferenceStorageError: null,
      cleanupBlocked: false,
      shutdownError: null,
      barWidth: 373,
      appearance: { ...KOLLABOR_BAR_APPEARANCE_DEFAULTS },
    });
    (globalThis as unknown as { fetch: jest.Mock }).fetch = jest
      .fn()
      .mockImplementation((url: string) => {
        if (url.includes("/api/secrets")) {
          return Promise.resolve({ ok: true, json: async () => ({ data: { secrets: [] } }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({ profiles: [], active: "", count: 0 }) });
      });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("persists the large agent text preset from settings", async () => {
    await renderSettingsPage();

    fireEvent.click(screen.getByRole("button", { name: "Large" }));

    expect(useKollaborBarStore.getState().fontScale).toBe(1.2);
    expect(localStorage.getItem("mentiko-kollabor-font-scale")).toBe("1.2");
    await waitFor(() => expect(screen.getByText("120%")).toBeInTheDocument());
  });

  it("keeps profile action buttons the same size", async () => {
    (globalThis as unknown as { fetch: jest.Mock }).fetch.mockImplementation((url: string) => {
      if (url.includes("/api/secrets")) {
        return Promise.resolve({ ok: true, json: async () => ({ data: { secrets: [] } }) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          profiles: [
            {
              name: "claude",
              provider: "anthropic",
              model: "claude-sonnet-4-6",
              temperature: 0.7,
              max_tokens: null,
              timeout: 0,
              description: "",
              streaming: true,
              supports_tools: true,
            },
          ],
          active: "default",
          count: 1,
        }),
      });
    });

    await renderSettingsPage();

    const setActive = await screen.findByRole("button", { name: "Set Active" });
    const test = screen.getByRole("button", { name: "Test" });
    const edit = screen.getByRole("button", { name: "Edit" });

    expect(setActive).toHaveClass("w-20", "h-7", "text-xs");
    expect(test).toHaveClass("w-20", "h-7", "text-xs");
    expect(edit).toHaveClass("w-20", "h-7", "text-xs");
  });

  it("keeps preference controls hydrated when the separate profiles endpoint returns 503", async () => {
    (globalThis as unknown as { fetch: jest.Mock }).fetch.mockImplementation((url: string) => {
      if (url.includes("/api/secrets")) {
        return Promise.resolve({ ok: true, json: async () => ({ data: { secrets: [] } }) });
      }
      return Promise.resolve({ ok: false, status: 503, json: async () => ({ error: "engine unavailable" }) });
    });

    await renderSettingsPage();

    expect(await screen.findByText("Failed to load profiles: 503")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enable floating bar" })).toBeEnabled();
    expect(screen.getByRole("switch", { name: "YOLO mode" })).toBeEnabled();
    expect(screen.getByRole("spinbutton", { name: "Floating bar width in pixels" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Backdrop" })).toHaveAttribute("aria-expanded", "false");
  });

  it("exposes an accessible scoped switch and persists a local toggle", async () => {
    await renderSettingsPage();

    const toggle = screen.getByRole("switch", { name: "Enable floating bar" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);

    expect(useKollaborBarStore.getState().enabled).toBe(false);
    expect(localStorage.getItem("mentiko-kollabor-enabled:settings:test:user")).toBe("0");
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("does not offer a no-op shutdown retry when the pending session ID is unknown", async () => {
    mockShutdownSessionUnknown = true;
    useKollaborBarStore.setState({
      cleanupBlocked: true,
      shutdownError: BAR_SHUTDOWN_ERROR,
    });

    await renderSettingsPage();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "session ID is unknown, so shutdown cannot be retried safely",
    );
    expect(screen.queryByRole("button", { name: "Retry stopping" })).not.toBeInTheDocument();
    expect(mockRetryShutdown).not.toHaveBeenCalled();
  });

  it("does not offer unsafe shutdown retry for a known but unverified session", async () => {
    mockShutdownCancellationUnverifiable = true;
    useKollaborBarStore.setState({
      cleanupBlocked: true,
      shutdownError: BAR_SHUTDOWN_ERROR,
    });

    await renderSettingsPage();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "safe shutdown retry requires turn-scoped, idempotent cancellation",
    );
    expect(screen.queryByRole("button", { name: "Retry stopping" })).not.toBeInTheDocument();
    expect(mockRetryShutdown).not.toHaveBeenCalled();
  });

  it("names the YOLO switch and explains the new-scope default and approval behavior", async () => {
    await renderSettingsPage();

    const toggle = screen.getByRole("switch", { name: "YOLO mode" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(
      "New preference scopes start with YOLO on. When off, the agent asks for approval before each tool runs.",
    )).toBeInTheDocument();
  });

  it("toggles YOLO mode and persists each scoped value", async () => {
    await renderSettingsPage();

    const toggle = screen.getByRole("switch", { name: "YOLO mode" });
    const scopedYoloKey = `${LS_YOLO_KEY}:settings:test:user`;

    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(localStorage.getItem(scopedYoloKey)).toBe("0");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(localStorage.getItem(scopedYoloKey)).toBe("1");
  });

  it("exposes a scoped width parameter and applies it to the store", async () => {
    await renderSettingsPage();

    const width = screen.getByRole("spinbutton", { name: "Floating bar width in pixels" });
    expect(width).toHaveValue(373);
    fireEvent.change(width, { target: { value: "480" } });

    expect(useKollaborBarStore.getState().barWidth).toBe(480);
    expect(localStorage.getItem("mentiko-kollabor-width:settings:test:user")).toBe("480");
    expect(width).toHaveValue(480);
  });

  it("exposes tunable backdrop controls and persists appearance changes", async () => {
    await renderSettingsPage();

    const backdrop = screen.getByRole("switch", { name: "Enable chat backdrop" });
    expect(backdrop).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Backdrop" }));

    const blur = screen.getByRole("spinbutton", { name: "Backdrop blur value" });
    fireEvent.change(blur, { target: { value: "4" } });
    expect(useKollaborBarStore.getState().appearance.backdropBlur).toBe(4);

    fireEvent.click(backdrop);
    expect(useKollaborBarStore.getState().appearance.backdropEnabled).toBe(false);
    const stored = JSON.parse(localStorage.getItem("mentiko-kollabor-appearance:settings:test:user") ?? "{}");
    expect(stored).toMatchObject({ backdropEnabled: false, backdropBlur: 4 });
  });

  it("offers three scoped appearance presets without changing width", async () => {
    await renderSettingsPage();

    expect(screen.getByRole("heading", { name: "Backdrop" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Chat surface" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Current appearance" })).toHaveTextContent("Balanced");

    const minimal = screen.getByRole("button", { name: "Use Minimal appearance preset" });
    const balanced = screen.getByRole("button", { name: "Use Balanced appearance preset" });
    const focused = screen.getByRole("button", { name: "Use Focused appearance preset" });

    expect(minimal).toBeInTheDocument();
    expect(balanced).toBeInTheDocument();
    expect(focused).toBeInTheDocument();
    expect(balanced).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(minimal);
    expect(useKollaborBarStore.getState().appearance).toMatchObject({
      backdropEnabled: false,
      surfaceShadow: 0,
    });
    expect(useKollaborBarStore.getState().barWidth).toBe(373);
    expect(minimal).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Backdrop" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Backdrop blur value" }), { target: { value: "5" } });
    expect(screen.getByRole("status", { name: "Current appearance" })).toHaveTextContent("Custom");

    fireEvent.click(focused);
    expect(useKollaborBarStore.getState().appearance).toMatchObject({
      backdropEnabled: true,
      backdropDim: 34,
      surfaceShadow: 28,
    });
    expect(focused).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem("mentiko-kollabor-appearance:settings:test:user")).toContain('"backdropDim":34');
  });

  it("starts the backdrop and chat surface accordions collapsed and exposes their controls on demand", async () => {
    await renderSettingsPage();

    const backdropAccordion = screen.getByRole("button", { name: "Backdrop" });
    const surfaceAccordion = screen.getByRole("button", { name: "Chat surface" });
    expect(backdropAccordion).toHaveAttribute("aria-expanded", "false");
    expect(surfaceAccordion).toHaveAttribute("aria-expanded", "false");
    expect(backdropAccordion).toHaveAttribute("aria-controls", "backdrop-controls-panel");
    expect(surfaceAccordion).toHaveAttribute("aria-controls", "chat-surface-controls-panel");
    expect(document.getElementById("backdrop-controls-panel")).toHaveAttribute("hidden");
    expect(document.getElementById("chat-surface-controls-panel")).toHaveAttribute("hidden");

    expect(screen.queryByRole("slider", { name: "Backdrop blur" })).not.toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "Transcript height" })).not.toBeInTheDocument();

    fireEvent.click(backdropAccordion);
    expect(backdropAccordion).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("slider", { name: "Backdrop blur" })).toBeVisible();

    fireEvent.click(surfaceAccordion);
    expect(surfaceAccordion).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("slider", { name: "Transcript height" })).toBeVisible();

    fireEvent.click(backdropAccordion);
    fireEvent.click(surfaceAccordion);
    expect(backdropAccordion).toHaveAttribute("aria-expanded", "false");
    expect(surfaceAccordion).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("slider", { name: "Backdrop blur" })).not.toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "Transcript height" })).not.toBeInTheDocument();
  });

  it("keeps the saved preference visible but disables the switch when deployment is off", async () => {
    const originalFlag = process.env.NEXT_PUBLIC_KOLLABOR_BAR;
    process.env.NEXT_PUBLIC_KOLLABOR_BAR = "0";
    await renderSettingsPage();

    expect(screen.getByText("Your deployment has disabled the Mentiko bar. Your saved preference will apply if the deployment enables it again.")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enable floating bar" })).toBeDisabled();

    if (originalFlag === undefined) delete process.env.NEXT_PUBLIC_KOLLABOR_BAR;
    else process.env.NEXT_PUBLIC_KOLLABOR_BAR = originalFlag;
  });

  it("disables scoped controls and retries when preference-scope lookup fails", async () => {
    mockScopeError = "Could not load your bar settings";
    useKollaborBarStore.setState({ storageScopeReady: false, preferenceReadResolved: false });
    await renderSettingsPage();

    expect(screen.getByText(mockScopeError)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enable floating bar" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Enable chat backdrop" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "YOLO mode" })).toBeDisabled();
    expect(screen.getByRole("spinbutton", { name: "Floating bar width in pixels" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mockRetryScope).toHaveBeenCalledTimes(1);
  });

  it("keeps scoped controls disabled and announces a preference read failure", async () => {
    useKollaborBarStore.setState({ storageScopeReady: true, preferenceReadResolved: false });
    await renderSettingsPage();

    expect(screen.getByRole("alert")).toHaveTextContent("Could not read your bar setting");
    expect(screen.getByRole("switch", { name: "YOLO mode" })).toBeDisabled();
    expect(screen.getByRole("spinbutton", { name: "Floating bar width in pixels" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mockRetryScope).toHaveBeenCalledTimes(1);
  });
});
