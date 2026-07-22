import { render, screen, fireEvent } from "@testing-library/react";
import { TaskListItem } from "../task-list-item";
import type { Task } from "@/lib/tasks/task-types";

jest.mock("@/components/ui/workflow-sidebar", () => ({
  WorkflowSidebarItem: ({
    children,
    selected,
    onClick,
    className,
    accentClassName,
  }: {
    children?: React.ReactNode;
    selected?: boolean;
    onClick?: () => void;
    className?: string;
    accentClassName?: string;
  }) => (
    <div
      data-testid="workflow-sidebar-item"
      data-selected={selected ? "true" : "false"}
      data-accent={accentClassName}
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

jest.mock("@/lib/tasks/task-transforms", () => ({
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
      />,
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
      />,
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
      />,
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
      />,
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
      />,
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
      />,
    );
    expect(container.firstChild).toHaveAttribute("data-selected", "true");
  });

  it("does not claim raw dependency counts are active blockers", () => {
    render(
      <TaskListItem
        task={baseTask}
        selected={false}
        onSelect={jest.fn()}
        onToggleComplete={jest.fn()}
        depInfo={
          new Map([[baseTask.id, { blockedBy: ["task-closed"], blocks: [] }]])
        }
      />,
    );

    expect(screen.getByTitle("1 dependency")).toBeInTheDocument();
    expect(screen.queryByTitle("Blocked by 1 task")).not.toBeInTheDocument();
  });

  it("uses the sidebar rail for execution state, not priority", () => {
    const { rerender } = render(
      <TaskListItem
        task={baseTask}
        selected={false}
        onSelect={jest.fn()}
        onToggleComplete={jest.fn()}
      />,
    );

    expect(screen.getByTestId("workflow-sidebar-item")).toHaveAttribute(
      "data-accent",
      "bg-muted-foreground/40",
    );

    rerender(
      <TaskListItem
        task={{
          ...baseTask,
          chainBinding: {
            chain_id: "chain-1",
            chain_name: "Chain",
            auto_run: false,
            last_run_status: "running",
          },
        }}
        selected={false}
        onSelect={jest.fn()}
        onToggleComplete={jest.fn()}
      />,
    );

    expect(screen.getByTestId("workflow-sidebar-item")).toHaveAttribute(
      "data-accent",
      "bg-sky-400",
    );
  });
});
