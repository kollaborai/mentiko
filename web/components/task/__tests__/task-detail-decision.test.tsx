/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { TaskDetail } from "../task-detail";
import type { Task } from "@/lib/tasks/task-types";

jest.mock("@/components/decision/decision-detail", () => ({
  DecisionDetail: ({ decisionId, workspacePath }: { decisionId: string; workspacePath?: string }) => (
    <div data-testid="decision-detail">
      decision:{decisionId}:{workspacePath}
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
  TaskChildren: () => <div data-testid="task-children" />,
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
});
