import { readFileSync } from "fs";

describe("run detail terminal interactivity source contract", () => {
  const source = readFileSync(
    new URL("../run-detail-panel.tsx", import.meta.url),
    "utf8",
  );

  it("does not hardcode agent terminals to read-only", () => {
    expect(source).toContain("terminalInputEnabled");
    expect(source).toContain("setTerminalInputEnabled");
    expect(source).toContain("readOnly={!terminalInputEnabled}");
    expect(source).not.toContain("readOnly={true}");
  });

  it("offers terminal input only for active or recoverable agent sessions", () => {
    expect(source).toContain("canInteractWithAgentTerminal");
    expect(source).toContain("startup_recovery");
    expect(source).toContain("blocked");
    expect(source).toContain("running");
  });

  it("supports embedding the canonical run detail surface inside another workflow", () => {
    expect(source).toContain("embedded?: boolean");
    expect(source).toContain(
      "RunDetailPanel({ runId, onBack, onDelete, embedded",
    );
    expect(source).toContain("const panelClassName = embedded");
    expect(source).toContain('"flex min-h-[720px]');
  });

  it("stacks embedded run headers so narrow task panes do not overflow", () => {
    expect(source).toContain("runHeaderActionsClassName");
    expect(source).toContain("flex-col items-stretch");
    expect(source).toContain("flex-wrap items-center");
    expect(source).toContain("runHeaderControlsClassName");
  });

  it("wraps embedded agent rows so status chips do not overflow mobile task panes", () => {
    expect(source).toContain("agentHeaderClassName");
    expect(source).toContain("agentStatusClassName");
    expect(source).toContain("max-w-[160px]");
  });

  it("stacks embedded metrics and cost cards in narrow task panes", () => {
    expect(source).toContain("metricsSummaryGridClassName");
    expect(source).toContain("costSummaryGridClassName");
    expect(source).toContain("grid-cols-1");
  });

  it("keeps the embedded output tab from side-scrolling narrow task panes", () => {
    expect(source).toContain("outputShellClassName");
    expect(source).toContain("outputAgentListClassName");
    expect(source).toContain("outputHeaderClassName");
  });

  it("lets embedded timeline and sparkline panels shrink inside mobile widths", () => {
    expect(source).toContain("metricsTimelineRowClassName");
    expect(source).toContain("max-w-full overflow-visible");
  });

  it("uses the run artifact preview endpoint from the run detail surface", () => {
    expect(source).toContain("/api/runs/${runId}/artifacts?path=");
    expect(source).toContain("Artifact Review");
    expect(source).toContain("selectedArtifact");
  });

  it("does not assume every run artifact has a readable path", () => {
    expect(source).toContain("path?: string");
    expect(source).toContain("function artifactPathValue");
    expect(source).toContain("unknown artifact");
    expect(source).toContain("disabled={!artifactPath}");
  });

  it("renders long agent session identifiers on their own readable row", () => {
    expect(source).toContain("session-row");
    expect(source).toContain("showLabel={false}");
    expect(source).toContain("break-all font-mono");
  });

  it("resets volatile run detail state when switching embedded runs", () => {
    expect(source).toContain("setRun(null)");
    expect(source).toContain("setSelectedArtifact(null)");
    expect(source).toContain("metricsRef.current = {}");
  });

  it("keeps output auto-scroll scoped to the output pane, not the page", () => {
    expect(source).toContain("scrollOutputToBottom");
    expect(source).toContain("outputScrollRef.current");
    expect(source).not.toContain("outputBottomRef.current.scrollIntoView");
  });
});
