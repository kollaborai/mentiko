import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureAssertsAgentComplete,
  captureHash,
  clearMonitorState,
  computeLatch,
  crossRunAdoptionAllowed,
  findAgentCompletionEventAnyRun,
  findCompletionEventFile,
  loadMonitorState,
  monitorStatePaths,
  readDeclaredEmits,
  readEventRunAndTimestamp,
  saveMonitorState,
} from "@/lib/runner-v2/monitor-io";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "monitor-io-"));
}

describe("monitor-io — verifiable adapter core", () => {
  it("round-trips durable state and, on restart, preserves the nudge budget", () => {
    const dir = tempDir();
    saveMonitorState("sess", { prevHash: "abc", staleCount: 2, nudgeCount: 3, nudgeEchoGrace: 5, contextExhaustedStreak: 4 }, dir);

    // a fresh process (restart) re-loads from disk: prevHash/stale/nudges survive,
    // echo-grace and context-exhaustion streak reset to 0 (a restart cannot be
    // mid-echo, and the persistent wedge rebuilds its streak in a couple ticks).
    const reloaded = loadMonitorState("sess", dir);
    expect(reloaded).toEqual({ prevHash: "abc", staleCount: 2, nudgeCount: 3, nudgeEchoGrace: 0, contextExhaustedStreak: 0 });
  });

  it("clears state files on terminal exit", () => {
    const dir = tempDir();
    saveMonitorState("sess", { prevHash: "abc", staleCount: 1, nudgeCount: 1, nudgeEchoGrace: 0, contextExhaustedStreak: 0 }, dir);
    expect(existsSync(monitorStatePaths("sess", dir).state)).toBe(true);
    clearMonitorState("sess", dir);
    expect(existsSync(monitorStatePaths("sess", dir).state)).toBe(false);
  });

  describe("findCompletionEventFile", () => {
    function seedEvent(dir: string, name: string, fields: Record<string, string>) {
      const body = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n");
      writeFileSync(join(dir, name), `${body}\n`);
    }

    it("matches an unprocessed event for the right run + agent (source stamped with the session name)", () => {
      const dir = tempDir();
      seedEvent(dir, "run-1-writer-draft.event", { event: "draft", source: "writer-run-1", run_id: "run-1", processed: "false" });
      // real sources are session-name-shaped (agentId + run suffix), not the bare
      // agent id -- agentOwnsEvent's exact match needs sessionName as an owner
      // candidate for this (the normal, non-degenerate) case to match at all.
      expect(findCompletionEventFile({ eventsDir: dir, runId: "run-1", agentId: "writer", expectedEvent: "draft", sessionName: "writer-run-1" })).toBe("run-1-writer-draft.event");
    });

    it("does NOT match on the bare agent id alone when the event source is session-name-shaped and no sessionName is supplied (fail-closed, not a substring fallback)", () => {
      const dir = tempDir();
      seedEvent(dir, "e.event", { event: "draft", source: "writer-run-1", run_id: "run-1", processed: "false" });
      expect(findCompletionEventFile({ eventsDir: dir, runId: "run-1", agentId: "writer", expectedEvent: "draft" })).toBe("");
    });

    it("rejects an event whose run id does not match", () => {
      const dir = tempDir();
      seedEvent(dir, "e.event", { event: "draft", source: "writer-run-2", run_id: "run-2", processed: "false" });
      expect(findCompletionEventFile({ eventsDir: dir, runId: "run-1", agentId: "writer", expectedEvent: "draft" })).toBe("");
    });

    it("rejects an event whose source does not contain the agent id", () => {
      const dir = tempDir();
      seedEvent(dir, "e.event", { event: "draft", source: "reviewer-run-1", run_id: "run-1", processed: "false" });
      expect(findCompletionEventFile({ eventsDir: dir, runId: "run-1", agentId: "writer", expectedEvent: "draft" })).toBe("");
    });

    it("rejects a diagnostic (monitor-sourced) event so a stall can't look like handoff", () => {
      const dir = tempDir();
      seedEvent(dir, "e.event", { event: "agent-timeout", source: "monitor", agent: "writer", run_id: "run-1", processed: "false" });
      expect(findCompletionEventFile({ eventsDir: dir, runId: "run-1", agentId: "writer", expectedEvent: "agent-timeout" })).toBe("");
    });

    it("rejects an already-processed event", () => {
      const dir = tempDir();
      seedEvent(dir, "e.event", { event: "draft", source: "writer-run-1", run_id: "run-1", processed: "true" });
      expect(findCompletionEventFile({ eventsDir: dir, runId: "run-1", agentId: "writer", expectedEvent: "draft" })).toBe("");
    });

    it("rejects a same-run/same-agent event whose name is not the agent's declared emit (A2)", () => {
      const dir = tempDir();
      seedEvent(dir, "e.event", { event: "some-other-event", source: "writer-run-1", run_id: "run-1", processed: "false" });
      expect(findCompletionEventFile({ eventsDir: dir, runId: "run-1", agentId: "writer", expectedEvent: "draft" })).toBe("");
    });

    it("never matches when the agent has no declared emits event (mirrors shell's -n expected_event guard)", () => {
      const dir = tempDir();
      seedEvent(dir, "e.event", { event: "draft", source: "writer-run-1", run_id: "run-1", processed: "false" });
      expect(findCompletionEventFile({ eventsDir: dir, runId: "run-1", agentId: "writer", expectedEvent: "" })).toBe("");
    });

    it("rejects a same-name-prefix agent -- exact identity match only, no substring (agentOwnsEvent) -- even with the real owner's session name supplied", () => {
      const dir = tempDir();
      seedEvent(dir, "e.event", { event: "draft", source: "api-reviewer-run-1", run_id: "run-1", processed: "false" });
      expect(findCompletionEventFile({ eventsDir: dir, runId: "run-1", agentId: "api", expectedEvent: "draft", sessionName: "api-run-1" })).toBe("");
    });

    it("parses a JSON event body (event/source/run_id) the same as key:value", () => {
      const dir = tempDir();
      writeFileSync(join(dir, "e.event"), JSON.stringify({ event: "draft", source: "writer-run-1", run_id: "run-1", processed: false }));
      expect(findCompletionEventFile({ eventsDir: dir, runId: "run-1", agentId: "writer", expectedEvent: "draft", sessionName: "writer-run-1" })).toBe("e.event");
    });

    it("parses JSON event/source alias keys (event_name, source_agent, runId)", () => {
      const dir = tempDir();
      writeFileSync(join(dir, "e.event"), JSON.stringify({ event_name: "draft", source_agent: "writer-run-1", runId: "run-1", processed: false }));
      expect(findCompletionEventFile({ eventsDir: dir, runId: "run-1", agentId: "writer", expectedEvent: "draft", sessionName: "writer-run-1" })).toBe("e.event");
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

  describe("cross-run completion recovery", () => {
    function seedEvent(dir: string, name: string, fields: Record<string, string>) {
      const body = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n");
      writeFileSync(join(dir, name), `${body}\n`);
    }

    describe("findAgentCompletionEventAnyRun", () => {
      it("matches the agent's declared emit event under a DIFFERENT run (ignores run_id)", () => {
        const dir = tempDir();
        seedEvent(dir, "run-271-decision-researcher-decision-research-complete.event", {
          event: "decision-research-complete",
          source: "decision-researcher-run-271",
          run_id: "run-271",
          processed: "false",
        });
        expect(
          findAgentCompletionEventAnyRun({ eventsDir: dir, agentId: "decision-researcher", emitsEvent: "decision-research-complete" }),
        ).toBe("run-271-decision-researcher-decision-research-complete.event");
      });

      it("rejects an event whose name is not the declared emit (same agent, wrong event)", () => {
        const dir = tempDir();
        seedEvent(dir, "e.event", { event: "some-other-event", source: "decision-researcher-run-271", run_id: "run-271", processed: "false" });
        expect(findAgentCompletionEventAnyRun({ eventsDir: dir, agentId: "decision-researcher", emitsEvent: "decision-research-complete" })).toBe("");
      });

      it("does not let a prefix agent adopt a sibling agent's session event", () => {
        const dir = tempDir();
        seedEvent(dir, "api-reviewer.event", {
          event: "review-complete",
          source: "api-reviewer-run-271",
          run_id: "run-271",
          processed: "false",
        });
        seedEvent(dir, "api.event", {
          event: "review-complete",
          source: "api-run-272",
          run_id: "run-272",
          processed: "false",
        });

        expect(findAgentCompletionEventAnyRun({
          eventsDir: dir,
          agentId: "api",
          emitsEvent: "review-complete",
          allAgentIds: ["api", "api-reviewer"],
        })).toBe("api.event");
      });

      it("rejects a diagnostic (monitor-sourced) event", () => {
        const dir = tempDir();
        seedEvent(dir, "e.event", { event: "decision-research-complete", source: "monitor", agent: "decision-researcher", run_id: "run-271", processed: "false" });
        expect(findAgentCompletionEventAnyRun({ eventsDir: dir, agentId: "decision-researcher", emitsEvent: "decision-research-complete" })).toBe("");
      });

      it("rejects an already-processed event", () => {
        const dir = tempDir();
        seedEvent(dir, "e.event", { event: "decision-research-complete", source: "decision-researcher-run-271", run_id: "run-271", processed: "true" });
        expect(findAgentCompletionEventAnyRun({ eventsDir: dir, agentId: "decision-researcher", emitsEvent: "decision-research-complete" })).toBe("");
      });

      it("rejects when the source does not contain the agent id", () => {
        const dir = tempDir();
        seedEvent(dir, "e.event", { event: "decision-research-complete", source: "other-agent-run-271", run_id: "run-271", processed: "false" });
        expect(findAgentCompletionEventAnyRun({ eventsDir: dir, agentId: "decision-researcher", emitsEvent: "decision-research-complete" })).toBe("");
      });

      it("never blanket-matches when no emit name is given", () => {
        const dir = tempDir();
        seedEvent(dir, "e.event", { event: "decision-research-complete", source: "decision-researcher-run-271", run_id: "run-271", processed: "false" });
        expect(findAgentCompletionEventAnyRun({ eventsDir: dir, agentId: "decision-researcher", emitsEvent: "" })).toBe("");
      });
    });

    describe("captureAssertsAgentComplete", () => {
      it("is true for a standalone AGENT_COMPLETE line", () => {
        expect(captureAssertsAgentComplete("some output\nAGENT_COMPLETE\n")).toBe(true);
        expect(captureAssertsAgentComplete("  AGENT_COMPLETE  ")).toBe(true);
      });
      it("is false for the monitor's own nudge text (token mid-line)", () => {
        expect(captureAssertsAgentComplete("continue only the current assigned task, or write your event file and output AGENT_COMPLETE on its own line.")).toBe(false);
        expect(captureAssertsAgentComplete("make the final non-empty line exactly AGENT_COMPLETE. Do not redo the task.")).toBe(false);
      });
      it("is false for empty / no marker", () => {
        expect(captureAssertsAgentComplete("")).toBe(false);
        expect(captureAssertsAgentComplete("still working...")).toBe(false);
      });
    });

    describe("readDeclaredEmits", () => {
      function seedChain(dir: string, chain: unknown): string {
        const path = join(dir, "chain.json");
        writeFileSync(path, JSON.stringify(chain));
        return path;
      }
      it("returns the agent's declared emit string", () => {
        const dir = tempDir();
        const path = seedChain(dir, { agents: [{ id: "decision-researcher", emits: "decision-research-complete" }] });
        expect(readDeclaredEmits(path, "decision-researcher")).toBe("decision-research-complete");
      });
      it("returns '' for an unknown agent", () => {
        const dir = tempDir();
        const path = seedChain(dir, { agents: [{ id: "writer", emits: "draft" }] });
        expect(readDeclaredEmits(path, "decision-researcher")).toBe("");
      });
      it("returns '' when emits is not a string (array-valued or missing)", () => {
        const dir = tempDir();
        const path = seedChain(dir, { agents: [{ id: "a", emits: ["x", "y"] }, { id: "b" }] });
        expect(readDeclaredEmits(path, "a")).toBe("");
        expect(readDeclaredEmits(path, "b")).toBe("");
      });
      it("returns '' for an unreadable / missing chain file", () => {
        expect(readDeclaredEmits(join(tempDir(), "nope.json"), "a")).toBe("");
      });
    });

    describe("readEventRunAndTimestamp", () => {
      it("reads run_id and timestamp off an event file", () => {
        const dir = tempDir();
        seedEvent(dir, "e.event", { event: "draft", source: "writer-run-1", run_id: "run-1", timestamp: "2026-07-08T00:00:00.000Z" });
        expect(readEventRunAndTimestamp(dir, "e.event")).toEqual({ runId: "run-1", timestamp: "2026-07-08T00:00:00.000Z" });
      });
      it("returns empty strings for a missing file", () => {
        expect(readEventRunAndTimestamp(tempDir(), "nope.event")).toEqual({ runId: "", timestamp: "" });
      });
    });

    describe("crossRunAdoptionAllowed (A3 -- constrains cross-run adoption)", () => {
      const now = new Date("2026-07-08T12:00:00.000Z");
      const minutesAgo = (n: number) => new Date(now.getTime() - n * 60 * 1000).toISOString();

      it("allows adoption when the candidate run is the current run's recorded parent, even if stale", () => {
        expect(crossRunAdoptionAllowed({
          candidateRunId: "run-old",
          candidateTimestamp: minutesAgo(120),
          now,
          currentRun: { parent_run_id: "run-old" },
          candidateRun: null,
        })).toBe(true);
      });

      it("allows adoption when both runs share the same task id (proven attempt relation), even if stale", () => {
        expect(crossRunAdoptionAllowed({
          candidateRunId: "run-old",
          candidateTimestamp: minutesAgo(120),
          now,
          currentRun: { taskId: "TASK-1" },
          candidateRun: { taskId: "TASK-1" },
        })).toBe(true);
      });

      it("does not treat two runs with no task id as related (no false positive on double-undefined)", () => {
        expect(crossRunAdoptionAllowed({
          candidateRunId: "run-old",
          candidateTimestamp: minutesAgo(120),
          now,
          currentRun: {},
          candidateRun: {},
        })).toBe(false);
      });

      it("allows adoption on a fresh event with matching chain identity when there is no task link", () => {
        expect(crossRunAdoptionAllowed({
          candidateRunId: "run-old",
          candidateTimestamp: minutesAgo(1),
          now,
          currentRun: { chain: "content-pipeline" },
          candidateRun: { chain: "content-pipeline" },
        })).toBe(true);
      });

      it("rejects a fresh event when the chain does not match", () => {
        expect(crossRunAdoptionAllowed({
          candidateRunId: "run-old",
          candidateTimestamp: minutesAgo(1),
          now,
          currentRun: { chain: "content-pipeline" },
          candidateRun: { chain: "other-pipeline" },
        })).toBe(false);
      });

      it("rejects a matching-chain event once it falls outside the freshness window", () => {
        expect(crossRunAdoptionAllowed({
          candidateRunId: "run-old",
          candidateTimestamp: minutesAgo(120),
          now,
          currentRun: { chain: "content-pipeline" },
          candidateRun: { chain: "content-pipeline" },
        })).toBe(false);
      });

      it("rejects when the candidate run id is unknown (event carries no run_id)", () => {
        expect(crossRunAdoptionAllowed({
          candidateRunId: "",
          candidateTimestamp: minutesAgo(0),
          now,
          currentRun: { chain: "content-pipeline" },
          candidateRun: { chain: "content-pipeline" },
        })).toBe(false);
      });

      it("rejects when the event has no timestamp at all", () => {
        expect(crossRunAdoptionAllowed({
          candidateRunId: "run-old",
          candidateTimestamp: "",
          now,
          currentRun: { chain: "content-pipeline" },
          candidateRun: { chain: "content-pipeline" },
        })).toBe(false);
      });
    });
  });
});
