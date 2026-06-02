import { taskOverviewPriorityMatches } from "../task-overview";

describe("taskOverviewPriorityMatches", () => {
  it("matches the visible priority range labels", () => {
    expect(taskOverviewPriorityMatches(0, "p0")).toBe(true);
    expect(taskOverviewPriorityMatches(1, "p0")).toBe(false);

    expect(taskOverviewPriorityMatches(0, "p0-p1")).toBe(true);
    expect(taskOverviewPriorityMatches(1, "p0-p1")).toBe(true);
    expect(taskOverviewPriorityMatches(2, "p0-p1")).toBe(false);

    expect(taskOverviewPriorityMatches(1, "p2-plus")).toBe(false);
    expect(taskOverviewPriorityMatches(2, "p2-plus")).toBe(true);
    expect(taskOverviewPriorityMatches(4, "p2-plus")).toBe(true);
  });
});
