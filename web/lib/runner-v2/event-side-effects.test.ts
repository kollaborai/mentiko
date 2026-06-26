import { planCompletionEventSideEffects } from "@/lib/runner-v2/event-side-effects";
import { parseRunnerEvent } from "@/lib/runner-v2/events";

describe("runner-v2 completion event side effects", () => {
  it("marks the triggered event processed and archives only same-run owned events", () => {
    const triggered = parseRunnerEvent("event: done\nsource: writer\nrun_id: run-1\nprocessed: false\n");
    const sibling = parseRunnerEvent("event: done\nsource: reviewer\nrun_id: run-1\nprocessed: false\n");
    const otherRun = parseRunnerEvent("event: done\nsource: writer\nrun_id: run-2\nprocessed: false\n");
    const owned = parseRunnerEvent("event: note\nsource: writer-helper\nrun_id: run-1\nprocessed: false\n");

    expect(planCompletionEventSideEffects(triggered, [triggered, sibling, otherRun, owned])).toEqual({
      markProcessed: triggered,
      archiveOwned: [triggered, owned],
    });
  });
});
