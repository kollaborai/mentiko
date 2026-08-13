import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TaskListItem } from "../task-list-item";
import type { Task } from "@/lib/tasks/task-types";
import { makeEditorState } from "@/app/docs/ui-editor/editor-model";
import { TASK_SIDEBAR_STORAGE_KEY } from "@/lib/task-sidebar-editor";

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
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders task title", () => {
    render(
      <TaskListItem
        task={baseTask}
        selected={false}
        onSelect={jest.fn()}
        onToggleComplete={jest.fn()}
      />,
    );
    const title = screen.getByText("Fix the bug");
    const updatedAt = screen.getByText("2h ago");
    expect(title).toHaveClass("line-clamp-2");
    expect(updatedAt).toHaveClass("shrink-0", "whitespace-nowrap");
    expect(updatedAt.parentElement).toBe(title.parentElement);
    expect(updatedAt.parentElement).toHaveClass("items-end");
  });

  it("uses the saved UI editor layout when one is published", async () => {
    const editorState = makeEditorState();
    editorState.rows[0].columns[0].cells[0].fields.push("description");
    editorState.fieldStyles.description.visible = true;
    localStorage.setItem(TASK_SIDEBAR_STORAGE_KEY, JSON.stringify(editorState));

    render(
      <TaskListItem
        task={baseTask}
        selected={false}
        onSelect={jest.fn()}
        onToggleComplete={jest.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("task-sidebar-configured-layout")).toBeInTheDocument(),
    );
    expect(screen.getByText("Something is broken")).toBeInTheDocument();
    expect(screen.getByText("2h ago")).toBeInTheDocument();
  });

  it("renders the typed task ID and priority without a redundant type badge", () => {
    render(
      <TaskListItem
        task={baseTask}
        selected={false}
        onSelect={jest.fn()}
        onToggleComplete={jest.fn()}
      />,
    );
    expect(screen.getByTestId("priority-badge")).toHaveTextContent("high");
    expect(screen.getByText("task-1")).toHaveClass("whitespace-nowrap");
    expect(screen.queryByTestId("type-badge")).not.toBeInTheDocument();
  });

  it("strikes completed titles without striking the update time", () => {
    render(
      <TaskListItem
        task={{ ...baseTask, completed: true, status: "closed" }}
        selected={false}
        onSelect={jest.fn()}
        onToggleComplete={jest.fn()}
      />,
    );

    expect(screen.getByText("Fix the bug")).toHaveClass("line-through");
    expect(screen.getByText("2h ago")).not.toHaveClass("line-through");
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

  it("does not render a sidebar accent rail", () => {
    render(
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

    expect(screen.getByTestId("workflow-sidebar-item")).not.toHaveAttribute(
      "data-accent",
    );
  });
});
