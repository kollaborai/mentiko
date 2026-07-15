import { fireEvent, render, screen } from "@testing-library/react";
import { TaskWelcome } from "@/components/task/task-welcome";

describe("TaskWelcome", () => {
  it("explains the flow and exposes both starts", () => {
    const onCreateTask = jest.fn();
    const onGenerateTasks = jest.fn();
    const onReviewCodebase = jest.fn();
    render(
      <TaskWelcome
        onCreateTask={onCreateTask}
        onGenerateTasks={onGenerateTasks}
        onReviewCodebase={onReviewCodebase}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Turn direction into execution" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Dependencies decide what is blocked and what is ready next.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/decision pauses at the human choice/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Available task types")).toHaveTextContent(
      "Decision",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Create your first task" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Generate a plan with AI" }),
    );
    expect(onCreateTask).toHaveBeenCalledTimes(1);
    expect(onGenerateTasks).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole("button", { name: /review this codebase/i }),
    );
    expect(onReviewCodebase).toHaveBeenCalledTimes(1);
  });
  it("keeps both starts in the compact state", () => {
    render(
      <TaskWelcome
        compact
        onCreateTask={jest.fn()}
        onGenerateTasks={jest.fn()}
        onReviewCodebase={jest.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Create task" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Generate with AI" }),
    ).toBeInTheDocument();
  });
});
