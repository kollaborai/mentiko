/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TaskGenerateDialog, unwrapGeneratedTaskResult } from "../task-generate-dialog";

const mockFetchWithNamespace = jest.fn();
const mockPush = jest.fn();

jest.mock("@/lib/hooks/use-namespace-fetch", () => ({
  useNamespaceFetch: () => ({
    fetchWithNamespace: mockFetchWithNamespace,
  }),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

describe("TaskGenerateDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("unwraps the generation job output envelope into a task preview", () => {
    expect(unwrapGeneratedTaskResult({
      output: JSON.stringify({
        route: "task",
        task: { title: "Write the proof", type: "task", priority: 2 },
      }),
    })).toEqual({
      task: { title: "Write the proof", type: "task", priority: 2 },
    });
  });

  it("preserves the explicit decision-routing toggle value", async () => {
    mockFetchWithNamespace.mockResolvedValue({
      ok: true,
      json: async () => ({
        routedTo: "decision",
        decisionId: "decision-disabled-toggle",
      }),
    });

    render(
      <TaskGenerateDialog
        open
        onClose={jest.fn()}
        onCreate={jest.fn()}
        workspacePath="/repo"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /decision if warranted/i }));
    fireEvent.change(screen.getByPlaceholderText(/describe what needs/i), {
      target: { value: "create a concrete task" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate task/i }));

    await waitFor(() => {
      expect(mockFetchWithNamespace).toHaveBeenCalledWith(
        "/api/tasks/generate",
        expect.objectContaining({
          body: expect.stringContaining('"sendToDecisionIfWarranted":false'),
        }),
      );
    });
  });

  it("prefills a starter prompt without submitting it", () => {
    const initialPrompt = "Review this workspace and generate concrete repair tasks.";
    render(
      <TaskGenerateDialog
        open
        initialPrompt={initialPrompt}
        onClose={jest.fn()}
        onCreate={jest.fn()}
      />,
    );

    expect(screen.getByPlaceholderText(/describe what needs/i)).toHaveValue(initialPrompt);
    expect(mockFetchWithNamespace).not.toHaveBeenCalled();
  });

  it("clears a starter prompt when a later open has no starter", () => {
    const props = { onClose: jest.fn(), onCreate: jest.fn() };
    const { rerender } = render(
      <TaskGenerateDialog open initialPrompt="Review this workspace." {...props} />,
    );

    expect(screen.getByPlaceholderText(/describe what needs/i)).toHaveValue("Review this workspace.");
    rerender(<TaskGenerateDialog open={false} initialPrompt="Review this workspace." {...props} />);
    rerender(<TaskGenerateDialog open initialPrompt="" {...props} />);

    expect(screen.getByPlaceholderText(/describe what needs/i)).toHaveValue("");
  });

  it("sends decision routing by default and opens the created decision", async () => {
    mockFetchWithNamespace.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          routedTo: "decision",
          decisionId: "decision-1",
          taskId: "DEC-001",
        },
      }),
    });

    render(
      <TaskGenerateDialog
        open
        onClose={jest.fn()}
        onCreate={jest.fn()}
        onRefresh={jest.fn()}
        workspacePath="/repo"
      />,
    );

    expect(screen.getByRole("button", { name: /decision if warranted/i })).toHaveAttribute("aria-pressed", "true");

    fireEvent.change(screen.getByPlaceholderText(/describe what needs/i), {
      target: { value: "create a better git integration in the UI" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate task/i }));

    await waitFor(() => {
      expect(mockFetchWithNamespace).toHaveBeenCalledWith(
        "/api/tasks/generate",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"sendToDecisionIfWarranted":true'),
        }),
      );
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/tasks?type=decision&task=DEC-001");
    });
  });

  it("can explicitly generate a decision task from the modal flag", async () => {
    mockFetchWithNamespace.mockResolvedValue({
      ok: true,
      json: async () => ({
        routedTo: "decision",
        decisionId: "decision-2",
        taskId: "DEC-002",
      }),
    });

    render(
      <TaskGenerateDialog
        open
        onClose={jest.fn()}
        onCreate={jest.fn()}
        onRefresh={jest.fn()}
        workspacePath="/repo"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Decision" }));
    fireEvent.change(screen.getByPlaceholderText(/describe what needs/i), {
      target: { value: "decide whether this epic is ready to ship" },
    });
    expect(screen.queryAllByRole("button", { name: /generate/i })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /generate decision/i }));

    await waitFor(() => {
      expect(mockFetchWithNamespace).toHaveBeenCalledWith(
        "/api/tasks/generate",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"mode":"decision"'),
        }),
      );
    });
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/tasks?type=decision&task=DEC-002");
    });
  });

  it("can create a manual task without calling the generation API", async () => {
    const onCreate = jest.fn().mockResolvedValue("TSK-001");

    render(
      <TaskGenerateDialog
        open
        initialMode="manual"
        onClose={jest.fn()}
        onCreate={onCreate}
        onRefresh={jest.fn()}
        workspacePath="/repo"
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/describe what needs/i), {
      target: { value: "write docs\ncover task decision routing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "chore" }));
    fireEvent.click(screen.getByRole("button", { name: /create task/i }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith({
        title: "write docs",
        description: "cover task decision routing",
        type: "chore",
        priority: 2,
        parent: undefined,
      });
    });
    expect(mockFetchWithNamespace).not.toHaveBeenCalled();
  });

  it("selects a parent epic from the in-panel picker", async () => {
    const onCreate = jest.fn().mockResolvedValue("TSK-002");
    const parentEpics = Array.from({ length: 20 }, (_, index) => ({
      id: `EPIC-${String(index + 1).padStart(3, "0")}`,
      title: `Epic ${index + 1}`,
    }));

    render(
      <TaskGenerateDialog
        open
        initialMode="manual"
        onClose={jest.fn()}
        onCreate={onCreate}
        onRefresh={jest.fn()}
        parentEpics={parentEpics}
        workspacePath="/repo"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /parent: no parent epic/i }));
    fireEvent.change(screen.getByPlaceholderText("Search epics"), {
      target: { value: "Epic 20" },
    });
    fireEvent.click(screen.getByRole("button", { name: /EPIC-020 Epic 20/i }));
    fireEvent.change(screen.getByPlaceholderText(/describe what needs/i), {
      target: { value: "add release checklist" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create task/i }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
        parent: "EPIC-020",
      }));
    });
  });

  it("can render as an inline task view panel instead of a modal overlay", () => {
    const { container } = render(
      <TaskGenerateDialog
        open
        presentation="panel"
        onClose={jest.fn()}
        onCreate={jest.fn()}
        onRefresh={jest.fn()}
        workspacePath="/repo"
      />,
    );

    const shell = container.firstElementChild;
    const content = shell?.firstElementChild;
    expect(shell).toHaveClass("h-full");
    expect(shell).toHaveClass("w-full");
    expect(shell).not.toHaveClass("fixed");
    expect(content).toHaveClass("h-full");
    expect(content).toHaveClass("w-full");
    expect(content).not.toHaveClass("max-w-2xl");
    expect(screen.getByRole("button", { name: /generate task/i })).toBeInTheDocument();
  });
});
