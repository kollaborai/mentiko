/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { TaskTreeView } from "../task-tree-view";

const mockFetchWithNamespace = jest.fn();

jest.mock("@/lib/ui-context/workspace-context", () => ({
  useWorkspace: () => ({
    workspacePath: "/repo",
  }),
}));

jest.mock("@/lib/hooks/use-namespace-fetch", () => ({
  useNamespaceFetch: () => ({
    fetchWithNamespace: mockFetchWithNamespace,
  }),
}));

jest.mock("@aliimam/icons", () => ({
  ArrowDown1Filled: ({ className }: { className?: string }) => (
    <svg data-testid="arrow-down-1" className={className} />
  ),
  ArrowRight1Filled: ({ className }: { className?: string }) => (
    <svg data-testid="arrow-right-1" className={className} />
  ),
  ArrowDownFilled: ({ className }: { className?: string }) => (
    <svg data-testid="arrow-down" className={className} />
  ),
  ArrowUpFilled: ({ className }: { className?: string }) => (
    <svg data-testid="arrow-up" className={className} />
  ),
  AddCircleFilled: ({ className }: { className?: string }) => (
    <svg data-testid="add-circle" className={className} />
  ),
  DangerFilled: ({ className }: { className?: string }) => (
    <svg data-testid="danger" className={className} />
  ),
  MinusFilled: ({ className }: { className?: string }) => (
    <svg data-testid="minus" className={className} />
  ),
  JudgeFilled: ({ className }: { className?: string }) => (
    <svg data-testid="judge" className={className} />
  ),
}));

describe("TaskTreeView", () => {
  beforeEach(() => {
    mockFetchWithNamespace.mockReset();
    mockFetchWithNamespace.mockResolvedValue({
      json: async () => ({
        data: {
          nodes: [
            {
              id: "EPIC-009",
              label: "Launch epic",
              type: "epic",
              status: "open",
              priority: 1,
              layer: 0,
            },
            {
              id: "TASK-092",
              label: "Initialize Next.js 16 project with design system foundation",
              type: "task",
              status: "open",
              priority: 0,
              layer: 0,
            },
          ],
          links: [{ source: "EPIC-009", target: "TASK-092" }],
          deps: [],
        },
      }),
    });
  });

  it("selects a child task from a real button row", async () => {
    const onSelectTask = jest.fn();
    render(<TaskTreeView selectedId={null} onSelectTask={onSelectTask} />);

    const taskRow = await screen.findByRole("button", {
      name: /Initialize Next\.js 16 project/i,
    });

    expect(taskRow.tagName).toBe("BUTTON");
    fireEvent.click(taskRow);

    expect(onSelectTask).toHaveBeenCalledWith("TASK-092");
  });

  it("reloads graph data when the refresh signal changes", async () => {
    const { rerender } = render(<TaskTreeView selectedId={null} refreshSignal={0} />);

    await screen.findByRole("button", {
      name: /Initialize Next\.js 16 project/i,
    });
    expect(mockFetchWithNamespace).toHaveBeenCalledTimes(1);

    rerender(<TaskTreeView selectedId={null} refreshSignal={1} />);

    await screen.findByRole("button", {
      name: /Initialize Next\.js 16 project/i,
    });
    expect(mockFetchWithNamespace).toHaveBeenCalledTimes(2);
  });
});
