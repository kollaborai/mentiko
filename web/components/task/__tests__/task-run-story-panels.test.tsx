import { render, screen, waitFor } from "@testing-library/react";
import type { Task } from "@/lib/tasks/task-types";
import { TaskRunStoryPanels } from "../task-run-story-panels";

jest.mock("@aliimam/icons", () => new Proxy({}, {
  get: () => ({ className }: { className?: string }) => (
    <svg className={className} aria-hidden="true" />
  ),
}));

const mockFetchWithNamespace = jest.fn();
jest.mock("@/lib/hooks/use-namespace-fetch", () => ({
  useNamespaceFetch: () => ({ fetchWithNamespace: mockFetchWithNamespace }),
}));

const task: Task = {
  id: "TASK-1",
  title: "Validate branch API",
  description: "",
  completed: true,
  status: "closed",
  priority: "high",
  rawPriority: 1,
  type: "feature",
  owner: "",
  assignee: "",
  createdBy: "",
  createdAt: "2026-06-21T00:00:00Z",
  updatedAt: "2026-06-21T01:00:00Z",
  closedAt: "2026-06-21T02:00:00Z",
  labels: [],
  dependencyCount: 0,
  dependentCount: 0,
  commentCount: 0,
  chainBinding: {
    chain_id: "git-branch-management-api-chain",
    chain_name: "Git Branch Management API Chain",
    auto_run: false,
    last_run_id: "run-exec",
    last_run_status: "completed",
  },
  metadata: {
    task_outcome_summary_status: "running",
    task_outcome_summary_source_run_id: "run-old",
    last_run_summary: {
      run_id: "run-exec",
      chain: "Git Branch Management API Chain",
      status: "completed",
      outcome: "complete",
      summary: "Task completed from the stored run summary.",
      findings: ["All checks passed."],
      artifacts_count: 21,
      agents: [{ name: "Git API Architect", status: "complete" }],
    },
  },
};

describe("TaskRunStoryPanels", () => {
  beforeEach(() => {
    mockFetchWithNamespace.mockReset();
    mockFetchWithNamespace.mockResolvedValue({
      ok: true,
      json: async () => ({ data: {} }),
    });
  });

  it("does not show stale summarizing status when a fallback run summary is already present", () => {
    render(<TaskRunStoryPanels task={task} />);

    expect(screen.getByText("Summary")).toBeInTheDocument();
    expect(screen.queryByText("Outcome Dashboard")).not.toBeInTheDocument();
    expect(screen.queryByText("summarizing")).not.toBeInTheDocument();
  });

  it("renders the completed outcome summary when execution metadata was cleared", () => {
    const decisionBlockedTask: Task = {
      ...task,
      completed: false,
      status: "open",
      closedAt: undefined,
      chainBinding: {
        chain_id: "phase-1-lead-capture-validation",
        chain_name: "Phase 1 Lead Capture Validation",
        auto_run: true,
      },
      metadata: {
        task_outcome_summary_status: "complete",
        task_outcome_summary_source_run_id: "run-source",
        task_outcome_summary_run_id: "run-summary",
        task_outcome_summary: {
          headline: "All six phase-1 lead-capture test cases passed.",
          narrative: "Runtime validation passed but closure needs review.",
          outcome: "complete",
          confidence: "high",
          decision_required: true,
          what_happened: ["Happy path passed."],
          evidence: ["phase-1-validation-report.md"],
          improvement_signals: ["QA-only tasks need a closeability rule."],
          next_actions: ["Decide whether to close TASK-096."],
        },
      },
    };

    render(<TaskRunStoryPanels task={decisionBlockedTask} />);

    expect(screen.getByText("All six phase-1 lead-capture test cases passed.")).toBeInTheDocument();
    expect(screen.getByText("Runtime validation passed but closure needs review.")).toBeInTheDocument();
    expect(screen.getByText("ready")).toBeInTheDocument();
    expect(screen.getByText("review")).toBeInTheDocument();
    expect(screen.getAllByText("run-source").length).toBeGreaterThan(0);
    expect(screen.getByText("run-summary")).toBeInTheDocument();
  });

  it("keeps the Summary label outside the panel while summary generation is pending", () => {
    const pendingTask: Task = {
      ...task,
      chainBinding: {
        ...task.chainBinding!,
        last_run_status: "completed",
        last_run_id: "run-pending",
      },
      metadata: {
        task_outcome_summary_status: "running",
        task_outcome_summary_source_run_id: "run-old",
      },
    };

    render(<TaskRunStoryPanels task={pendingTask} />);

    const section = screen.getByText("Summary").closest("section");
    expect(section).toBeInTheDocument();
    expect(section?.firstElementChild).toHaveTextContent("Summary");
    expect(section?.firstElementChild).toHaveTextContent("summarizing");
    expect(section?.querySelector(":scope > .rounded-sm.bg-muted")).not.toHaveTextContent("Summary");
    expect(screen.queryByText("Outcome Dashboard")).not.toBeInTheDocument();
  });

  it("keeps the Summary label outside the panel when summary generation fails", () => {
    const failedTask: Task = {
      ...task,
      chainBinding: {
        ...task.chainBinding!,
        last_run_status: "completed",
        last_run_id: "run-failed",
      },
      metadata: {
        task_outcome_summary_status: "failed",
        task_outcome_summary_error: "Generation failed.",
        task_outcome_summary_source_run_id: "run-old",
      },
    };

    render(<TaskRunStoryPanels task={failedTask} />);

    const section = screen.getByText("Summary").closest("section");
    expect(section).toBeInTheDocument();
    expect(section?.firstElementChild).toHaveTextContent("Summary");
    expect(section?.firstElementChild).toHaveTextContent("failed");
    expect(section?.querySelector(":scope > .rounded-sm.bg-muted")).not.toHaveTextContent("Summary");
    expect(screen.getByText("Generation failed.")).toBeInTheDocument();
    expect(screen.queryByText("Outcome Dashboard")).not.toBeInTheDocument();
  });

  it("shows the exact typed blocked reason and treats blocked as terminal for audit", async () => {
    const blockedTask: Task = {
      ...task,
      completed: false,
      status: "open",
      closedAt: undefined,
      chainBinding: {
        ...task.chainBinding!,
        last_run_id: "run-blocked",
        last_run_status: "blocked",
        last_run_outcome: "blocked",
        last_run_blocked_reason: "startup_recovery:blocked: authentication required",
      },
      metadata: {
        last_run_blocked_reason: "startup_recovery:blocked: authentication required",
      },
    };

    render(<TaskRunStoryPanels task={blockedTask} />);

    expect(screen.getByText("Run blocked")).toBeInTheDocument();
    expect(screen.getAllByText(/startup_recovery:blocked: authentication required/).length).toBeGreaterThan(0);
    await waitFor(() => expect(mockFetchWithNamespace).toHaveBeenCalledWith(
      "/api/tasks/TASK-1/outcome-summary",
      expect.objectContaining({ method: "POST" }),
    ));
  });
});
