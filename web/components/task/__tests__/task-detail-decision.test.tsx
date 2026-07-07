/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskDetail } from "../task-detail";
import type { Task } from "@/lib/tasks/task-types";

jest.mock("@/components/decision/decision-detail", () => ({
  DecisionDetail: ({
    decisionId,
    workspacePath,
    onOpenTask,
  }: {
    decisionId: string;
    workspacePath?: string;
    onOpenTask?: (taskId: string) => void;
  }) => (
    <div data-testid="decision-detail">
      decision:{decisionId}:{workspacePath}
      <button type="button" onClick={() => onOpenTask?.("EPIC-009")}>
        open linked task
      </button>
    </div>
  ),
}));

jest.mock("../task-detail-header", () => ({
  TaskDetailHeader: () => <div data-testid="task-detail-header" />,
}));

jest.mock("../task-chain-section", () => ({
  TaskChainSection: () => <div data-testid="task-chain-section" />,
}));

jest.mock("../task-children", () => ({
  TaskChildren: ({ items }: { items: Task[] }) => (
    <div data-testid="task-children">
      {items.map((item) => (
        <span key={item.id}>{item.id}</span>
      ))}
    </div>
  ),
}));

jest.mock("../task-comments", () => ({
  TaskComments: () => <div data-testid="task-comments" />,
}));

jest.mock("../task-activity", () => ({
  TaskActivity: () => <div data-testid="task-activity" />,
}));

jest.mock("../task-deps-graph", () => ({
  TaskDepsGraph: () => <div data-testid="task-deps-graph" />,
}));

jest.mock("../task-run-story-panels", () => ({
  TaskRunStoryPanels: () => <div data-testid="task-run-story-panels" />,
}));

jest.mock("@/components/ui/markdown", () => ({
  Markdown: ({ content }: { content: string }) => <div>{content}</div>,
}));

const baseTask: Task = {
  id: "DEC-001",
  title: "Decide the rollout path",
  description: "Decision details live in the decision workflow.",
  completed: false,
  status: "open",
  priority: "medium",
  rawPriority: 2,
  type: "decision",
  owner: "",
  assignee: "",
  createdBy: "user-1",
  createdAt: "2026-06-21T00:00:00Z",
  updatedAt: "2026-06-21T00:00:00Z",
  labels: [],
  dependencyCount: 0,
  dependentCount: 0,
  commentCount: 0,
  metadata: {
    decision_id: "decision-1",
  },
};

