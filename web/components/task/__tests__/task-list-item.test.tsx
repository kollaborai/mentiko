import { render, screen, fireEvent } from "@testing-library/react";
import { TaskListItem } from "../task-list-item";
import type { Task } from "@/lib/task-types";

jest.mock("@/components/ui/workflow-sidebar", () => ({
  WorkflowSidebarItem: ({
    children,
    selected,
    onClick,
    className,
  }: {
    children?: React.ReactNode;
    selected?: boolean;
    onClick?: () => void;
    className?: string;
  }) => (
    <div
      data-testid="workflow-sidebar-item"
      data-selected={selected ? "true" : "false"}
      className={className}
      onClick={onClick}
    >
      {children}
    </div>
  ),
}));

jest.mock("../priority-badge", () => ({
  PriorityBadge: ({ priority }: { priority: string }) => (
    <span data-testid="priority-badge">{priority}</span>
  ),
}));

jest.mock("../type-badge", () => ({
  TypeBadge: ({ type }: { type: string }) => (
    <span data-testid="type-badge">{type}</span>
  ),
}));

jest.mock("lucide-react", () => ({
  Check: ({ className }: { className?: string }) => (
    <svg data-testid="check-icon" className={className} />
  ),
  Link2: ({ className }: { className?: string }) => (
    <svg data-testid="link-icon" className={className} />
  ),
  GitBranch: ({ className }: { className?: string }) => (
    <svg data-testid="git-branch-icon" className={className} />
  ),
  Loader2: ({ className }: { className?: string }) => (
    <svg data-testid="loader-icon" className={className} />
  ),
  PlayCircle: ({ className }: { className?: string }) => (
    <svg data-testid="play-circle-icon" className={className} />
  ),
}));

jest.mock("@/lib/task-transforms", () => ({
  timeAgo: (_d: string) => "2h ago",
}));

const baseTask: Task = {
  id: "task-1",
  title: "Fix the bug",
  description: "Something is broken",
  completed: false,
  status: "open",
  priority: "high",
  rawPriority: 1,
  type: "bug",
  owner: "marco",
  assignee: "",
  createdBy: "marco",
  createdAt: "2025-02-20T10:00:00Z",
  updatedAt: "2025-02-20T12:00:00Z",
  labels: [],
  dependencyCount: 0,
  dependentCount: 0,
  commentCount: 0,
};

describe("TaskListItem", () => {
  it("renders task title", () => {
    render(
      <TaskListItem
        task={baseTask}
        selected={false}
        onSelect={jest.fn()}
        onToggleComplete={jest.fn()}
      />
    );
    expect(screen.getByText("Fix the bug")).toBeInTheDocument();
  });

  it("renders type and priority badges", () => {
    render(
      <TaskListItem
        task={baseTask}
        selected={false}
        onSelect={jest.fn()}
        onToggleComplete={jest.fn()}
      />
    );
    expect(screen.getByTestId("type-badge")).toHaveTextContent("bug");
    expect(screen.getByTestId("priority-badge")).toHaveTextContent("high");
  });

  it("calls onSelect when clicked", () => {
    const onSelect = jest.fn();
    const { container } = render(
      <TaskListItem
        task={baseTask}
        selected={false}
        onSelect={onSelect}
        onToggleComplete={jest.fn()}
      />
    );
    fireEvent.click(container.firstChild!);
    expect(onSelect).toHaveBeenCalledWith(baseTask);
  });

  it("does not render a complete checkbox button", () => {
    render(
      <TaskListItem
        task={baseTask}
        selected={false}
        onSelect={jest.fn()}
        onToggleComplete={jest.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: "Complete task" })).toBeNull();
  });

  it("shows chain badge when task has chain binding", () => {
    const chainTask: Task = {
      ...baseTask,
      chainBinding: {
        chain_id: "code-review",
        chain_name: "Code Review",
        auto_run: false,
      },
    };
    render(
      <TaskListItem
        task={chainTask}
        selected={false}
        onSelect={jest.fn()}
        onToggleComplete={jest.fn()}
      />
    );
    expect(screen.getByText("Code Review")).toBeInTheDocument();
  });

  it("applies selected styling", () => {
    const { container } = render(
      <TaskListItem
        task={baseTask}
        selected={true}
        onSelect={jest.fn()}
        onToggleComplete={jest.fn()}
      />
    );
    expect(container.firstChild).toHaveAttribute("data-selected", "true");
  });
});
