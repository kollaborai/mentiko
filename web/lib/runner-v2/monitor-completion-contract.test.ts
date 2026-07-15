import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findMonitorCompletionEvent,
  monitorCompletionExpectedEvent,
  resolveMonitorCompletionAgent,
} from "@/lib/runner-v2/monitor-completion-contract";
import { runMonitorCompletionCli } from "@/lib/runner-v2/monitor-completion-cli";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "mentiko-monitor-completion-"));
  const agentsDir = join(root, "agents");
  const configProfilesDir = join(root, "config-profiles");
  const eventsDir = join(root, "events");
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(configProfilesDir, { recursive: true });
  mkdirSync(eventsDir, { recursive: true });
  const chainPath = join(root, "chain.json");
  writeFileSync(chainPath, JSON.stringify({
    config: { session_prefix: "project" },
    agents: [
      { id: "writer", emits: "written" },
      { id: "reviewer", session_prefix: "review", emits: "reviewed" },
    ],
  }));
  return { agentsDir, chainPath, configProfilesDir, eventsDir };
}

describe("monitor completion contract", () => {
  it("resolves session identity and declared completion data without shell ownership", () => {
    const fixturePaths = fixture();
    const input = { ...fixturePaths, sessionName: "project-writer-run-1" };

    expect(resolveMonitorCompletionAgent(input)).toBe("writer");
    expect(monitorCompletionExpectedEvent(input)).toBe("written");
    expect(() => resolveMonitorCompletionAgent({ ...input, configuredAgentId: "missing" })).toThrow("not unique");
    expect(monitorCompletionExpectedEvent({ ...input, chainPath: join(fixturePaths.agentsDir, "missing.json") })).toBe("");
  });

  it("finds only the typed run-scoped event owned by the resolved agent", () => {
    const fixturePaths = fixture();
    writeFileSync(join(fixturePaths.eventsDir, "run-1-writer-written.event"), [
      "event: written",
      "source: project-writer-run-1",
      "run_id: run-1",
      "timestamp: 2026-07-15T00:00:00Z",
      "processed: false",
      "data: done",
      "",
    ].join("\n"));
    writeFileSync(join(fixturePaths.eventsDir, "run-1-reviewer-reviewed.event"), [
      "event: reviewed",
      "source: project-reviewer-run-1",
      "run_id: run-1",
      "timestamp: 2026-07-15T00:00:00Z",
      "processed: false",
      "data: done",
      "",
    ].join("\n"));
    const input = { ...fixturePaths, sessionName: "project-writer-run-1", runId: "run-1" };

    expect(findMonitorCompletionEvent(input)).toBe(join(fixturePaths.eventsDir, "run-1-writer-written.event"));
  });

  it("exposes only primitive monitor results through the CLI", () => {
    const fixturePaths = fixture();
    const lines: string[] = [];
    const status = runMonitorCompletionCli([
      "agent-id",
      "--chain-path", fixturePaths.chainPath,
      "--agents-dir", fixturePaths.agentsDir,
      "--config-profiles-dir", fixturePaths.configProfilesDir,
      "--session-name", "project-writer-run-1",
    ], (line) => lines.push(line));

    expect(status).toBe(0);
    expect(lines).toEqual(["writer"]);
  });
});