describe("TaskDetail decision mapping", () => {
  it("renders the decision workflow for linked decision task rows", () => {
    render(
      <TaskDetail
        task={baseTask}
        subtasks={[]}
        comments={[]}
        onBack={jest.fn()}
        onClose={jest.fn()}
        onReopen={jest.fn()}
        onEdit={jest.fn()}
        onSelectChild={jest.fn()}
        onSelectDep={jest.fn()}
        onAssignChain={jest.fn()}
        onRemoveChain={jest.fn()}
        onRunChain={jest.fn()}
        onToggleAutoRun={jest.fn()}
        onAddComment={jest.fn()}
        isRunning={false}
        workspacePath="/repo"
      />,
    );

    expect(screen.getByTestId("decision-detail")).toHaveTextContent("decision:decision-1:/repo");
    expect(screen.queryByTestId("task-chain-section")).not.toBeInTheDocument();
  });

  it("renders generated child tasks normally even when they keep decision provenance", () => {
    render(
      <TaskDetail
        task={{
          ...baseTask,
          id: "TASK-092",
          title: "Initialize Next.js 16 project",
          type: "task",
          metadata: {
            decision_id: "decision-1",
            decision_plan_task_id: "task-1",
          },
        }}
        subtasks={[]}
        comments={[]}
        onBack={jest.fn()}
        onClose={jest.fn()}
        onReopen={jest.fn()}
        onEdit={jest.fn()}
        onSelectChild={jest.fn()}
        onSelectDep={jest.fn()}
        onAssignChain={jest.fn()}
        onRemoveChain={jest.fn()}
        onRunChain={jest.fn()}
        onToggleAutoRun={jest.fn()}
        onAddComment={jest.fn()}
        isRunning={false}
        workspacePath="/repo"
      />,
    );

    expect(screen.queryByTestId("decision-detail")).not.toBeInTheDocument();
    expect(screen.getByTestId("task-chain-section")).toBeInTheDocument();
  });

  it("wires embedded decision open-task actions to local task selection", () => {
    const onSelectDep = jest.fn();
    const onOpenTask = jest.fn();
    render(
      <TaskDetail
        task={baseTask}
        subtasks={[]}
        comments={[]}
        onBack={jest.fn()}
        onClose={jest.fn()}
        onReopen={jest.fn()}
        onEdit={jest.fn()}
        onSelectChild={jest.fn()}
        onSelectDep={onSelectDep}
        onAssignChain={jest.fn()}
        onRemoveChain={jest.fn()}
        onRunChain={jest.fn()}
        onToggleAutoRun={jest.fn()}
        onOpenTask={onOpenTask}
        onAddComment={jest.fn()}
        isRunning={false}
        workspacePath="/repo"
      />,
    );

    screen.getByRole("button", { name: "open linked task" }).click();

    expect(onOpenTask).toHaveBeenCalledWith("EPIC-009");
    expect(onSelectDep).not.toHaveBeenCalled();
  });

  it("opens completion-audit decision subtasks through cross-filter task navigation", async () => {
    const user = userEvent.setup();
    const onSelectDep = jest.fn();
    const onOpenTask = jest.fn();

    render(
      <TaskDetail
        task={{
          ...baseTask,
          id: "TASK-092",
          title: "Initialize Next.js 16 project",
          type: "task",
          metadata: {
            last_audit_verdict: "decision",
            decision_subtask_id: "DEC-034",
          },
        }}
        subtasks={[]}
        comments={[]}
        onBack={jest.fn()}
        onClose={jest.fn()}
        onReopen={jest.fn()}
        onEdit={jest.fn()}
        onSelectChild={jest.fn()}
        onSelectDep={onSelectDep}
        onAssignChain={jest.fn()}
        onRemoveChain={jest.fn()}
        onRunChain={jest.fn()}
        onToggleAutoRun={jest.fn()}
        onOpenTask={onOpenTask}
        onAddComment={jest.fn()}
        isRunning={false}
        workspacePath="/repo"
      />,
    );

    await user.click(screen.getByRole("button", { name: "→ view decision subtask" }));

    expect(onOpenTask).toHaveBeenCalledWith("DEC-034");
    expect(onSelectDep).not.toHaveBeenCalled();
  });

  it("hides superseded completion-audit decision subtasks", () => {
    render(
      <TaskDetail
        task={{
          ...baseTask,
          id: "TASK-093",
          title: "Build backend lead-capture function",
          type: "task",
          metadata: {
            decision_subtask_id: "DEC-038",
            superseded_decision_subtask_ids: ["DEC-039", "DEC-040"],
          },
        }}
        subtasks={[
          {
            ...baseTask,
            id: "DEC-038",
            title: "Resume stalled lead-capture API chain",
            metadata: {
              decision_id: "decision-38",
              decision_status: "briefed",
            },
          },
          {
            ...baseTask,
            id: "DEC-039",
            title: "Duplicate stalled lead-capture API gate",
            status: "closed",
            completed: true,
            metadata: {
              decision_id: "decision-39",
              decision_status: "superseded",
            },
          },
          {
            ...baseTask,
            id: "DEC-040",
            title: "Duplicate repeated orchestration stall gate",
            status: "closed",
            completed: true,
            metadata: {
              decision_id: "decision-40",
              decision_status: "superseded",
            },
          },
        ]}
        comments={[]}
        onBack={jest.fn()}
        onClose={jest.fn()}
        onReopen={jest.fn()}
        onEdit={jest.fn()}
        onSelectChild={jest.fn()}
        onSelectDep={jest.fn()}
        onAssignChain={jest.fn()}
        onRemoveChain={jest.fn()}
        onRunChain={jest.fn()}
        onToggleAutoRun={jest.fn()}
        onAddComment={jest.fn()}
        isRunning={false}
        workspacePath="/repo"
      />,
    );

    expect(screen.getByTestId("task-children")).toHaveTextContent("DEC-038");
    expect(screen.getByTestId("task-children")).not.toHaveTextContent("DEC-039");
    expect(screen.getByTestId("task-children")).not.toHaveTextContent("DEC-040");
  });
});
