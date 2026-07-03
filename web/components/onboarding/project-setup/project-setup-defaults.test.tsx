import { fireEvent, render, screen } from "@testing-library/react";
import type { HTMLAttributes, ReactNode } from "react";
import { GitCloneSetup } from "./git-clone-setup";
import { ProjectSetupStep } from "../steps/project-setup-step";

const mockFetchWithNamespace = jest.fn();

jest.mock("@/lib/hooks/use-namespace-fetch", () => ({
  useNamespaceFetch: () => ({
    fetchWithNamespace: mockFetchWithNamespace,
  }),
}));

jest.mock("@/components/workspace/folder-browser", () => ({
  FolderBrowser: ({ onSelect }: { onSelect: (path: string) => void }) => (
    <button type="button" onClick={() => onSelect("/Users/test/workspaces")}>
      folder browser
    </button>
  ),
}));

jest.mock("@/components/secrets/secret-form", () => ({
  SecretForm: () => <div>secret form</div>,
}));

jest.mock("motion/react", () => {
  const React = jest.requireActual("react");
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
    motion: new Proxy({}, {
      get: (_target, tag: string) =>
        ({ children, ...props }: HTMLAttributes<HTMLElement>) =>
          React.createElement(tag, props, children),
    }),
  };
});

jest.mock("@aliimam/icons", () => {
  const Icon = () => <span />;
  return {
    ArrowLeft2Filled: Icon,
    CommandSquareFilled: Icon,
    Code1Filled: Icon,
    ExportFilled: Icon,
    FolderOpenFilled: Icon,
    GlobalFilled: Icon,
    MagicStarFilled: Icon,
    RotateFilled: Icon,
  };
});

function jsonResponse(payload: unknown) {
  return {
    json: async () => payload,
  };
}

describe("project setup workspace defaults", () => {
  beforeEach(() => {
    mockFetchWithNamespace.mockReset();
    mockFetchWithNamespace.mockImplementation(async (url: string) => {
      if (url === "/api/workspaces") {
        return jsonResponse({ workspaces: [] });
      }
      return jsonResponse({});
    });
  });

  it("updates clone destination to the workspaces folder when config arrives after render", () => {
    const onComplete = jest.fn();
    const onBack = jest.fn();

    const { rerender } = render(
      <GitCloneSetup onComplete={onComplete} onBack={onBack} />,
    );

    expect(screen.queryByDisplayValue("/Users/test/workspaces")).not.toBeInTheDocument();

    rerender(
      <GitCloneSetup
        onComplete={onComplete}
        onBack={onBack}
        workspacesDir="/Users/test/workspaces"
      />,
    );

    expect(screen.getByDisplayValue("/Users/test/workspaces")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("https://github.com/user/repo.git"), {
      target: { value: "https://github.com/kollaborai/mentiko.git" },
    });

    expect(screen.getByDisplayValue("mentiko")).toBeInTheDocument();
  });

  it("preselects the workspaces folder for the existing-folder setup path", () => {
    render(
      <ProjectSetupStep
        onComplete={jest.fn()}
        onBack={jest.fn()}
        onSkip={jest.fn()}
        workspacesDir="/Users/test/workspaces"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /use an existing folder/i }));

    expect(screen.getByText("/Users/test/workspaces")).toBeInTheDocument();
    expect(screen.getByDisplayValue("workspaces")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create workspace/i })).toBeEnabled();
  });

  it("shows a reattach-or-create panel when the selected folder already exists", async () => {
    mockFetchWithNamespace.mockImplementation(async (url: string) => {
      if (url === "/api/workspaces") {
        return jsonResponse({
          workspaces: [
            {
              id: "workspaces",
              name: "workspaces",
              path: "/Users/test/workspaces",
              addedAt: "2026-07-02T00:00:00.000Z",
            },
          ],
        });
      }
      return jsonResponse({});
    });

    render(
      <ProjectSetupStep
        onComplete={jest.fn()}
        onBack={jest.fn()}
        onSkip={jest.fn()}
        workspacesDir="/Users/test/workspaces"
      />,
    );

    const panelPromise = screen.findByText(/already registered/i);
    fireEvent.click(screen.getByRole("button", { name: /use an existing folder/i }));

    expect(await panelPromise).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reattach existing/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create another instance/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create workspace/i })).not.toBeInTheDocument();
  });
});
