import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes, CSSProperties, ReactNode } from "react";
import { TaskDetailHeader } from "../task-detail-header";
import type { Task } from "@/lib/tasks/task-types";

jest.mock("@aliimam/icons", () => ({
  ArrowLeftFilled: ({ className }: { className?: string }) => (
    <svg className={className} aria-hidden="true" />
  ),
  CalendarFilled: ({ className }: { className?: string }) => (
    <svg className={className} aria-hidden="true" />
  ),
  ClockFilled: ({ className }: { className?: string }) => (
    <svg className={className} aria-hidden="true" />
  ),
  CloseCircleFilled: ({ className }: { className?: string }) => (
    <svg className={className} aria-hidden="true" />
  ),
  CopyFilled: ({ className }: { className?: string }) => (
    <svg className={className} aria-hidden="true" />
  ),
  EditFilled: ({ className }: { className?: string }) => (
    <svg className={className} aria-hidden="true" />
  ),
  JudgeFilled: ({ className }: { className?: string }) => (
    <svg className={className} aria-hidden="true" />
  ),
  Link2Filled: ({ className }: { className?: string }) => (
    <svg className={className} aria-hidden="true" />
  ),
  LinkFilled: ({ className }: { className?: string; style?: CSSProperties }) => (
    <svg className={className} aria-hidden="true" />
  ),
  PauseFilled: ({ className }: { className?: string }) => (
    <svg className={className} aria-hidden="true" />
  ),
  PlayFilled: ({ className }: { className?: string }) => (
    <svg className={className} aria-hidden="true" />
  ),
  RotateLeftFilled: ({ className }: { className?: string }) => (
    <svg className={className} aria-hidden="true" />
  ),
  TagFilled: ({ className }: { className?: string }) => (
    <svg className={className} aria-hidden="true" />
  ),
  TickCircleFilled: ({ className }: { className?: string }) => (
    <svg className={className} aria-hidden="true" />
  ),
  ToggleOffFilled: ({ className }: { className?: string }) => (
    <svg className={className} aria-hidden="true" />
  ),
  ToggleOnFilled: ({ className }: { className?: string }) => (
    <svg className={className} aria-hidden="true" />
  ),
  UserFilled: ({ className }: { className?: string }) => (
    <svg className={className} aria-hidden="true" />
  ),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

jest.mock("@/lib/ui/copy-to-clipboard", () => ({
  copyToClipboard: jest.fn(),
}));

jest.mock("@/lib/tasks/task-transforms", () => ({
  timeAgo: () => "1d ago",
}));

jest.mock("../type-badge", () => ({
  TypeBadge: ({ type }: { type: string }) => <span>{type}</span>,
}));

jest.mock("../priority-badge", () => ({
  PriorityBadge: ({ priority }: { priority: string }) => <span>{priority}</span>,
}));

const taskWithActions: Task = {
  id: "FEAT-001",
  title: "Create automated smoke test suite for critical marketplace user journeys",
  description: "",
  completed: false,
  status: "open",
  priority: "high",
  rawPriority: 1,
  type: "feature",
  owner: "",
  assignee: "",
  createdBy: "",
  createdAt: "2026-05-19T00:00:00Z",
  updatedAt: "2026-05-21T00:00:00Z",
  labels: [],
  dependencyCount: 0,
  dependentCount: 0,
  commentCount: 1,
  metadata: {},
  chainBinding: {
    chain_id: "smoke-test-suite-generator",
    chain_name: "smoke-test-suite-generator",
    auto_run: false,
  },
};

describe("TaskDetailHeader", () => {
  it("moves task actions onto their own wrapping row below xl widths", () => {
    render(
      <TaskDetailHeader
        task={taskWithActions}
        onBack={jest.fn()}
        onClose={jest.fn()}
        onReopen={jest.fn()}
        onRunChain={jest.fn()}
        onEdit={jest.fn()}
        isRunning={false}
      />
    );

    const editButton = screen.getByRole("button", { name: /edit/i });
    const actionRow = editButton.parentElement;

    expect(actionRow).toHaveClass("w-full");
    expect(actionRow).toHaveClass("flex-wrap");
    expect(actionRow).toHaveClass("pt-1");
    expect(actionRow).toHaveClass("xl:w-auto");
    expect(actionRow).toHaveClass("xl:pt-0");
    expect(screen.getByRole("link", { name: /decision/i }).parentElement).toBe(actionRow);
    expect(screen.getByRole("button", { name: /run/i }).parentElement).toBe(actionRow);
    expect(screen.getByRole("button", { name: /close/i }).parentElement).toBe(actionRow);
  });

  it("keeps the back-to-list control visible below the split-pane breakpoint", () => {
    render(
      <TaskDetailHeader
        task={taskWithActions}
        onBack={jest.fn()}
        onClose={jest.fn()}
        onReopen={jest.fn()}
        onRunChain={jest.fn()}
        onEdit={jest.fn()}
        isRunning={false}
      />
    );

    expect(screen.getByRole("button", { name: /back/i })).toHaveClass("lg:hidden");
  });

  it("does not show provenance-only child tasks as decision tasks", () => {
    render(
      <TaskDetailHeader
        task={{
          ...taskWithActions,
          id: "TASK-092",
          type: "task",
          metadata: {
            decision_id: "decision-1",
            decision_plan_task_id: "task-1",
          },
          chainBinding: undefined,
        }}
        onBack={jest.fn()}
        onClose={jest.fn()}
        onReopen={jest.fn()}
        onRunChain={jest.fn()}
        onEdit={jest.fn()}
        isRunning={false}
      />
    );

    expect(screen.queryByRole("link", { name: /decision/i })).not.toBeInTheDocument();
  });

  it("renders auto-run as a header switch and toggles future runs", async () => {
    const onToggleAutoRun = jest.fn().mockResolvedValue(undefined);
    render(
      <TaskDetailHeader
        task={taskWithActions}
        onBack={jest.fn()}
        onClose={jest.fn()}
        onReopen={jest.fn()}
        onRunChain={jest.fn()}
        onEdit={jest.fn()}
        onToggleAutoRun={onToggleAutoRun}
        isRunning={false}
      />
    );

    const switchButton = screen.getByRole("switch", { name: /auto-run/i });

    expect(switchButton).toHaveAttribute("aria-checked", "false");
    fireEvent.click(switchButton);
    await waitFor(() => expect(onToggleAutoRun).toHaveBeenCalledWith(true));
  });

  it("shows paused auto-run state and reset action in the header", async () => {
    const onResetAutoRunAttempts = jest.fn().mockResolvedValue(undefined);
    render(
      <TaskDetailHeader
        task={{
          ...taskWithActions,
          chainBinding: {
            ...taskWithActions.chainBinding!,
            auto_run: true,
            auto_run_retries: 3,
            last_run_status: "failed",
          },
        }}
        onBack={jest.fn()}
        onClose={jest.fn()}
        onReopen={jest.fn()}
        onRunChain={jest.fn()}
        onEdit={jest.fn()}
        onToggleAutoRun={jest.fn()}
        onResetAutoRunAttempts={onResetAutoRunAttempts}
        isRunning={false}
      />
    );

    expect(screen.getByRole("switch", { name: /auto-run/i })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/auto-run paused/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /reset attempts/i }));
    await waitFor(() => expect(onResetAutoRunAttempts).toHaveBeenCalledTimes(1));
  });

  it("shows a pause control when auto-run is enabled and pauses on click", async () => {
    const onToggleAutoRunPause = jest.fn().mockResolvedValue(undefined);
    render(
      <TaskDetailHeader
        task={{
          ...taskWithActions,
          chainBinding: { ...taskWithActions.chainBinding!, auto_run: true },
        }}
        onBack={jest.fn()}
        onClose={jest.fn()}
        onReopen={jest.fn()}
        onRunChain={jest.fn()}
        onEdit={jest.fn()}
        onToggleAutoRun={jest.fn()}
        onToggleAutoRunPause={onToggleAutoRunPause}
        isRunning={false}
      />
    );

    const pauseSwitch = screen.getByRole("switch", { name: /pause auto-run/i });
    expect(pauseSwitch).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByText(/paused by user/i)).not.toBeInTheDocument();

    fireEvent.click(pauseSwitch);
    await waitFor(() => expect(onToggleAutoRunPause).toHaveBeenCalledWith(true));
  });

  it("shows the resume control and reason badge when auto_run_paused is set, and clears on click", async () => {
    const onToggleAutoRunPause = jest.fn().mockResolvedValue(undefined);
    render(
      <TaskDetailHeader
        task={{
          ...taskWithActions,
          chainBinding: {
            ...taskWithActions.chainBinding!,
            auto_run: true,
            auto_run_paused: true,
            auto_run_paused_reason: "Paused by user",
          },
        }}
        onBack={jest.fn()}
        onClose={jest.fn()}
        onReopen={jest.fn()}
        onRunChain={jest.fn()}
        onEdit={jest.fn()}
        onToggleAutoRun={jest.fn()}
        onToggleAutoRunPause={onToggleAutoRunPause}
        isRunning={false}
      />
    );

    const pauseSwitch = screen.getByRole("switch", { name: /pause auto-run/i });
    expect(pauseSwitch).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("resume")).toBeInTheDocument();
    expect(screen.getByText("Paused by user")).toBeInTheDocument();

    fireEvent.click(pauseSwitch);
    await waitFor(() => expect(onToggleAutoRunPause).toHaveBeenCalledWith(false));
  });

  it("treats a legacy reason-only pause as paused (pre-boolean-writer migration)", () => {
    render(
      <TaskDetailHeader
        task={{
          ...taskWithActions,
          chainBinding: {
            ...taskWithActions.chainBinding!,
            auto_run: true,
            auto_run_paused: undefined,
            auto_run_paused_reason: "waiting on design review",
          },
        }}
        onBack={jest.fn()}
        onClose={jest.fn()}
        onReopen={jest.fn()}
        onRunChain={jest.fn()}
        onEdit={jest.fn()}
        onToggleAutoRun={jest.fn()}
        onToggleAutoRunPause={jest.fn()}
        isRunning={false}
      />
    );

    expect(screen.getByRole("switch", { name: /pause auto-run/i })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("waiting on design review")).toBeInTheDocument();
  });

  it("does not show the pause control when auto-run is disabled for the task", () => {
    render(
      <TaskDetailHeader
        task={{
          ...taskWithActions,
          chainBinding: { ...taskWithActions.chainBinding!, auto_run: false },
        }}
        onBack={jest.fn()}
        onClose={jest.fn()}
        onReopen={jest.fn()}
        onRunChain={jest.fn()}
        onEdit={jest.fn()}
        onToggleAutoRun={jest.fn()}
        onToggleAutoRunPause={jest.fn()}
        isRunning={false}
      />
    );

    expect(screen.queryByRole("switch", { name: /pause auto-run/i })).not.toBeInTheDocument();
  });

  it("does not offer an active auto-run switch on a closed task", () => {
    render(
      <TaskDetailHeader
        task={{
          ...taskWithActions,
          completed: true,
          status: "closed",
          chainBinding: {
            ...taskWithActions.chainBinding!,
            auto_run: true,
          },
        }}
        onBack={jest.fn()}
        onClose={jest.fn()}
        onReopen={jest.fn()}
        onRunChain={jest.fn()}
        onEdit={jest.fn()}
        onToggleAutoRun={jest.fn()}
        isRunning={false}
      />
    );

    expect(screen.queryByRole("switch", { name: /auto-run/i })).not.toBeInTheDocument();
    expect(screen.getByText(/auto-run on/i)).toBeInTheDocument();
  });
});
