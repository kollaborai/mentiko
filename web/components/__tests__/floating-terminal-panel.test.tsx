import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FloatingTerminalPanel } from "../floating-terminal-panel";

type WorkspaceState = {
  workspaceId: string;
  workspacePath: string;
  workspaceReady: boolean;
  refetch: jest.Mock<Promise<Array<{ id: string; path: string }>>, []>;
};

let workspaceState: WorkspaceState;
const fetchWsUrl = jest.fn();
let terminalPrefs = { autoCdFloatingTerminalToWorkspace: false };

jest.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => {
      const htmlProps: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(props)) {
        if (!["initial", "animate", "exit", "transition"].includes(key)) {
          htmlProps[key] = value;
        }
      }
      return <div {...htmlProps}>{children}</div>;
    },
  },
}));

jest.mock("@aliimam/icons", () => {
  const icon = (name: string) =>
    function MockIcon({ className }: { className?: string }) {
      return <svg data-testid={`icon-${name}`} className={className} />;
    };
  return {
    CommandSquareFilled: icon("command-square"),
    Code1Filled: icon("code1-filled"),
    CloseCircleFilled: icon("close-circle"),
    AddFilled: icon("add"),
    RefreshFilled: icon("refresh"),
    SearchNormalFilled: icon("search"),
    MaximizeFilled: icon("maximize"),
    Minimize: icon("minimize"),
    CopyFilled: icon("copy"),
    TickCircleFilled: icon("tick"),
    KeyboardFilled: icon("keyboard"),
    More2Filled: icon("more"),
    AttachCircleFilled: icon("attach"),
    ColorSwatchFilled: icon("color"),
    DangerFilled: icon("danger"),
  };
});

jest.mock("@/components/terminal/terminal-viewer", () => ({
  TerminalViewer: ({ session }: { session: string }) => (
    <div data-testid="terminal-viewer">{session}</div>
  ),
}));

jest.mock("@/components/terminal/use-terminal-ws-connection", () => ({
  useTerminalWsConnection: () => ({
    refreshToken: jest.fn(),
    refreshUrl: fetchWsUrl,
    status: "running",
    wsUrl: "ws://localhost/terminal",
  }),
}));

jest.mock("@/lib/ui-context/workspace-context", () => ({
  useWorkspace: () => workspaceState,
}));

jest.mock("@/lib/ui/pill-nav-preferences", () => ({
  usePillNavPreferences: () => ({ prefs: {} }),
  getPillNavShineGradient: () => "rgba(255,255,255,0.2)",
}));

jest.mock("@/lib/ui/terminal-preferences", () => ({
  useTerminalPreferences: () => ({ prefs: terminalPrefs }),
}));

jest.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
  }) => <button onClick={onSelect}>{children}</button>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuSubContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSubTrigger: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function mockSessions(names: string[]) {
  return {
    ok: true,
    json: async () => ({
      data: {
        sessions: names.map((name) => ({ name, alive: true, pid: 100 })),
      },
    }),
  };
}

function mockSessionRecords(sessions: Array<{ name: string; alive?: boolean; pid?: number }>) {
  return {
    ok: true,
    json: async () => ({
      data: {
        sessions: sessions.map((session) => ({
          alive: true,
          pid: 100,
          ...session,
        })),
      },
    }),
  };
}

function mockSpawn(name = "term-new") {
  return {
    ok: true,
    json: async () => ({ name, status: "created" }),
  };
}

function mockSend() {
  return {
    ok: true,
    json: async () => ({ data: { ok: true } }),
  };
}

function fetchCalls(path: string) {
  return (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).includes(path));
}

async function openPanel() {
  render(<FloatingTerminalPanel />);
  await act(async () => {
    window.dispatchEvent(new Event("toggle-terminal-panel"));
  });
}

