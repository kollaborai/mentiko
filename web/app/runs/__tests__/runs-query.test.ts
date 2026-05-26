import { buildRunsListQuery } from "../runs-query";

describe("runs page list query", () => {
  test("does not treat runId as a sidebar list filter", () => {
    const query = buildRunsListQuery({
      workspacePath: "/repo",
      taskFilter: null,
      runIdFilter: "run-1779817087545",
    });

    expect(query.toString()).toBe("limit=100&workspace=%2Frepo");
    expect(query.has("runId")).toBe(false);
  });

  test("keeps real list filters", () => {
    const query = buildRunsListQuery({
      workspacePath: "/repo",
      taskFilter: "TASK-123",
      runIdFilter: null,
    });

    expect(query.toString()).toBe("limit=100&workspace=%2Frepo&task=TASK-123");
  });
});
