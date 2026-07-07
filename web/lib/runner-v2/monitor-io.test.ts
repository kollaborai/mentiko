import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureHash,
  clearMonitorState,
  computeLatch,
  findCompletionEventFile,
  loadMonitorState,
  monitorStatePaths,
  saveMonitorState,
} from "@/lib/runner-v2/monitor-io";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "monitor-io-"));
}

describe("monitor-io — verifiable adapter core", () => {
  it("round-trips durable state and, on restart, preserves the nudge budget", () => {
    const dir = tempDir();
    saveMonitorState("sess", { prevHash: "abc", staleCount: 2, nudgeCount: 3, nudgeEchoGrace: 5 }, dir);

    // a fresh process (restart) re-loads from disk: prevHash/stale/nudges survive,
    // echo-grace resets to 0 (a restart cannot be mid-echo).
    const reloaded = loadMonitorState("sess", dir);
    expect(reloaded).toEqual({ prevHash: "abc", staleCount: 2, nudgeCount: 3, nudgeEchoGrace: 0 });
  });

  it("clears state files on terminal exit", () => {
    const dir = tempDir();
    saveMonitorState("sess", { prevHash: "abc", staleCount: 1, nudgeCount: 1, nudgeEchoGrace: 0 }, dir);
    expect(existsSync(monitorStatePaths("sess", dir).state)).toBe(true);
    clearMonitorState("sess", dir);
    expect(existsSync(monitorStatePaths("sess", dir).state)).toBe(false);
  });

  describe("findCompletionEventFile", () => {
    function seedEvent(dir: string, name: string, fields: Record<string, string>) {
      const body = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n");
      writeFileSync(join(dir, name), `${body}\n`);
    }

    it("matches an unprocessed event for the right run + agent", () => {
      const dir = tempDir();
      seedEvent(dir, "run-1-writer-draft.event", { event: "draft", source: "writer-run-1", run_id: "run-1", processed: "false" });
      expect(findCompletionEventFile({ eventsDir: dir, runId: "run-1", agentId: "writer" })).toBe("run-1-writer-draft.event");
    });

    it("rejects an event whose run id does not match", () => {
      const dir = tempDir();
      seedEvent(dir, "e.event", { event: "draft", source: "writer-run-2", run_id: "run-2", processed: "false" });
      expect(findCompletionEventFile({ eventsDir: dir, runId: "run-1", agentId: "writer" })).toBe("");
    });

    it("rejects an event whose source does not contain the agent id", () => {
      const dir = tempDir();
      seedEvent(dir, "e.event", { event: "draft", source: "reviewer-run-1", run_id: "run-1", processed: "false" });
      expect(findCompletionEventFile({ eventsDir: dir, runId: "run-1", agentId: "writer" })).toBe("");
    });

    it("rejects a diagnostic (monitor-sourced) event so a stall can't look like handoff", () => {
      const dir = tempDir();
      seedEvent(dir, "e.event", { event: "agent-timeout", source: "monitor", agent: "writer", run_id: "run-1", processed: "false" });
      expect(findCompletionEventFile({ eventsDir: dir, runId: "run-1", agentId: "writer" })).toBe("");
    });

    it("rejects an already-processed event", () => {
      const dir = tempDir();
      seedEvent(dir, "e.event", { event: "draft", source: "writer-run-1", run_id: "run-1", processed: "true" });
      expect(findCompletionEventFile({ eventsDir: dir, runId: "run-1", agentId: "writer" })).toBe("");
    });
  });

  describe("computeLatch — sticky, OR of marker/event", () => {
    it("stays latched once latched (marker may scroll off the window)", () => {
      expect(computeLatch({ alreadyLatched: true, markerDurable: false, completionEventPresent: false })).toBe(true);
    });
    it("latches on a durable marker", () => {
      expect(computeLatch({ alreadyLatched: false, markerDurable: true, completionEventPresent: false })).toBe(true);
    });
    it("latches on a completion event even with no marker (chatty agent)", () => {
      expect(computeLatch({ alreadyLatched: false, markerDurable: false, completionEventPresent: true })).toBe(true);
    });
    it("does not latch on neither", () => {
      expect(computeLatch({ alreadyLatched: false, markerDurable: false, completionEventPresent: false })).toBe(false);
    });
  });

  describe("captureHash", () => {
    it("is stable for the same tail and changes when the tail changes", () => {
      expect(captureHash("a\nb\nc")).toBe(captureHash("a\nb\nc"));
      expect(captureHash("a\nb\nc")).not.toBe(captureHash("a\nb\nd"));
    });
    it("only considers the last N lines (scrollback above the window is ignored)", () => {
      const lines = (n: number) => Array.from({ length: n }, (_, i) => `line-${i}`).join("\n");
      expect(captureHash(`OLD\n${lines(20)}`, 20)).toBe(captureHash(`DIFFERENT-OLD\n${lines(20)}`, 20));
    });
  });
});
