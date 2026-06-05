import { buildTaskListQuery } from "@/lib/tasks/task-filter-query";

describe("buildTaskListQuery", () => {
  it("sends selected type and all status to the tasks api", () => {
    const params = buildTaskListQuery({
      status: "all",
      type: "feature",
    });

    expect(params.toString()).toBe("status=all&type=feature");
  });

  it("maps ready to all because readiness is computed client-side", () => {
    const params = buildTaskListQuery({
      status: "ready",
      type: "task",
      query: "  chain  ",
      workspacePath: "/Users/malmazan/dev/platform/mentiko",
    });

    expect(params.get("status")).toBe("all");
    expect(params.get("type")).toBe("task");
    expect(params.get("q")).toBe("chain");
    expect(params.get("workspace")).toBe("/Users/malmazan/dev/platform/mentiko");
  });
});
