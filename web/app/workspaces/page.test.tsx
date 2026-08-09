import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import WorkspacesPage from "./page";

const mockFetchWithNamespace = jest.fn();
const mockRefetchWorkspaceNav = jest.fn();

jest.mock("@/lib/hooks/use-namespace-fetch", () => ({
  useNamespaceFetch: () => ({
    fetchWithNamespace: mockFetchWithNamespace,
  }),
}));

jest.mock("@/lib/ui-context/workspace-context", () => ({
  useWorkspace: () => ({
    refetch: mockRefetchWorkspaceNav,
  }),
}));

jest.mock("@/components/ui/page-banner", () => ({
  PageBanner: ({ title, subtitle }: { title: string; subtitle: string }) => (
    <header>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </header>
  ),
}));

jest.mock("@/components/ui/wave-spinner", () => ({
  WaveSpinner: () => <div role="status">Loading</div>,
}));

jest.mock("@/components/workspace/workspace-detail-panel", () => ({
  WorkspaceDetailPanel: () => <div>workspace detail</div>,
}));

jest.mock("@/components/onboarding/steps/project-setup-step", () => ({
  ProjectSetupStep: () => <div>Set up your project</div>,
}));

jest.mock("@aliimam/icons", () => {
  const Icon = () => <span />;
  return {
    AddFilled: Icon,
    TrashFilled: Icon,
    RefreshFilled: Icon,
    DriverFilled: Icon,
    GlobalFilled: Icon,
    BoxFilled: Icon,
    MonitorFilled: Icon,
    RouteSquareFilled: Icon,
    LinkFilled: Icon,
    TaskSquareFilled: Icon,
    SearchNormalFilled: Icon,
    ArrowDown1Filled: Icon,
    ArrowRight1Filled: Icon,
  };
});

function jsonResponse(payload: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => payload,
  };
}

describe("WorkspacesPage", () => {
  beforeEach(() => {
    mockFetchWithNamespace.mockImplementation(async (url: string) => {
      if (url === "/api/workspaces") {
        return jsonResponse({ workspaces: [] });
      }
      if (url === "/api/config") {
        return jsonResponse({ workspacesDir: "/Users/test/dev" });
      }
      return jsonResponse({});
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  it("shows the setup pane when a new workspace is opened from the empty state", async () => {
    const { container } = render(<WorkspacesPage />);
    await screen.findByText("No workspaces yet");

    fireEvent.click(screen.getByRole("button", { name: "New Workspace" }));

    await screen.findByText("Set up your project");
    await waitFor(() => {
      expect(
        container.querySelector("div.hidden.md\\:flex.flex-1.flex-col.overflow-hidden"),
      ).toBeNull();
    });
  });

  it("settles a successful response and shows an actionable no-selection state", async () => {
    mockFetchWithNamespace.mockImplementation(async (url: string) => {
      if (url === "/api/workspaces") {
        return jsonResponse({ success: true, data: { workspaces: [] } });
      }
      if (url === "/api/config") {
        return jsonResponse({ workspacesDir: "/Users/test/dev" });
      }
      return jsonResponse({});
    });

    render(<WorkspacesPage />);

    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Set up your first workspace")).toBeInTheDocument();
    expect(
      screen.getByText("Create a workspace to give your agents an execution environment."),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Create workspace" }).length).toBeGreaterThan(0);
  });

  it("recovers when the selected workspace disappears during refresh", async () => {
    const workspace = {
      id: "workspace-1",
      name: "Demo workspace",
      path: "/Users/test/demo",
      execution: { type: "local" },
    };
    let workspaceList = [workspace];

    mockFetchWithNamespace.mockImplementation(async (url: string) => {
      if (url === "/api/workspaces") {
        return jsonResponse({ workspaces: workspaceList });
      }
      if (url === "/api/config") {
        return jsonResponse({ workspacesDir: "/Users/test/dev" });
      }
      return jsonResponse({});
    });

    render(<WorkspacesPage />);
    await screen.findByText("workspace detail");

    workspaceList = [];
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await screen.findByText("Workspace unavailable");
    expect(screen.getByText(/no longer available/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create workspace" })).toBeInTheDocument();
    expect(screen.queryByText("workspace detail")).not.toBeInTheDocument();
  });

  it("shows a retryable state when the workspace list request fails", async () => {
    mockFetchWithNamespace.mockImplementation(async (url: string) => {
      if (url === "/api/workspaces") {
        return jsonResponse({ error: "server error" }, { ok: false, status: 500 });
      }
      if (url === "/api/config") {
        return jsonResponse({ workspacesDir: "/Users/test/dev" });
      }
      return jsonResponse({});
    });

    render(<WorkspacesPage />);

    expect(await screen.findAllByText("Workspaces unavailable")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Retry" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Create workspace" }).length).toBeGreaterThan(0);
  });
});
