import { render, screen } from "@testing-library/react";
import { TaskDetailHeader } from "./task-detail-header";
import type { Task } from "@/lib/tasks/task-types";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...rest}>{children}</button>
  ),
}));

jest.mock("@/components/ui/detail-header", () => ({
  SplitDetailHeader: ({ identity, actions }: { identity: React.ReactNode; actions: React.ReactNode }) => (
    <div>
      <div>{identity}</div>
      <div>{actions}</div>
    </div>
  ),
}));

jest.mock("@/components/ui/back-button", () => ({
  BackButton: () => <button>back</button>,
}));

jest.mock("@aliimam/icons", () => new Proxy({}, {
  get: (_target, name: string) => {
    const Stub = (props: React.SVGProps<SVGSVGElement>) => <svg data-icon={name} {...props} />;
    Stub.displayName = name;
    return Stub;
  },
}));

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "TASK-1",
    title: "Resume loop guard",
    description: "",
    completed: false,
    status: "open",
    priority: "medium",
    rawPriority: 2,
    type: "task",
    owner: "",
    assignee: "",
    createdBy: "",
    createdAt: "2026-11-15T00:00:00Z",
    updatedAt: "2026-11-15T00:00:00Z",
    labels: [],
    dependencyCount: 0,
    dependentCount: 0,
    commentCount: 0,
    chainBinding: {
      chain_id: "release-review",
      auto_run: true,
      auto_run_retries: 3,
    },
    ...overrides,
  };
}

function renderHeader(task: Task) {
  return render(
    <TaskDetailHeader
      task={task}
      onBack={jest.fn()}
      onClose={jest.fn()}
      onReopen={jest.fn()}
      onRunChain={jest.fn()}
      onEdit={jest.fn()}
      onResetAutoRunAttempts={jest.fn()}
      isRunning={false}
    />
  );
}

describe("TaskDetailHeader auto-run failure banner", () => {
  it("shows the recorded resume error as the failure reason at the retry ceiling", () => {
    renderHeader(makeTask({
      metadata: {
        resume_last_error: "Run run-loop not found",
        last_run_error: "older last-run error",
      },
    }));

    const banner = screen.getByTestId("auto-run-failure-banner");
    expect(banner).toHaveTextContent("Run run-loop not found");
    // the current resume error supersedes the older recorded errors
    expect(banner).not.toHaveTextContent("older last-run error");
    expect(banner).toHaveTextContent("Auto-recovery stopped after 3/3 failed attempts");
  });

  it("keeps the existing last-run error display when no resume error was recorded", () => {
    renderHeader(makeTask({
      chainBinding: {
        chain_id: "release-review",
        auto_run: true,
        auto_run_retries: 3,
        last_run_error: "chain runner exited nonzero",
      },
      metadata: {},
    }));

    const banner = screen.getByTestId("auto-run-failure-banner");
    expect(banner).toHaveTextContent("chain runner exited nonzero");
  });

  it("a cleared resume error (reset via Retry task) no longer masks a newer run error", () => {
    // After the retry reset nulls resume_last_error, the next failure --
    // even one recorded before any execution starts -- is the shown reason,
    // not the stale resume error from the previous loop (#142 review P2).
    renderHeader(makeTask({
      chainBinding: {
        chain_id: "release-review",
        auto_run: true,
        auto_run_retries: 1,
        last_run_error: "newer failure after reset",
      },
      metadata: {
        resume_last_error: null,
      },
    }));

    const banner = screen.getByTestId("auto-run-failure-banner");
    expect(banner).toHaveTextContent("newer failure after reset");
  });
});
