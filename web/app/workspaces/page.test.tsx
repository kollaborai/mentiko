import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import WorkspacesPage from "./page";

const mockFetchWithNamespace = jest.fn();
const mockRefetchWorkspaceNav = jest.fn();

jest.mock("@/lib/use-namespace-fetch", () => ({
  useNamespaceFetch: () => ({
    fetchWithNamespace: mockFetchWithNamespace,
  }),
}));

jest.mock("@/lib/workspace-context", () => ({
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

function jsonResponse(payload: unknown) {
  return {
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
});
