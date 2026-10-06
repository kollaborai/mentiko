import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import McpAuthPage from "./page";
import { useKollaborBarStore } from "@/lib/ui/kollabor-bar-store";
import { getFloatingBarAvailability } from "@/lib/ui/floating-bar-availability";

let mockParams = new URLSearchParams("code=ABCD-EFGH");
let mockSession: { user: { id: string } } | null = { user: { id: "user-a" } };
let mockSessionPending = false;

jest.mock("next/navigation", () => ({
  useSearchParams: () => mockParams,
}));

jest.mock("@/lib/auth/auth-client", () => ({
  useSession: () => ({ data: mockSession ? { user: mockSession.user } : null, isPending: mockSessionPending }),
}));

function setBarState(enabled: boolean) {
  useKollaborBarStore.setState({
    enabled,
    storageScope: "scope-a",
    storageScopeReady: true,
    preferenceReadResolved: true,
    cleanupBlocked: false,
    connected: true,
    sessionId: "session-a",
    sessionScope: "scope-a",
  });
}

describe("MCP approval page uses authoritative grant kind and scoped runtime", () => {
  beforeEach(() => {
    mockParams = new URLSearchParams("code=ABCD-EFGH");
    mockSession = { user: { id: "user-a" } };
    mockSessionPending = false;
    setBarState(true);
    (global.fetch as jest.Mock) = jest.fn();
  });

  it("rejects UI approval while the bar is off even without a ui URL hint", async () => {
    setBarState(false);
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      if (url.includes("/device/info")) {
        return { ok: true, json: async () => ({
          user_code: "ABCD-EFGH",
          client_label: "UI agent",
          scopes: [],
          grant_kind: "ui",
          status: "pending",
          expired: false,
        }) };
      }
      throw new Error(`unexpected approval call: ${url}`);
    });

    render(<McpAuthPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

    expect(await screen.findByText("The Mentiko bar is off - enable it in Settings -> Mentiko Agent.")).toBeInTheDocument();
    expect((global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).includes("/device/approve"))).toHaveLength(0);
  });

  it("keeps ordinary data authorization working when the UI hint is absent or changed", async () => {
    setBarState(false);
    mockParams = new URLSearchParams("code=ABCD-EFGH&ui=changed");
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      if (url.includes("/device/info")) {
        return { ok: true, json: async () => ({
          user_code: "ABCD-EFGH",
          client_label: "Data client",
          scopes: ["ops:read"],
          grant_kind: "data",
          status: "pending",
          expired: false,
        }) };
      }
      if (url.includes("/device/approve")) return { ok: true, json: async () => ({ ok: true, kind: "data" }) };
      throw new Error(`unexpected route: ${url}`);
    });

    render(<McpAuthPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.getByText("Connected")).toBeInTheDocument());

    const approvalCall = (global.fetch as jest.Mock).mock.calls.find(([url]) => String(url).includes("/device/approve"));
    expect(JSON.parse(String(approvalCall?.[1]?.body))).toEqual({
      user_code: "ABCD-EFGH",
      decision: "approve",
      expected_grant_kind: "data",
    });
  });

  it("binds UI approval to the persisted grant kind and connected session", async () => {
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      if (url.includes("/device/info")) {
        return { ok: true, json: async () => ({
          user_code: "ABCD-EFGH",
          client_label: "UI agent",
          scopes: [],
          grant_kind: "ui",
          status: "pending",
          expired: false,
        }) };
      }
      if (url.includes("/device/approve")) return { ok: true, json: async () => ({ ok: true, kind: "ui" }) };
      throw new Error(`unexpected route: ${url}`);
    });

    render(<McpAuthPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.getByText("Connected")).toBeInTheDocument());

    const approvalCall = (global.fetch as jest.Mock).mock.calls.find(([url]) => String(url).includes("/device/approve"));
    expect(JSON.parse(String(approvalCall?.[1]?.body))).toEqual({
      user_code: "ABCD-EFGH",
      decision: "approve",
      expected_grant_kind: "ui",
      target_session_id: "session-a",
    });
  });

  it("suspends a pending UI approval locally on disable and ignores its late success without revoking", async () => {
    let resolveApproval!: (value: unknown) => void;
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes("/device/info")) {
        return Promise.resolve({ ok: true, json: async () => ({
          user_code: "ABCD-EFGH",
          client_label: "UI agent",
          scopes: [],
          grant_kind: "ui",
          status: "pending",
          expired: false,
        }) });
      }
      if (url.includes("/device/approve")) {
        return new Promise((resolve) => { resolveApproval = resolve; });
      }
      throw new Error(`unexpected route: ${url}`);
    });

    render(<McpAuthPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.some(
      ([url]) => String(url).includes("/device/approve"),
    )).toBe(true));
    const approvalCall = (global.fetch as jest.Mock).mock.calls.find(
      ([url]) => String(url).includes("/device/approve"),
    );
    const approvalSignal = approvalCall?.[1]?.signal as AbortSignal;

    act(() => setBarState(false));
    expect(approvalSignal.aborted).toBe(true);
    expect(getFloatingBarAvailability()).toMatchObject({
      effectiveEnabled: false,
      canApproveUiControl: false,
    });

    await act(async () => {
      resolveApproval({ ok: true, json: async () => ({ ok: true }) });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
    expect(useKollaborBarStore.getState().enabled).toBe(false);
    expect((global.fetch as jest.Mock).mock.calls.map(([url]) => String(url)).every(
      (url) => !url.includes("/revoke"),
    )).toBe(true);
  });

  it("ignores a late UI approval after the connected scope changes", async () => {
    let resolveApproval!: (value: unknown) => void;
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes("/device/info")) {
        return Promise.resolve({ ok: true, json: async () => ({
          user_code: "ABCD-EFGH",
          client_label: "UI agent",
          scopes: [],
          grant_kind: "ui",
          status: "pending",
          expired: false,
        }) });
      }
      if (url.includes("/device/approve")) {
        return new Promise((resolve) => { resolveApproval = resolve; });
      }
      throw new Error(`unexpected route: ${url}`);
    });

    render(<McpAuthPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.some(
      ([url]) => String(url).includes("/device/approve"),
    )).toBe(true));

    act(() => useKollaborBarStore.setState({
      storageScope: "scope-b",
      sessionId: "session-b",
      sessionScope: "scope-b",
      generation: 2,
    }));
    const approvalCall = (global.fetch as jest.Mock).mock.calls.find(
      ([url]) => String(url).includes("/device/approve"),
    );
    expect((approvalCall?.[1]?.signal as AbortSignal).aborted).toBe(true);

    await act(async () => {
      resolveApproval({ ok: true, json: async () => ({ ok: true }) });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
    expect(useKollaborBarStore.getState()).toMatchObject({
      enabled: true,
      storageScope: "scope-b",
      sessionId: "session-b",
      sessionScope: "scope-b",
    });
  });

  it("ignores a late approval after logout instead of showing a connected result", async () => {
    let resolveApproval!: (value: unknown) => void;
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes("/device/info")) {
        return Promise.resolve({ ok: true, json: async () => ({
          user_code: "ABCD-EFGH",
          client_label: "UI agent",
          scopes: [],
          grant_kind: "ui",
          status: "pending",
          expired: false,
        }) });
      }
      if (url.includes("/device/approve")) {
        return new Promise((resolve) => { resolveApproval = resolve; });
      }
      throw new Error(`unexpected route: ${url}`);
    });

    const view = render(<McpAuthPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.some(
      ([url]) => String(url).includes("/device/approve"),
    )).toBe(true));

    act(() => {
      mockSession = null;
      setBarState(false);
      view.rerender(<McpAuthPage />);
    });
    const approvalCall = (global.fetch as jest.Mock).mock.calls.find(
      ([url]) => String(url).includes("/device/approve"),
    );
    expect((approvalCall?.[1]?.signal as AbortSignal).aborted).toBe(true);

    await act(async () => {
      resolveApproval({ ok: true, json: async () => ({ ok: true }) });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
    expect(screen.getByText("Sign in to continue")).toBeInTheDocument();
  });
});
