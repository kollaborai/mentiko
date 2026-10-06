import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UIControlGrant } from "../ui-control-grant";
import { showToast } from "@/components/app-shell/notifications-panel";
import { useKollaborBarStore } from "@/lib/ui/kollabor-bar-store";
import { getFloatingBarAvailability } from "@/lib/ui/floating-bar-availability";

jest.mock("@/components/app-shell/notifications-panel", () => ({
  showToast: jest.fn(),
}));

jest.mock("@/lib/ai-engine/kollabor-bar-flag", () => ({
  isKollaborBarEnabled: () => process.env.NEXT_PUBLIC_KOLLABOR_BAR !== "0",
  getKollaborBarWidth: () => 373,
  KOLLABOR_BAR_MIN_WIDTH_PX: 240,
  KOLLABOR_BAR_MAX_WIDTH_PX: 720,
}));

const toastMock = showToast as jest.MockedFunction<typeof showToast>;

const grantText = JSON.stringify({ type: "mentiko-ui-control", code: "ABCD-EFGH", label: "Test agent" });

function setRuntime(overrides: Partial<ReturnType<typeof useKollaborBarStore.getState>> = {}) {
  useKollaborBarStore.setState({
    enabled: true,
    storageScope: "scope-a",
    storageScopeReady: true,
    preferenceReadResolved: true,
    cleanupBlocked: false,
    connected: true,
    sessionId: "session-a",
    sessionScope: "scope-a",
    generation: 1,
    ...overrides,
  });
}