describe("FloatingTerminalPanel workspace cwd", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: jest.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        addListener: jest.fn(),
        removeListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    });
    fetchWsUrl.mockResolvedValue(undefined);
    terminalPrefs = { autoCdFloatingTerminalToWorkspace: false };
    workspaceState = {
      workspaceId: "ws-1",
      workspacePath: "/app/namespaces/marco/workspace/mentiko",
      workspaceReady: true,
      refetch: jest.fn(async () => []),
    };
    global.fetch = jest.fn(async (url, init) => {
      if (String(url) === "/api/pty/sessions") return mockSessions(["term-a", "term-b"]);
      if (String(url) === "/api/terminal/spawn") return mockSpawn(JSON.parse(String(init?.body)).name);
      if (String(url).includes("/send")) return mockSend();
      return { ok: true, json: async () => ({ data: {} }) };
    }) as jest.Mock;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("spawns a new session in the active workspace path", async () => {
    await openPanel();

    fireEvent.click(screen.getByTitle("New terminal"));

    await waitFor(() => expect(fetchCalls("/api/terminal/spawn")).toHaveLength(1));
    const spawnBody = JSON.parse(String(fetchCalls("/api/terminal/spawn")[0][1]?.body));
    expect(spawnBody).toMatchObject({
      cwd: "/app/namespaces/marco/workspace/mentiko",
      workspaceId: "ws-1",
    });
  });

  it("does not cd when attaching to an existing session by default", async () => {
    await openPanel();
    await screen.findByText("term-b");

    fireEvent.click(screen.getByText("term-b"));

    await waitFor(() => expect(screen.getByTestId("terminal-viewer")).toHaveTextContent("term-b"));
    expect(fetchCalls("/send")).toHaveLength(0);
  });

  it("cds to the active workspace when attaching and auto-cd is enabled", async () => {
    terminalPrefs = { autoCdFloatingTerminalToWorkspace: true };
    await openPanel();
    await screen.findByText("term-b");

    fireEvent.click(screen.getByText("term-b"));

    await waitFor(() => {
      expect(fetchCalls("/api/pty/sessions/term-b/send")).toHaveLength(1);
    });
    const sendBody = JSON.parse(String(fetchCalls("/api/pty/sessions/term-b/send")[0][1]?.body));
    expect(sendBody.text).toBe("cd '/app/namespaces/marco/workspace/mentiko'\r");
  });

  it("cds to the active workspace when the panel reopens and auto-cd is enabled", async () => {
    terminalPrefs = { autoCdFloatingTerminalToWorkspace: true };
    await openPanel();
    await waitFor(() => expect(fetchCalls("/api/pty/sessions/term-a/send")).toHaveLength(1));

    fireEvent.click(screen.getByTitle("Close panel (sessions keep running)"));
    await act(async () => {
      window.dispatchEvent(new Event("toggle-terminal-panel"));
    });

    await waitFor(() => expect(fetchCalls("/api/pty/sessions/term-a/send")).toHaveLength(2));
  });

  it("does not cd watchdog or chain-runner sessions when the panel auto-selects them", async () => {
    global.fetch = jest.fn(async (url, init) => {
      if (String(url) === "/api/pty/sessions") {
        return mockSessionRecords([
          { name: "mentiko-watchdog" },
          { name: "ambient-fs-run-123" },
        ]);
      }
      if (String(url) === "/api/terminal/spawn") return mockSpawn(JSON.parse(String(init?.body)).name);
      if (String(url).includes("/send")) return mockSend();
      return { ok: true, json: async () => ({ data: {} }) };
    }) as jest.Mock;

    await openPanel();
    await waitFor(() => expect(screen.getAllByText("mentiko-watchdog").length).toBeGreaterThan(0));

    expect(fetchCalls("/send")).toHaveLength(0);
  });

  it("falls back without cwd or cd when no workspace is active", async () => {
    workspaceState = {
      workspaceId: "",
      workspacePath: "",
      workspaceReady: true,
      refetch: jest.fn(async () => []),
    };
    await openPanel();

    fireEvent.click(screen.getByTitle("New terminal"));

    await waitFor(() => expect(fetchCalls("/api/terminal/spawn")).toHaveLength(1));
    const spawnBody = JSON.parse(String(fetchCalls("/api/terminal/spawn")[0][1]?.body));
    expect(spawnBody).not.toHaveProperty("cwd");
    expect(spawnBody).not.toHaveProperty("workspaceId");
    expect(fetchCalls("/send")).toHaveLength(0);
  });

  it("waits for workspace context before spawning when workspace path is still loading", async () => {
    workspaceState = {
      workspaceId: "ws-1",
      workspacePath: "",
      workspaceReady: false,
      refetch: jest.fn(async () => [
        { id: "ws-1", path: "/app/namespaces/marco/workspace/mentiko" },
      ]),
    };
    await openPanel();

    fireEvent.click(screen.getByTitle("New terminal"));

    await waitFor(() => expect(workspaceState.refetch).toHaveBeenCalledTimes(1));
    const spawnBody = JSON.parse(String(fetchCalls("/api/terminal/spawn")[0][1]?.body));
    expect(spawnBody.cwd).toBe("/app/namespaces/marco/workspace/mentiko");
  });
});
