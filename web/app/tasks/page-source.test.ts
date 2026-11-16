import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("tasks page source contract", () => {
  const source = readFileSync(join(process.cwd(), "app/tasks/page.tsx"), "utf8");

  it("keeps list/detail as a single-pane workflow until the large breakpoint", () => {
    expect(source).toContain('mobileView === "detail" ? "hidden lg:flex" : "flex"');
    expect(source).toContain('mobileView === "list" ? "hidden lg:flex" : "flex"');
    expect(source).toContain("} lg:flex`}");
    expect(source).not.toContain("hidden md:flex");
    expect(source).not.toContain("} md:flex`}");
  });

  it("clears stale selected task state when a selected detail fetch 404s", () => {
    expect(source).toContain("if (detailRes && detailRes.status === 404)");
    expect(source).toContain("setSelected((prev) => (prev?.id === task.id ? null : prev))");
  });

  it("refreshes the task tree after decision updates and deletes", () => {
    expect(source).toContain("const [treeRefreshSignal, setTreeRefreshSignal] = useState(0)");
    expect(source).toContain("setTreeRefreshSignal((value) => value + 1)");
    expect(source).toContain("refreshSignal={treeRefreshSignal}");
  });

  it("pauses auto-run by writing both auto_run_paused and a reason", () => {
    expect(source).toContain(
      "? { auto_run_paused: true, auto_run_paused_reason: \"Paused by user\" }"
    );
  });

  it("resumes auto-run by clearing both auto_run_paused and its reason (migration: reason-only paused tasks must resume)", () => {
    expect(source).toContain(
      ": { auto_run_paused: false, auto_run_paused_reason: null }"
    );
  });

  it("wires the pause/resume handler into every TaskDetail render site", () => {
    const occurrences = source.split("onToggleAutoRunPause={handleToggleAutoRunPause}").length - 1;
    expect(occurrences).toBe(3);
  });

  it("clears resume_last_error at every retry reset (nulls so the server merge cannot keep the stale error, #142)", () => {
    // every server PATCH that resets auto_run_retries must also null the
    // resume error; undefined would be dropped by JSON.stringify and the
    // metadata merge would preserve the stale value.
    const resets = source.split("auto_run_retries: 0").length - 1;
    const cleared = source.split("resume_last_error: null").length - 1;
    expect(resets).toBeGreaterThanOrEqual(4);
    expect(cleared).toBeGreaterThanOrEqual(3); // assign-chain, toggle fallback, retry-task reset
  });

  it("retires the stamped resume attempt id at every retry reset (#142 round 4: an in-flight response cannot charge the fresh series)", () => {
    // every server PATCH that resets the budget must also null the stamped
    // attempt identity, or a late failure response from before the reset
    // still matches the (unchanged) run id and charges the new series.
    const cleared = source.split("resume_attempt_id: null").length - 1;
    expect(cleared).toBeGreaterThanOrEqual(3); // assign-chain, toggle fallback, retry-task reset
  });

  it("clears the displayed exhausted state optimistically at every retry reset (#142 review P2)", () => {
    // the detail header reads task.autoRun and task.metadata, not
    // chainBinding: after Retry task / assign / toggle-enable the page must
    // clear those too, or the stale "Auto paused 3/3" banner and stale resume
    // reason stay on screen until a detail refresh.
    expect(source).toContain("const applyRetryResetToTask = useCallback");
    const uses = source.split("applyRetryResetToTask(selected.id)").length - 1;
    expect(uses).toBeGreaterThanOrEqual(3); // assign-chain, toggle-enable, retry-task reset
    expect(source).toContain("retriesExhausted: false");
    expect(source).toContain("resume_last_error: undefined");
  });

  it("checks response.ok before every optimistic retry reset and throws on failure (#142 round 5 P2)", () => {
    // A rejected PATCH must keep the previous visible state (the stored 3/3
    // budget and errors are still on the record) and surface the failure the
    // way the page's other actions do: throw, letting the detail header's
    // existing autoRunError surface show it. No new UI.
    const okChecks = [
      "`Failed to assign chain (${res.status})`",
      "`Failed to update auto-run (${fallback.status})`",
      "`Failed to reset auto-run attempts (${res.status})`",
    ];
    for (const check of okChecks) {
      expect(source).toContain(check);
    }
    // each guard throws the parsed server error, not a bare string
    const throws = source.split("throw new Error(msg);").length - 1;
    expect(throws).toBeGreaterThanOrEqual(3);
  });
});
