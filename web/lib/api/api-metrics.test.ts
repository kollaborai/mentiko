import { extractRoute } from "./api-metrics";

describe("extractRoute", () => {
  it.each([
    ["http://localhost:3200/api/tasks/auto-run?workspace=/repo", "/api/tasks/auto-run"],
    ["http://localhost:3200/api/tasks/generate", "/api/tasks/generate"],
    ["http://localhost:3200/api/tasks/TASK-093", "/api/tasks/[id]"],
    ["http://localhost:3200/api/tasks/task-default-mpn51vyj-khcf", "/api/tasks/[id]"],
    ["http://localhost:3200/api/tasks/TASK-093/deps", "/api/tasks/[id]/deps"],
  ])("normalizes %s as %s", (url, expected) => {
    expect(extractRoute(url)).toBe(expected);
  });

  it("keeps UUID normalization for non-task routes", () => {
    expect(extractRoute("http://localhost:3200/api/chains/123e4567-e89b-12d3-a456-426614174000"))
      .toBe("/api/chains/[id]");
  });
});
