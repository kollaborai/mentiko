import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createLiveMonitorIO, selectTranscriptFromCapture, transcriptRootFromProfile } from "@/lib/runner-v2/monitor-live-io";
import { runRunnerV2CompletionEntrypoint } from "@/lib/runner-v2/completion-entrypoint";
import { createRunRecord, readRunJson, updateRunJson, type RunRecord } from "@/lib/runner-v2/run-state";

jest.mock("@/lib/pty/pty-client", () => ({
  pty: {
    alive: jest.fn(),
    capture: jest.fn(),
    pid: jest.fn(),
    sendRaw: jest.fn(),
    spawn: jest.fn(),
  },
}));

jest.mock("node:child_process", () => ({
  ...jest.requireActual("node:child_process"),
  spawnSync: jest.fn(),
}));

jest.mock("@/lib/config", () => ({
  __esModule: true,
  derivePtyDaemonName: (root: string, namespace: string, org: string) =>
    `mentiko-${root.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "root"}-${namespace}-${org}`,
  default: {
    codeRoot: "/repo",
  },
  config: {
    codeRoot: "/repo",
  },
}));

const ptyMock = jest.requireMock("@/lib/pty/pty-client").pty as {
  alive: jest.Mock;
  capture: jest.Mock;
  pid: jest.Mock;
  sendRaw: jest.Mock;
  spawn: jest.Mock;
};

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "runner-v2-monitor-live-"));
}

