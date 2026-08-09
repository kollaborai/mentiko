import { fireEvent, render, screen } from "@testing-library/react";
import { WorkspaceDetailPanel } from "./workspace-detail-panel";
import type { Workspace } from "@/lib/workspaces/workspace-storage";

const mockFetchWithNamespace = jest.fn();

jest.mock("@/lib/hooks/use-namespace-fetch", () => ({
  useNamespaceFetch: () => ({
    fetchWithNamespace: mockFetchWithNamespace,
  }),
}));

jest.mock("@/components/ui/detail-header", () => ({
  DetailHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock("@/components/ui/wave-spinner", () => ({
  WaveSpinner: () => <div role="status">Loading</div>,
}));

jest.mock("@/components/ui/terminal-icon", () => ({
  TerminalIcon: () => <span />,
}));

jest.mock("@/components/workspace/workspace-overview", () => ({
  WorkspaceOverview: () => <div>workspace overview</div>,
}));

jest.mock("@/components/workspace/workspace-terminal", () => ({
  WorkspaceTerminal: () => <div>workspace terminal</div>,
}));

jest.mock("@/components/workspace/workspace-editor", () => ({
  WorkspaceEditor: () => <div>workspace editor</div>,
}));

jest.mock("@/components/workspace/workspace-settings", () => ({
  WorkspaceSettings: () => <div>workspace settings</div>,
}));

jest.mock("@aliimam/icons", () => {
  const Icon = () => <span />;
  return {
    CategoryFilled: Icon,
    CodeFilled: Icon,
    Setting2Filled: Icon,
  };
});

function jsonResponse(payload: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => payload,
  };
}

const workspace: Workspace = {
  id: "workspace-1",
  name: "Demo workspace",
  path: "/Users/test/demo",
  addedAt: "2026-08-09T00:00:00.000Z",
};

describe("WorkspaceDetailPanel", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("distinguishes a missing workspace and lets the user return", async () => {
    const onBack = jest.fn();
    mockFetchWithNamespace.mockResolvedValue(jsonResponse({}, { ok: false, status: 404 }));

    render(<WorkspaceDetailPanel workspaceId="stale-workspace" onBack={onBack} />);

    expect(await screen.findByText("Workspace not found")).toBeInTheDocument();
    expect(screen.getByText(/may have been removed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "retry" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "back to workspaces" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("shows retry for a detail fetch failure and renders the workspace after retry", async () => {
    mockFetchWithNamespace
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { workspace } }));

    render(<WorkspaceDetailPanel workspaceId={workspace.id} />);

    expect(await screen.findByText("Could not load workspace")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "retry" }));

    expect(await screen.findByText("workspace overview")).toBeInTheDocument();
    expect(mockFetchWithNamespace).toHaveBeenCalledTimes(2);
  });
});
