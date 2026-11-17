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

  it("increments resume_series at every retry reset and clears errors with nulls, not undefined (#142)", () => {
    // every client reset that zeroes auto_run_retries must also start a new
    // resume series and null the stale errors; undefined would be dropped by
    // JSON.stringify and the server merge would keep the old values alive.
    const resets = source.split("auto_run_retries: 0").length - 1;
    const seriesIncrements = source.split("resume_series: (Number(selected.metadata?.resume_series) || 0) + 1").length - 1;
    const resumeErrorNulls = source.split("resume_last_error: null").length - 1;
    expect(resets).toBeGreaterThanOrEqual(3);
    expect(seriesIncrements).toBeGreaterThanOrEqual(3); // assign-chain, toggle fallback, retry-task reset
    expect(resumeErrorNulls).toBeGreaterThanOrEqual(3);
  });

  it("checks the PATCH response before optimistically resetting task state (#142)", () => {
    const okChecks = source.split("!res.ok").length - 1;
    const patchOkChecks = source.split("!patchRes.ok").length - 1;
    expect(okChecks).toBeGreaterThanOrEqual(3); // assign-chain, retry-task, run-chain and friends
    expect(patchOkChecks).toBeGreaterThanOrEqual(1); // auto-run toggle fallback PATCH
  });
});
