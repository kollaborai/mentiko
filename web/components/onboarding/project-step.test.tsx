import { fireEvent, render, screen } from "@testing-library/react";
import { ProjectStep } from "./project-step";

const mockFetchWithNamespace = jest.fn();

jest.mock("@/lib/hooks/use-namespace-fetch", () => ({
  useNamespaceFetch: () => ({ fetchWithNamespace: mockFetchWithNamespace }),
}));

jest.mock("@aliimam/icons", () => {
  const Icon = () => <span />;
  return {
    ArrowLeft2Filled: Icon,
    BoxFilled: Icon,
    Code1Filled: Icon,
    CommandSquareFilled: Icon,
    ExportFilled: Icon,
    FolderOpenFilled: Icon,
    GlobalFilled: Icon,
    MagicStarFilled: Icon,
    RotateFilled: Icon,
    SearchNormal1Filled: Icon,
  };
});

function stubProjectSetup(name: string, payload: { workspaceId: string; workspaceName: string; workspacePath: string; method: string }) {
  const Stub = ({ onComplete, onBack }: { onComplete: (data: typeof payload) => void; onBack: () => void }) => (
    <div>
      <p>{name}-view</p>
      <button type="button" onClick={() => onComplete(payload)}>{`complete-${name}`}</button>
      <button type="button" onClick={onBack}>{`back-${name}`}</button>
    </div>
  );
  Stub.displayName = `Stub(${name})`;
  return Stub;
}

jest.mock("@/components/onboarding/project-setup/git-clone-setup", () => ({
  GitCloneSetup: stubProjectSetup("git", { workspaceId: "git-ws", workspaceName: "git", workspacePath: "/tmp/git", method: "git" }),
}));
jest.mock("@/components/onboarding/project-setup/local-folder-setup", () => ({
  LocalFolderSetup: stubProjectSetup("local", { workspaceId: "local-ws", workspaceName: "local", workspacePath: "/tmp/local", method: "local" }),
}));
jest.mock("@/components/onboarding/project-setup/new-project-setup", () => ({
  NewProjectSetup: stubProjectSetup("new", { workspaceId: "new-ws", workspaceName: "new", workspacePath: "/tmp/new", method: "new" }),
}));
jest.mock("@/components/onboarding/project-setup/upload-setup", () => ({
  UploadSetup: stubProjectSetup("upload", { workspaceId: "upload-ws", workspaceName: "upload", workspacePath: "/tmp/upload", method: "upload" }),
}));
jest.mock("@/components/onboarding/project-setup/ssh-setup", () => ({
  SshSetup: stubProjectSetup("ssh", { workspaceId: "ssh-ws", workspaceName: "ssh", workspacePath: "/tmp/ssh", method: "ssh" }),
}));
jest.mock("@/components/onboarding/project-setup/docker-setup", () => ({
  DockerSetup: stubProjectSetup("docker", { workspaceId: "docker-ws", workspaceName: "docker", workspacePath: "/tmp/docker", method: "docker" }),
}));

function jsonResponse(payload: unknown, ok = true) {
  return { ok, json: async () => payload };
}

describe("ProjectStep", () => {
  beforeEach(() => {
    mockFetchWithNamespace.mockReset();
    mockFetchWithNamespace.mockImplementation(async (url: string) => {
      if (url === "/api/integrations/github/connection") return jsonResponse({ status: "not_connected" });
      return jsonResponse({});
    });
  });

  it("renders the source chooser with existing projects and the primary cards", async () => {
    render(
      <ProjectStep
        workspaces={[{ id: "ws1", name: "My Workspace", path: "/tmp/ws1" }]}
        selectedWorkspaceId={null}
        onSelect={jest.fn()}
      />,
    );

    expect(screen.getByText("Connect a project")).toBeInTheDocument();
    expect(screen.getByText(/Your agents need a project folder/)).toBeInTheDocument();
    expect(screen.getByText("My Workspace")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /use this project/i })).toBeInTheDocument();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("Local folder")).toBeInTheDocument();
    expect(screen.getByText("New project")).toBeInTheDocument();
    expect(screen.queryByText("Upload ZIP")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("More ways to connect a project"));
    expect(await screen.findByText("Upload ZIP")).toBeInTheDocument();
    expect(screen.getByText("Other Git URL")).toBeInTheDocument();
    expect(screen.getByText("SSH")).toBeInTheDocument();
    expect(screen.getByText("Docker")).toBeInTheDocument();
  });

  it("calls onSelect when an existing project's Use This Project action is clicked", () => {
    const onSelect = jest.fn();
    render(
      <ProjectStep
        workspaces={[{ id: "ws1", name: "My Workspace" }]}
        selectedWorkspaceId={null}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /use this project/i }));
    expect(onSelect).toHaveBeenCalledWith("ws1");
  });

  it("highlights the currently selected workspace instead of offering to select it again", () => {
    render(
      <ProjectStep
        workspaces={[{ id: "ws1", name: "My Workspace" }]}
        selectedWorkspaceId="ws1"
        onSelect={jest.fn()}
      />,
    );

    expect(screen.getByText("Selected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /use this project/i })).not.toBeInTheDocument();
  });

  it("opens the Local folder card and forwards its completion to onSelect", () => {
    const onSelect = jest.fn();
    render(<ProjectStep workspaces={[]} onSelect={onSelect} />);

    fireEvent.click(screen.getByText("Local folder"));
    expect(screen.getByText("local-view")).toBeInTheDocument();

    fireEvent.click(screen.getByText("complete-local"));
    expect(onSelect).toHaveBeenCalledWith("local-ws");
  });

  it("opens More ways and forwards the Docker card's completion to onSelect", () => {
    const onSelect = jest.fn();
    render(<ProjectStep workspaces={[]} onSelect={onSelect} />);

    fireEvent.click(screen.getByText("More ways to connect a project"));
    fireEvent.click(screen.getByText("Docker"));
    fireEvent.click(screen.getByText("complete-docker"));
    expect(onSelect).toHaveBeenCalledWith("docker-ws");
  });
});
