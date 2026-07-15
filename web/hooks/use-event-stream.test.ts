import { streamEventMatchesRun } from "@/hooks/use-event-stream";

describe("event stream run ownership", () => {
  it("accepts only the open run's event payload", () => {
    expect(streamEventMatchesRun({ data: { runId: "run-123" } }, "run-123")).toBe(true);
    expect(streamEventMatchesRun({ data: { runId: "run-999" } }, "run-123")).toBe(false);
    expect(streamEventMatchesRun({ data: {} }, "run-123")).toBe(false);
  });
});