function fixture() {
  const root = tempRoot();
  const runDir = join(root, "runs", "run-123");
  const eventsDir = join(root, "events");
  const stateDir = join(root, "state");
  mkdirSync(runDir, { recursive: true });
  mkdirSync(eventsDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  const runJsonPath = join(runDir, "run.json");
  const run = createRunRecord({ chainName: "chain", goal: "goal" });
  updateRunJson(runJsonPath, () => ({
    ...run,
    id: "run-123",
    status: "running",
    agents: [{ id: "writer", name: "Writer", session: "writer-run-123", status: "running" }],
    sessions: ["writer-run-123"],
  }));
  const chainPath = join(root, "chain.json");
  writeFileSync(chainPath, "{}\n");
  return { root, runDir, eventsDir, stateDir, runJsonPath, chainPath };
}

function liveIo(f: ReturnType<typeof fixture>, extraEnv: Record<string, string> = {}) {
  return createLiveMonitorIO({
    sessionName: "writer-run-123",
    chainPath: f.chainPath,
    runId: "run-123",
    runDir: f.runDir,
    runJsonPath: f.runJsonPath,
    agentId: "writer",
    workspaceType: "local",
    eventsDir: f.eventsDir,
    stateDir: f.stateDir,
    namespaceId: "default",
    orgId: "default",
    env: {
      MENTIKO_RUNNER_V2: "1",
      MENTIKO_RUNNER_V2_COMPLETION: "1",
      ...extraEnv,
    },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (spawnSync as jest.Mock).mockReturnValue({ status: 1 });
});

describe("monitor-v2 live IO", () => {
  it("latches only from durable assistant transcript marker or event file", async () => {
    const f = fixture();
    const transcript = join(f.root, "transcript.jsonl");
    writeFileSync(transcript, [
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "work\nAGENT_COMPLETE\n" }] },
      }),
      "",
    ].join("\n"));
    ptyMock.capture.mockResolvedValue("screen has 00000000-0000-0000-0000-000000000000");
    ptyMock.pid.mockResolvedValue(1234);
    (spawnSync as jest.Mock).mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "command") return { status: 0 };
      if (cmd === "pgrep" && args[0] === "-P") return { status: 0 };
      return { status: 1 };
    });

    const observed = await liveIo(f, { MENTIKO_TRANSCRIPT_JSONL: transcript }).observe("writer-run-123");
    expect(observed.latched).toBe(true);
    expect(observed.completionEventPresent).toBe(false);
  });

  it("spawns completion in a separate PTY with typed bridge env", async () => {
    const f = fixture();
    const transcript = join(f.root, "transcript.jsonl");
    writeFileSync(transcript, [
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "work\nAGENT_COMPLETE\n" }] },
      }),
      "",
    ].join("\n"));
    await liveIo(f, { MENTIKO_TRANSCRIPT_JSONL: transcript }).onComplete("writer-run-123");
    expect(ptyMock.spawn).toHaveBeenCalledWith(
      expect.stringMatching(/^complete-writer-run-123-/),
      "bash",
      ["-lc", expect.stringContaining("runner-v2-complete.js")],
      expect.objectContaining({
        env: expect.objectContaining({
          MENTIKO_RUN_ID: "run-123",
          MENTIKO_RUN_DIR: f.runDir,
          MENTIKO_CODE_ROOT: "/repo",
          EVENTS_DIR: f.eventsDir,
          STATE_DIR: f.stateDir,
          MENTIKO_RUNNER_V2: "1",
          MENTIKO_RUNNER_V2_COMPLETION: "1",
          MENTIKO_MONITOR_COMPLETION_LATCH: "1",
        }),
      }),
    );
    const command = ptyMock.spawn.mock.calls[0][2][1];
    expect(command).toContain("MENTIKO_MONITOR_COMPLETION_LATCH='1'");
  });

  it("dead without event marks run and agent failed with monitor diagnostic event", async () => {
    const f = fixture();
    await liveIo(f).onDied("writer-run-123");
    expect(readRunJson(f.runJsonPath)).toMatchObject({
      status: "failed",
      agents: [{ id: "writer", status: "failed" }],
    });
    const eventFiles = readFileSync(join(f.eventsDir, readDirOne(f.eventsDir)), "utf8");
    expect(eventFiles).toContain("event: agent-error");
    expect(eventFiles).toContain("source: monitor");
    expect(eventFiles).toContain("agent: writer");
  });

  describe("completion command flag gate (A1 -- fail closed on 64, no shell fallthrough)", () => {
    // No MENTIKO_TRANSCRIPT_JSONL override in these tests, so onComplete's
    // agentCompleteMarker lookup falls through to pty.capture -- pin it to a
    // UUID-free string so resolveTranscriptJsonl short-circuits instead of
    // scanning the real homedir with whatever a prior test left mocked
    // (clearAllMocks clears calls, not mockResolvedValue implementations).
    beforeEach(() => {
      ptyMock.capture.mockResolvedValue("");
    });

    it("runs ONLY the shell completion script when MENTIKO_RUNNER_V2_COMPLETION is not enabled", async () => {
      const f = fixture();
      await liveIo(f, { MENTIKO_RUNNER_V2: "1", MENTIKO_RUNNER_V2_COMPLETION: "" }).onComplete("writer-run-123");
      const command = ptyMock.spawn.mock.calls[0][2][1] as string;
      expect(command).toContain("chain-runner-complete.sh");
      expect(command).not.toContain("runner-v2-complete.js");
      expect(command).not.toContain("runner-v2-complete.cjs");
    });

    it("runs ONLY the shell completion script when MENTIKO_RUNNER_V2 is off, even if the completion flag is on", async () => {
      const f = fixture();
      await liveIo(f, { MENTIKO_RUNNER_V2: "", MENTIKO_RUNNER_V2_COMPLETION: "1" }).onComplete("writer-run-123");
      const command = ptyMock.spawn.mock.calls[0][2][1] as string;
      expect(command).toContain("chain-runner-complete.sh");
      expect(command).not.toContain("runner-v2-complete.js");
    });

    it("runs the typed path and fails CLOSED on 64 -- no shell fallthrough -- when both flags are enabled", async () => {
      const f = fixture();
      await liveIo(f, { MENTIKO_RUNNER_V2: "1", MENTIKO_RUNNER_V2_COMPLETION: "1" }).onComplete("writer-run-123");
      const command = ptyMock.spawn.mock.calls[0][2][1] as string;
      expect(command).toContain("runner-v2-complete.js");
      expect(command).toContain("exit 64");
      expect(command).not.toContain("chain-runner-complete.sh");
    });
  });

  describe("cross-run completion adoption (A3 -- freshness + task/chain identity guard)", () => {
    function chainWithEmit(root: string, agentId: string, emits: string): string {
      const chainPath = join(root, "chain.json");
      writeFileSync(chainPath, JSON.stringify({ agents: [{ id: agentId, emits }] }));
      return chainPath;
    }

    function seedCandidateRun(root: string, runId: string, patch: Partial<RunRecord> = {}) {
      const runDir = join(root, "runs", runId);
      mkdirSync(runDir, { recursive: true });
      const run = createRunRecord({ chainName: "chain", goal: "goal" });
      writeFileSync(join(runDir, "run.json"), JSON.stringify({ ...run, id: runId, status: "completed", ...patch }));
    }

    function seedCompletionEvent(eventsDir: string, name: string, fields: Record<string, string>) {
      const body = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n");
      writeFileSync(join(eventsDir, name), `${body}\n`);
    }

    it("adopts a cross-run event when both runs share the same task id (proven attempt relation), even if stale", async () => {
      const f = fixture();
      const chainPath = chainWithEmit(f.root, "writer", "draft");
      updateRunJson(f.runJsonPath, (run) => ({ ...(run as RunRecord), taskId: "TASK-1" }));
      seedCandidateRun(f.root, "run-old", { taskId: "TASK-1" });
      seedCompletionEvent(f.eventsDir, "run-old-writer-draft.event", {
        event: "draft",
        source: "writer-run-old",
        run_id: "run-old",
        timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        processed: "false",
      });
      ptyMock.capture.mockResolvedValue("work done\nAGENT_COMPLETE\n");

      const observed = await createLiveMonitorIO({
        sessionName: "writer-run-123",
        chainPath,
        runId: "run-123",
        runDir: f.runDir,
        runJsonPath: f.runJsonPath,
        agentId: "writer",
        workspaceType: "local",
        eventsDir: f.eventsDir,
        stateDir: f.stateDir,
        namespaceId: "default",
        orgId: "default",
        env: { MENTIKO_RUNNER_V2: "1", MENTIKO_RUNNER_V2_COMPLETION: "1" },
      }).observe("writer-run-123");

      expect(observed.completionEventPresent).toBe(true);
    });

    it("does NOT adopt a stale cross-run event from an unrelated task, even with a matching chain name", async () => {
      const f = fixture();
      const chainPath = chainWithEmit(f.root, "writer", "draft");
      updateRunJson(f.runJsonPath, (run) => ({ ...(run as RunRecord), taskId: "TASK-1" }));
      seedCandidateRun(f.root, "run-old", { taskId: "TASK-9", chain: "chain" });
      seedCompletionEvent(f.eventsDir, "run-old-writer-draft.event", {
        event: "draft",
        source: "writer-run-old",
        run_id: "run-old",
        timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1h old -- outside the freshness window
        processed: "false",
      });
      ptyMock.capture.mockResolvedValue("work done\nAGENT_COMPLETE\n");

      const observed = await createLiveMonitorIO({
        sessionName: "writer-run-123",
        chainPath,
        runId: "run-123",
        runDir: f.runDir,
        runJsonPath: f.runJsonPath,
        agentId: "writer",
        workspaceType: "local",
        eventsDir: f.eventsDir,
        stateDir: f.stateDir,
        namespaceId: "default",
        orgId: "default",
        env: { MENTIKO_RUNNER_V2: "1", MENTIKO_RUNNER_V2_COMPLETION: "1" },
      }).observe("writer-run-123");

      expect(observed.completionEventPresent).toBe(false);
    });

    it("adopts a cross-run event with no task link when it is FRESH and the chain name matches", async () => {
      const f = fixture();
      const chainPath = chainWithEmit(f.root, "writer", "draft");
      seedCandidateRun(f.root, "run-old", { chain: "chain" });
      seedCompletionEvent(f.eventsDir, "run-old-writer-draft.event", {
        event: "draft",
        source: "writer-run-old",
        run_id: "run-old",
        timestamp: new Date().toISOString(),
        processed: "false",
      });
      ptyMock.capture.mockResolvedValue("work done\nAGENT_COMPLETE\n");

      const observed = await createLiveMonitorIO({
        sessionName: "writer-run-123",
        chainPath,
        runId: "run-123",
        runDir: f.runDir,
        runJsonPath: f.runJsonPath,
        agentId: "writer",
        workspaceType: "local",
        eventsDir: f.eventsDir,
        stateDir: f.stateDir,
        namespaceId: "default",
        orgId: "default",
        env: { MENTIKO_RUNNER_V2: "1", MENTIKO_RUNNER_V2_COMPLETION: "1" },
      }).observe("writer-run-123");

      expect(observed.completionEventPresent).toBe(true);
    });

    it("feeds guarded cross-run completion evidence from observe into the typed entrypoint", async () => {
      const f = fixture();
      const chainPath = join(f.root, "chain.json");
      writeFileSync(chainPath, JSON.stringify({
        id: "chain",
        name: "Chain",
        agents: [
          { id: "writer", emits: "draft-ready" },
          { id: "reviewer", triggers: ["draft-ready"] },
        ],
      }));
      updateRunJson(f.runJsonPath, (run) => ({ ...(run as RunRecord), taskId: "TASK-1" }));
      seedCandidateRun(f.root, "run-old", { taskId: "TASK-1" });
      seedCompletionEvent(f.eventsDir, "run-old-writer-draft.event", {
        event: "draft-ready",
        source: "writer-run-old",
        run_id: "run-old",
        timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        processed: "false",
      });
      ptyMock.capture.mockResolvedValue("work done\nAGENT_COMPLETE\n");

      const io = createLiveMonitorIO({
        sessionName: "writer-run-123",
        chainPath,
        runId: "run-123",
        runDir: f.runDir,
        runJsonPath: f.runJsonPath,
        agentId: "writer",
        workspaceType: "local",
        eventsDir: f.eventsDir,
        stateDir: f.stateDir,
        namespaceId: "default",
        orgId: "default",
        env: { MENTIKO_RUNNER_V2: "1", MENTIKO_RUNNER_V2_COMPLETION: "1" },
      });

      const observed = await io.observe("writer-run-123");
      expect(observed).toMatchObject({ completionEventPresent: true, latched: true });
      await io.onComplete("writer-run-123");

      const completionEnv = ptyMock.spawn.mock.calls[0][3].env as Record<string, string>;
      expect(completionEnv.MENTIKO_MONITOR_COMPLETION_LATCH).toBe("1");

      const result = runRunnerV2CompletionEntrypoint({
        sessionName: "writer-run-123",
        chainPath,
        env: {
          ...completionEnv,
          MENTIKO_MONITOR_STATE_DIR: f.stateDir,
          PTY_MGR_BIN: "/bin/false",
        },
        dryRun: true,
        now: new Date("2026-07-10T00:00:00.000Z"),
      });

      expect(result.decision).toBe("route");
      expect(result.plan.launches).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: "single",
          command: expect.stringContaining("--start 'reviewer'"),
        }),
      ]));
    });
  });
});

