import { render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, CSSProperties, ReactNode } from "react";
import { TaskDetailHeader } from "../task-detail-header";
import type { Task } from "@/lib/task-types";

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

jest.mock("@/lib/copy-to-clipboard", () => ({
  copyToClipboard: jest.fn(),
}));

jest.mock("@/lib/task-transforms", () => ({
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
});
