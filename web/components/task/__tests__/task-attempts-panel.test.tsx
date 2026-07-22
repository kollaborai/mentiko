import { readFileSync } from "fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TaskAttemptsPanel } from "../task-attempts-panel";

jest.mock(
  "@aliimam/icons",
  () =>
    new Proxy(
      {},
      {
        get:
          () =>
          ({ className }: { className?: string }) => (
    <svg className={className} aria-hidden="true" />
  ),
      },
    ),
);

const mockFetchWithNamespace = jest.fn();
jest.mock("@/lib/hooks/use-namespace-fetch", () => ({
  useNamespaceFetch: () => ({ fetchWithNamespace: mockFetchWithNamespace }),
}));

jest.mock("@/components/run/run-detail-panel", () => ({
  RunDetailPanel: ({
    runId,
    embedded,
  }: {
    runId: string;
    embedded?: boolean;
  }) => (
    <div data-testid="run-detail-panel">
      {embedded ? "embedded" : "page"} {runId}
    </div>
  ),
}));

jest.mock("../task-chain-section", () => ({
  TaskChainSection: () => <div data-testid="chain-section">chain</div>,
}));

jest.mock("../task-run-story-panels", () => ({
  TaskRunStoryPanels: () => <div data-testid="story-panels">summary</div>,
}));

const baseTask = {
  id: "TASK-1",
  title: "Task one",
  status: "open",
  metadata: {},
} as never;