function readDirOne(dir: string): string {
  return jest.requireActual("node:fs").readdirSync(dir)[0];
}

describe("selectTranscriptFromCapture — decoy-UUID resilience (durable-marker resolution)", () => {
  const REAL = "9c775526-1481-48dd-99cb-bc8da80d47bc";
  const DECOY = "c11fb05f-fdf5-43ba-b76c-dd4f28c4d7a0";
  // Only the real session UUID has a transcript file on disk.
  const resolve = (uuid: string) => (uuid === REAL ? `/transcripts/${uuid}.jsonl` : "");

  it("skips a decoy UUID that appears FIRST in the capture and resolves the real one", () => {
    // Reproduces the monitor completion hang: the agent's goal echoes a decision_id
    // (a UUID) into the scrollback, so it precedes the CLI status-bar session UUID.
    // First-match resolution picked the decoy (no file) and never found the marker.
    const capture = [
      `DECISION_ID: ${DECOY}`,
      "...agent transcript scroll...",
      "AGENT_COMPLETE",
      `bypass permissions on  ${REAL}   104416 tokens`,
    ].join("\n");
    expect(selectTranscriptFromCapture(capture, resolve)).toBe(`/transcripts/${REAL}.jsonl`);
  });

  it("returns '' when no UUID in the capture resolves to a transcript file", () => {
    expect(selectTranscriptFromCapture(`only ${DECOY} here`, resolve)).toBe("");
  });

  it("returns '' when the capture has no UUID at all", () => {
    expect(selectTranscriptFromCapture("no uuids on this screen", resolve)).toBe("");
  });

  it("is case-insensitive and de-duplicates repeated UUIDs before resolving", () => {
    const capture = `${REAL.toUpperCase()} ... ${REAL} ... ${REAL}`;
    const seen: string[] = [];
    const spy = (uuid: string) => { seen.push(uuid); return `/transcripts/${uuid}.jsonl`; };
    expect(selectTranscriptFromCapture(capture, spy)).toBe(`/transcripts/${REAL}.jsonl`);
    expect(seen).toEqual([REAL]); // lowercased + deduped to a single resolve attempt
  });
});

describe("transcriptRootFromProfile", () => {
  it("uses only the selected agent profile log_path", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-profile-log-"));
    const profile = join(root, "codex.json");
    writeFileSync(profile, JSON.stringify({ cli: "codex", log_path: join(root, "sessions") }));
    expect(transcriptRootFromProfile(profile)).toBe(join(root, "sessions"));
  });

  it("fails closed when the selected profile has no configured log_path", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-profile-log-"));
    const profile = join(root, "custom.json");
    writeFileSync(profile, JSON.stringify({ cli: "custom-model" }));
    expect(transcriptRootFromProfile(profile)).toBe("");
    expect(transcriptRootFromProfile(undefined)).toBe("");
  });
});
