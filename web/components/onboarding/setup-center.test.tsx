import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { SetupCenter } from "./setup-center";

const push = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

jest.mock("@/lib/ui-context/namespace-context", () => ({
  useNamespace: () => ({ namespaceId: "default" }),
}));

const mockFetchWithNamespace = jest.fn();
jest.mock("@/lib/hooks/use-namespace-fetch", () => ({
  useNamespaceFetch: () => ({ fetchWithNamespace: mockFetchWithNamespace }),
}));

const BASE_STATE = {
  provider: { status: "not_started", selectedCli: null, selectedProfileId: null, defaultVerified: false },
  workspace: { status: "not_started", id: null },
  readiness: { status: "not_started" },
  sampleRun: { status: "not_started" },
  setupVersion: 11,
};

function mockOnboardingState(overrides: Record<string, unknown>) {
  (global.fetch as jest.Mock).mockImplementation((url: unknown) => {
    const href = String(url);
    if (href.includes("/api/onboarding/state")) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { ...BASE_STATE, ...overrides } }) });
    }
    if (href.includes("/api/workspaces")) {
      return Promise.resolve({ ok: true, json: async () => ({ data: { workspaces: [] } }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

function mockNamespaceFetch({ detected = [] as unknown[], profiles = [] as unknown[] } = {}) {
  mockFetchWithNamespace.mockImplementation((url: unknown) => {
    const href = String(url);
    if (href.includes("/api/system/detect-cli")) return Promise.resolve({ ok: true, json: async () => ({ tools: detected }) });
    if (href.includes("/api/agent-profiles")) return Promise.resolve({ ok: true, json: async () => ({ profiles }) });
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

describe("SetupCenter", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    mockFetchWithNamespace.mockReset();
    mockNamespaceFetch();
    push.mockClear();
  });

  it("shows Step 0 welcome before the milestone rail, and does not lose progress on 'I'll explore first'", async () => {
    mockOnboardingState({ nextAction: "provider" });
    render(<SetupCenter />);

    expect(screen.queryByRole("navigation", { name: "Setup progress" })).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Get Started/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /I.ll explore first/ }));
    // Standalone (no onRequestClose prop): explore-first routes home, it never clears state itself.
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  });

  it("maps the server's nextAction vocabulary onto the panel's own step keys (defect #6)", async () => {
    // "project" and "sample" used to silently fail to match the panel's
    // "workspace"/"sampleRun" step keys, so Continue Setup always landed on
    // the provider step no matter what the server said was next.
    mockOnboardingState({ nextAction: "project", provider: { status: "ready", selectedCli: "codex", selectedProfileId: "codex-terra", defaultVerified: true } });
    render(<SetupCenter />);

    fireEvent.click(await screen.findByRole("button", { name: /Continue Setup/ }));

    const rail = await screen.findByRole("navigation", { name: "Setup progress" });
    await waitFor(() =>
      expect(within(rail).getByRole("button", { name: /Connect Your Project/ })).toHaveAttribute("aria-current", "step"),
    );
    // Title Case rail labels (defect #4) — not the old unexplained lowercase.
    expect(within(rail).getByText("Project")).toBeInTheDocument();
    expect(within(rail).queryByText("project")).not.toBeInTheDocument();
  });

  it("renders exactly one step at a time when navigating the rail (defect #1)", async () => {
    mockOnboardingState({ nextAction: "provider" });
    render(<SetupCenter />);

    fireEvent.click(await screen.findByRole("button", { name: /Get Started/ }));
    await screen.findByRole("heading", { name: "Choose Your AI Tool" });

    const rail = screen.getByRole("navigation", { name: "Setup progress" });
    fireEvent.click(within(rail).getByRole("button", { name: /Check That Everything Works/ }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Check That Everything Works" })).toBeInTheDocument());
    // The exiting step must be fully gone, not layered underneath (AnimatePresence mode="wait").
    expect(screen.queryByRole("heading", { name: "Choose Your AI Tool" })).not.toBeInTheDocument();
  });

  it("renders provider cards with a logo and a real (non-permanent) detection status (defects #2 and #3)", async () => {
    mockOnboardingState({ nextAction: "provider" });
    mockNamespaceFetch({
      detected: [
        { name: "codex", found: true, version: "1.2.3", authenticated: true },
        { name: "claude", found: false },
      ],
    });
    render(<SetupCenter />);

    fireEvent.click(await screen.findByRole("button", { name: /Get Started/ }));
    await screen.findByRole("heading", { name: "Choose Your AI Tool" });

    // Detection resolves to real, distinct statuses instead of a permanent "Checking".
    // (detected · auth status render as one line, so match the combined text.)
    await waitFor(() => expect(screen.getByText("Found on this machine · Signed in")).toBeInTheDocument());
    expect(screen.getAllByText(/^Not found/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Checking/)).not.toBeInTheDocument();

    // Every provider card renders a vector mark, not just a name.
    const cards = screen.getAllByRole("button").filter((el) => el.textContent?.includes("Codex") || el.textContent?.includes("Claude"));
    expect(cards.length).toBeGreaterThan(0);
    cards.forEach((card) => expect(card.querySelector("svg")).not.toBeNull());
  });

  it("keeps action buttons visually alive (never disabled) while busy, per defect #7", async () => {
    (global.fetch as jest.Mock).mockImplementation((url: unknown) => {
      const href = String(url);
      if (href.includes("/api/onboarding/state")) return Promise.resolve({ ok: true, json: async () => ({ data: { ...BASE_STATE, nextAction: "readiness", provider: { status: "ready", selectedCli: "codex", selectedProfileId: "codex-terra", defaultVerified: true }, workspace: { status: "ready", id: "ws-1" } } }) });
      if (href.includes("/api/workspaces")) return Promise.resolve({ ok: true, json: async () => ({ data: { workspaces: [{ id: "ws-1", name: "My Project" }] } }) });
      if (href.includes("/api/onboarding/provider/readiness")) return new Promise(() => {}); // never resolves during the assertion window
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<SetupCenter />);
    fireEvent.click(await screen.findByRole("button", { name: /Continue Setup/ }));
    const checkButton = await screen.findByRole("button", { name: /Check that Codex works/ });
    fireEvent.click(checkButton);

    await waitFor(() => expect(checkButton).toHaveAttribute("aria-busy", "true"));
    expect(checkButton).not.toBeDisabled();
  });

  it("shows a repairable error when progress cannot load", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false });
    render(<SetupCenter />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Unable to load setup progress"));
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
