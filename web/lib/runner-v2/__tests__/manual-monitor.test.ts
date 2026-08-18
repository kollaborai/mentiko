import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildManualAdvisorPrompt,
  fallbackNudge,
  manualMonitorPaths,
  parseManualMonitorArgs,
  runManualMonitor,
  sanitizeNudge,
} from "@/lib/runner-v2/manual-monitor";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "mentiko-manual-monitor-"));
}

describe("manual typed monitor", () => {
  it("preserves the positional manual CLI contract and rejects unsafe state paths", () => {
    expect(parseManualMonitorArgs(["agent-42", "build passes"])).toEqual({
      sessionName: "agent-42",
      endState: "build passes",
      profileName: "mentiko",
      intervalSeconds: 60,
    });
    expect(parseManualMonitorArgs(["agent-42", "build passes", "review", "15"])).toMatchObject({
      profileName: "review",
      intervalSeconds: 15,
    });
    expect(() => parseManualMonitorArgs(["agent-42"])).toThrow("usage");
    expect(() => manualMonitorPaths("../escape", tempDir())).toThrow("safe session name");
  });

  it("builds the old profile prompt shape and preserves fallback nudge rules", () => {
    const prompt = buildManualAdvisorPrompt({
      sessionName: "agent-42",
      endState: "tests pass",
      profileContent: "review carefully",
      staleCount: 3,
      intervalSeconds: 20,
      capture: "first\nsecond\nthird",
    });
    expect(prompt).toContain("TOP OF SESSION");
    expect(prompt).toContain("BOTTOM OF SESSION");
    expect(prompt).toContain("Expected end state: tests pass");
    expect(prompt).toContain("review carefully");
    expect(sanitizeNudge(" continue ")).toBe("");
    expect(fallbackNudge(1)).toContain("Resume only");
    expect(fallbackNudge(3)).toContain("You look stalled");
    expect(fallbackNudge(5)).toContain("Stop waiting");
  });

  it("records the manual global log, sends a typed fallback nudge, and keeps the log after a gone session", async () => {
    const root = tempDir();
    const sent: string[] = [];
    let aliveChecks = 0;
    const result = await runManualMonitor({
      sessionName: "agent-42",
      endState: "tests pass",
      profileName: "mentiko",
      profileContent: "review carefully",
      intervalSeconds: 1,
      maxStaleCount: 10,
      stateDir: root,
    }, {
      hasSession: async () => ++aliveChecks < 3,
      capture: async () => "unchanged pane",
      kill: async () => { throw new Error("must not kill a gone session"); },
      sendRaw: async (_session, value) => { sent.push(value); },
      advise: async () => "continue",
      sleep: async () => {},
      now: () => new Date("2026-07-16T00:00:00.000Z"),
    });

    expect(result.reason).toBe("session-gone");
    expect(result.staleCount).toBe(1);
    expect(sent).toEqual([fallbackNudge(1), "\r"]);
    const log = readFileSync(result.paths.log, "utf8");
    expect(log).toContain("monitor started for agent-42");
    expect(log).toContain("nudge:");
    expect(log).toContain("session terminated");
  });

  it("kills only after the stable completion marker appears", async () => {
    const root = tempDir();
    const kills: string[] = [];
    let captures = 0;
    const result = await runManualMonitor({
      sessionName: "agent-42",
      endState: "tests pass",
      profileName: "mentiko",
      profileContent: "review carefully",
      intervalSeconds: 1,
      maxStaleCount: 10,
      stateDir: root,
    }, {
      hasSession: async () => true,
      capture: async () => ++captures === 1 ? "stable" : "stable\nAGENT_COMPLETE",
      kill: async (session) => { kills.push(session); },
      sendRaw: async () => { throw new Error("must not nudge completed session"); },
      advise: async () => "",
      sleep: async () => {},
    });

    expect(result.reason).toBe("complete");
    expect(kills).toEqual(["agent-42"]);
  });
});
