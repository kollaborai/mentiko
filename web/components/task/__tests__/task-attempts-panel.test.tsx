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
    render(<TaskAttemptsPanel taskId="TASK-1" />);

    expect(
      await screen.findByText("System, generation, and execution activity"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/run history for/i)).not.toBeInTheDocument();
    expect(screen.getByText("Runs")).toBeInTheDocument();
    expect(screen.queryByText(/task runs/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/chain attempts/i)).not.toBeInTheDocument();
    expect(await screen.findByText("Chain Recommendation")).toBeInTheDocument();
    expect(
      screen.getByText("Git Branch Management API Chain"),
    ).toBeInTheDocument();
    expect(screen.getByText("current")).toBeInTheDocument();
    expect(screen.queryByTestId("run-detail-panel")).not.toBeInTheDocument();
    expect(
      screen.getByText("Select a run to open its detail."),
    ).toBeInTheDocument();

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

    render(<TaskAttemptsPanel taskId="TASK-1" />);

    await screen.findByText("Chain Recommendation");
    const runButtons = screen
      .getAllByRole("button")
      .map((button) => button.textContent || "");

    expect(runButtons).toEqual([
      expect.stringContaining("Chain Recommendation"),
      expect.stringContaining("First Execution"),
      expect.stringContaining("Run Summary Generation"),
      expect.stringContaining("Later Execution"),
    ]);
  });

  it("uses the same section header while runs are loading", () => {
    mockFetchWithNamespace.mockReturnValue(new Promise(() => {}));

    render(<TaskAttemptsPanel taskId="TASK-1" />);

    const section = document.querySelector("#task-runs");
    expect(section).toBeInTheDocument();
    expect(screen.getByText("Runs")).toBeInTheDocument();
    expect(
      screen.getByText("System, generation, and execution activity"),
    ).toBeInTheDocument();
    expect(screen.getByText("Loading runs...")).toBeInTheDocument();
    expect(source).toContain("function RunsSectionHeader");
  });

  it("keeps every run in the full-height rail instead of creating a nested scrollbar", () => {
    expect(source).toContain("min-h-[720px]");
    expect(source).toContain("xl:grid-cols-[280px_minmax(0,1fr)]");
    expect(source).not.toContain("max-h-[340px]");
    expect(source).not.toContain("overflow-y-auto pr-1 no-scrollbar");
    expect(source).not.toContain("self-start");
  });
});