describe("TaskAttemptsPanel", () => {
  const source = readFileSync(
    new URL("../task-attempts-panel.tsx", import.meta.url),
    "utf8",
  );

  beforeEach(() => {
    mockFetchWithNamespace.mockReset();
    mockFetchWithNamespace.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          taskId: "TASK-1",
          currentExecutionRunId: "run-exec",
          attempts: [
            {
              runId: "run-rec",
              kind: "recommendation",
              category: "system",
              chainName: "Chain Recommendation",
              status: "completed",
              startedAt: "2026-06-21T10:00:00.000Z",
              source: "run_json",
              isSystem: true,
              isCurrent: false,
              isLatestForKind: true,
            },
            {
              runId: "run-exec",
              kind: "execution",
              category: "task_execution",
              chainName: "Git Branch Management API Chain",
              status: "completed",
              startedAt: "2026-06-21T10:10:00.000Z",
              source: "merged",
              isSystem: false,
              isCurrent: true,
              isLatestForKind: true,
            },
          ],
        },
      }),
    });
  });

  it("renders the task attempt sidebar first and mounts the canonical run detail only after a selection", async () => {
    render(
      <TaskAttemptsPanel
        task={baseTask}
        onAssignChain={jest.fn()}
        onRemoveChain={jest.fn()}
      />,
    );

    expect(
      await screen.findByText("Chain, runs, outcome, and decision"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/run history for/i)).not.toBeInTheDocument();
    expect(screen.getByText("Execution")).toBeInTheDocument();
    expect(screen.queryByText(/task runs/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/chain attempts/i)).not.toBeInTheDocument();
    expect(await screen.findByText("Chain Recommendation")).toBeInTheDocument();
    expect(
      screen.getByText("Git Branch Management API Chain"),
    ).toBeInTheDocument();
    expect(screen.getByText("current")).toBeInTheDocument();
    // the rail opens on the chain (the task's plan), not an empty viewer
    expect(screen.queryByTestId("run-detail-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("chain-section")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /recommendation.*run-rec/i }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("run-detail-panel")).toHaveTextContent(
        "embedded run-rec",
      );
    });
  });

  it("renders runs in the API execution order without pinning current execution first", async () => {
    mockFetchWithNamespace.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          taskId: "TASK-1",
          currentExecutionRunId: "run-exec-current",
          attempts: [
            {
              runId: "run-rec",
              kind: "recommendation",
              category: "system",
              chainName: "Chain Recommendation",
              status: "completed",
              startedAt: "2026-06-21T10:00:00.000Z",
              source: "run_json",
              isSystem: true,
              isCurrent: false,
              isLatestForKind: true,
            },
            {
              runId: "run-exec-current",
              kind: "execution",
              category: "task_execution",
              chainName: "First Execution",
              status: "completed",
              startedAt: "2026-06-21T10:10:00.000Z",
              source: "merged",
              isSystem: false,
              isCurrent: true,
              isLatestForKind: false,
            },
            {
              runId: "run-summary",
              kind: "outcome_summary",
              category: "system",
              chainName: "Run Summary Generation",
              status: "completed",
              startedAt: "2026-06-21T10:20:00.000Z",
              source: "run_json",
              isSystem: true,
              isCurrent: false,
              isLatestForKind: true,
            },
            {
              runId: "run-exec-later",
              kind: "execution",
              category: "task_execution",
              chainName: "Later Execution",
              status: "stopped",
              startedAt: "2026-06-21T10:30:00.000Z",
              source: "run_json",
              isSystem: false,
              isCurrent: false,
              isLatestForKind: true,
            },
          ],
        },
      }),
    });

    render(
      <TaskAttemptsPanel
        task={baseTask}
        onAssignChain={jest.fn()}
        onRemoveChain={jest.fn()}
      />,
    );

    await screen.findByText("Chain Recommendation");
    const runButtons = screen
      .getAllByRole("button")
      .map((button) => button.textContent || "");

    expect(runButtons).toEqual([
      expect.stringContaining("Chain Recommendation"),
      expect.stringContaining("No chain"),
      expect.stringContaining("First Execution"),
      expect.stringContaining("Summary"),
      expect.stringContaining("Later Execution"),
    ]);
  });

  it("uses the same section header while runs are loading", () => {
    mockFetchWithNamespace.mockReturnValue(new Promise(() => {}));

    render(
      <TaskAttemptsPanel
        task={baseTask}
        onAssignChain={jest.fn()}
        onRemoveChain={jest.fn()}
      />,
    );

    const section = document.querySelector("#task-runs");
    expect(section).toBeInTheDocument();
    expect(screen.getByText("Execution")).toBeInTheDocument();
    expect(
      screen.getByText("Chain, runs, outcome, and decision"),
    ).toBeInTheDocument();
    expect(screen.getByText("Loading execution...")).toBeInTheDocument();
    expect(source).toContain("function RunsSectionHeader");
  });

  it("merges chain, runs, outcome and decision into one rail and swaps the viewer per kind", async () => {
    mockFetchWithNamespace.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          taskId: "TASK-1",
          attempts: [
            {
              runId: "run-exec",
              kind: "execution",
              category: "task_execution",
              chainName: "Audit Chain",
              status: "completed",
              startedAt: "2026-06-21T10:00:00.000Z",
              source: "merged",
              isSystem: false,
              isCurrent: true,
              isLatestForKind: true,
            },
            {
              runId: "run-summary",
              kind: "outcome_summary",
              category: "system",
              chainName: "Run Summary Generation",
              status: "completed",
              startedAt: "2026-06-21T10:20:00.000Z",
              source: "run_json",
              isSystem: true,
              isCurrent: false,
              isLatestForKind: true,
            },
          ],
        },
      }),
    });

    const boundTask = {
      id: "TASK-1",
      title: "Task one",
      status: "open",
      chainBinding: { chain_id: "audit-chain", chain_name: "Audit Chain" },
      metadata: {
        last_audit_verdict: "decision",
        reopened_reason: "needs a human call",
      },
    } as never;

    render(
      <TaskAttemptsPanel
        task={boundTask}
        onAssignChain={jest.fn()}
        onRemoveChain={jest.fn()}
      />,
    );

    // the bound chain, the summary and the decision all live in the one rail
    await screen.findByText("Summary");
    expect(screen.getByText("Decision")).toBeInTheDocument();
    expect(screen.getAllByText("Audit Chain").length).toBeGreaterThan(0);

    // defaults to the chain (the plan)
    expect(screen.getByTestId("chain-section")).toBeInTheDocument();

    // summary opens the outcome viewer, not the raw run detail
    fireEvent.click(screen.getByRole("button", { name: /Summary run-summary/i }));
    await waitFor(() => {
      expect(screen.getByTestId("story-panels")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("run-detail-panel")).not.toBeInTheDocument();

    // decision opens the verdict
    fireEvent.click(screen.getByRole("button", { name: /Decision decision/i }));
    await waitFor(() => {
      expect(screen.getByText("completion audit · decision")).toBeInTheDocument();
    });
    expect(screen.getByText("needs a human call")).toBeInTheDocument();
  });

  it("bounds the run rail to the viewport and scrolls it visibly instead of clipping", () => {
    // The rail used to carry a hard min-h-[720px] floor, which forced the panel
    // 720px tall on every viewport and clipped the run list against the grid's
    // overflow-hidden. Bound it to the viewport instead and let each column
    // scroll on its own.
    expect(source).not.toContain("min-h-[720px]");
    expect(source).toContain("xl:h-[min(560px,70vh)]");
    expect(source).toContain("xl:grid-cols-[280px_minmax(0,1fr)]");
    // Still no cramped cap and no hidden scrollbar — runs stay discoverable.
    expect(source).not.toContain("max-h-[340px]");
    expect(source).not.toContain("no-scrollbar");
    expect(source).not.toContain("self-start");
  });
});