describe("UI-control grant availability", () => {
  const originalFlag = process.env.NEXT_PUBLIC_KOLLABOR_BAR;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_KOLLABOR_BAR;
    localStorage.clear();
    toastMock.mockReset();
    (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, kind: "ui" }) });
    setRuntime();
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.NEXT_PUBLIC_KOLLABOR_BAR;
    else process.env.NEXT_PUBLIC_KOLLABOR_BAR = originalFlag;
  });

  it("rejects paste and Cmd/Ctrl+M while the user preference is off", () => {
    setRuntime({ enabled: false, sessionId: "stale-session" });
    render(<UIControlGrant />);

    fireEvent.paste(document, { clipboardData: { getData: () => grantText } });
    fireEvent.keyDown(window, { key: "m", ctrlKey: true });

    expect(screen.queryByRole("dialog", { name: "Grant UI control" })).not.toBeInTheDocument();
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "The Mentiko bar is off - enable it in Settings -> Mentiko Agent.",
    }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a stale session from another scope and targets only the connected scope", async () => {
    setRuntime({ sessionId: "session-from-a", sessionScope: "scope-a", storageScope: "scope-b" });
    const first = render(<UIControlGrant />);
    fireEvent.paste(document, { clipboardData: { getData: () => grantText } });
    expect(screen.queryByRole("dialog", { name: "Grant UI control" })).not.toBeInTheDocument();

    first.unmount();
    setRuntime({ storageScope: "scope-b", sessionId: "session-b", sessionScope: "scope-b" });
    expect({ state: useKollaborBarStore.getState(), availability: getFloatingBarAvailability() }).toMatchObject({
      availability: { canApproveUiControl: true },
    });
    render(<UIControlGrant />);
    fireEvent.keyDown(window, { key: "m", ctrlKey: true });
    await screen.findByRole("dialog", { name: "Grant UI control" });
    fireEvent.change(screen.getByPlaceholderText("XXXX-XXXX"), { target: { value: "ABCD-EFGH" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      "/api/mentiko-mcp/auth/device/approve",
      expect.objectContaining({
        body: expect.stringContaining('"expected_grant_kind":"ui"'),
      }),
    ));
    expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)).toMatchObject({
      target_session_id: "session-b",
      expected_grant_kind: "ui",
    });
  });

  it("does not report a data grant as successful UI control", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ ok: true, kind: "data" }) });
    render(<UIControlGrant />);
    fireEvent.paste(document, { clipboardData: { getData: () => grantText } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      type: "error",
      title: "Couldn't grant control",
    })));
    expect(toastMock).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "success",
      title: "Test agent can now control this window",
    }));
    expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)).toMatchObject({
      expected_grant_kind: "ui",
      target_session_id: "session-a",
    });
  });

  it("suspends an issued grant locally when disabled without revoking it", async () => {
    render(<UIControlGrant />);
    fireEvent.paste(document, { clipboardData: { getData: () => grantText } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      type: "success",
      title: "Test agent can now control this window",
    })));
    expect(global.fetch).toHaveBeenCalledTimes(1);

    act(() => setRuntime({ enabled: false, generation: 2 }));

    expect(getFloatingBarAvailability()).toMatchObject({
      effectiveEnabled: false,
      canApproveUiControl: false,
    });
    expect((global.fetch as jest.Mock).mock.calls.some(([url]) => String(url).includes("/revoke"))).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("closes a staged approval when the active scope changes to another approvable session", () => {
    render(<UIControlGrant />);
    fireEvent.paste(document, { clipboardData: { getData: () => grantText } });
    expect(screen.getByRole("dialog", { name: "Grant UI control" })).toBeInTheDocument();

    act(() => {
      setRuntime({ storageScope: "scope-b", sessionId: "session-b", sessionScope: "scope-b", generation: 2 });
    });

    expect(screen.queryByRole("dialog", { name: "Grant UI control" })).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("closes a staged approval when logout clears the bound session", () => {
    render(<UIControlGrant />);
    fireEvent.paste(document, { clipboardData: { getData: () => grantText } });
    expect(screen.getByRole("dialog", { name: "Grant UI control" })).toBeInTheDocument();

    act(() => {
      setRuntime({
        enabled: false,
        connected: false,
        storageScope: "anonymous:tab-a",
        sessionId: null,
        sessionScope: null,
        generation: 2,
      });
    });

    expect(screen.queryByRole("dialog", { name: "Grant UI control" })).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not show a stale approval response after switching to another active scope", async () => {
    let resolveApproval!: (value: unknown) => void;
    (global.fetch as jest.Mock).mockReturnValue(new Promise((resolve) => { resolveApproval = resolve; }));
    render(<UIControlGrant />);
    fireEvent.paste(document, { clipboardData: { getData: () => grantText } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    act(() => {
      setRuntime({ storageScope: "scope-b", sessionId: "session-b", sessionScope: "scope-b", generation: 2 });
    });
    await act(async () => {
      resolveApproval({ ok: true, json: async () => ({ ok: true }) });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(toastMock).not.toHaveBeenCalled();
  });

  it("does not let an old approval finally-unlock a newer submission", async () => {
    const resolveApprovals: Array<(value: unknown) => void> = [];
    (global.fetch as jest.Mock).mockImplementation(() => new Promise((resolve) => { resolveApprovals.push(resolve); }));
    render(<UIControlGrant />);
    fireEvent.paste(document, { clipboardData: { getData: () => grantText } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    act(() => setRuntime({ enabled: false, generation: 2 }));
    act(() => setRuntime({ enabled: true, generation: 3 }));
    fireEvent.paste(document, { clipboardData: { getData: () => grantText } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Granting…" })).toBeDisabled();

    await act(async () => {
      resolveApprovals[0]({ ok: true, json: async () => ({ ok: true }) });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "Granting…" })).toBeDisabled();
  });

  it("ignores a late approval response after disable invalidates its generation", async () => {
    let resolveApproval!: (value: unknown) => void;
    (global.fetch as jest.Mock).mockReturnValue(new Promise((resolve) => { resolveApproval = resolve; }));
    render(<UIControlGrant />);
    fireEvent.paste(document, { clipboardData: { getData: () => grantText } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    act(() => {
      setRuntime({ enabled: false, generation: 2 });
    });
    expect((global.fetch as jest.Mock).mock.calls[0][1].signal.aborted).toBe(true);
    resolveApproval({ ok: true, json: async () => ({ ok: true }) });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Grant UI control" })).not.toBeInTheDocument());
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("ignores a late approval response after logout clears the session", async () => {
    let resolveApproval!: (value: unknown) => void;
    (global.fetch as jest.Mock).mockReturnValue(new Promise((resolve) => { resolveApproval = resolve; }));
    render(<UIControlGrant />);
    fireEvent.paste(document, { clipboardData: { getData: () => grantText } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    act(() => {
      setRuntime({
        enabled: false,
        connected: false,
        storageScope: "anonymous:tab-a",
        sessionId: null,
        sessionScope: null,
        generation: 2,
      });
    });
    expect((global.fetch as jest.Mock).mock.calls[0][1].signal.aborted).toBe(true);
    resolveApproval({ ok: true, json: async () => ({ ok: true }) });

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Grant UI control" })).not.toBeInTheDocument());
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("does not mount the approval surface when deployment disables the feature", () => {
    process.env.NEXT_PUBLIC_KOLLABOR_BAR = "0";
    render(<UIControlGrant />);
    fireEvent.keyDown(window, { key: "m", metaKey: true });
    expect(screen.queryByRole("dialog", { name: "Grant UI control" })).not.toBeInTheDocument();
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "The Mentiko bar is off - enable it in Settings -> Mentiko Agent.",
    }));
  });
});
