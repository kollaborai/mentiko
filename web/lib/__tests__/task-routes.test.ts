import { normalizeTaskNavigationRoute, taskDetailHref } from "../tasks/task-routes";

describe("task routes", () => {
  it("builds the split-pane task detail href", () => {
    expect(taskDetailHref("EPIC-001")).toBe("/tasks?task=EPIC-001");
  });

  it("preserves existing query params when building task detail href", () => {
    expect(taskDetailHref("TASK-007", "workspace=/tmp/kollab&view=tree")).toBe(
      "/tasks?workspace=%2Ftmp%2Fkollab&view=tree&task=TASK-007",
    );
  });

  it("normalizes direct task routes to the sidebar task view", () => {
    expect(normalizeTaskNavigationRoute("/tasks/EPIC-001")).toBe("/tasks?task=EPIC-001");
    expect(normalizeTaskNavigationRoute("http://localhost:3000/tasks/EPIC-001")).toBe(
      "/tasks?task=EPIC-001",
    );
  });

  it("leaves non-task routes alone", () => {
    expect(normalizeTaskNavigationRoute("/runs/RUN-001")).toBe("/runs/RUN-001");
  });
});
