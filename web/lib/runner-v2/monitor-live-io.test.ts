import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createLiveMonitorIO, hasAuthoritativeGenerationArtifact, selectTranscriptFromCapture, transcriptRootFromProfile } from "@/lib/runner-v2/monitor-live-io";
import { runChainMonitor } from "@/lib/runner-v2/monitor";
import { runRunnerV2CompletionEntrypoint } from "@/lib/runner-v2/completion-entrypoint";
import { consumeCompletionLaunchContext } from "@/lib/runner-v2/completion-launch-context";
import { createRunRecord, readRunJson, updateRunJson, type RunRecord } from "@/lib/runner-v2/run-state";
import { runnerEventFixture } from "@/lib/runner-v2/test-support/runner-event-fixture";

jest.mock("@/lib/pty/pty-client", () => ({
  pty: {
    alive: jest.fn(),
    capture: jest.fn(),
    pid: jest.fn(),
    sendRaw: jest.fn(),
    spawn: jest.fn(),
    remove: jest.fn(),
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
    codeRoot: process.cwd().replace(/\/web$/, ""),
    globalRoot: "/data",
    namespaceId: "default",
    orgId: "default",
  },
  config: {
    codeRoot: process.cwd().replace(/\/web$/, ""),
    globalRoot: "/data",
    namespaceId: "default",
    orgId: "default",
  },
}));

const ptyMock = jest.requireMock("@/lib/pty/pty-client").pty as {
  alive: jest.Mock;
  capture: jest.Mock;
  pid: jest.Mock;
  sendRaw: jest.Mock;
  spawn: jest.Mock;
  remove: jest.Mock;
};

let lastCompletionContext: Record<string, string> = {};

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "runner-v2-monitor-live-"));
}

function fixture() {
  const root = tempRoot();
  const runDir = join(root, "runs", "run-123");
  const workspace = join(root, "workspace");
  const eventsDir = join(root, "events");
  const stateDir = join(root, "state");
  mkdirSync(runDir, { recursive: true });
  mkdirSync(eventsDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  const runJsonPath = join(runDir, "run.json");
  const run = createRunRecord({ chainName: "chain", goal: "goal" });
  updateRunJson(runJsonPath, () => ({
    ...run,
    id: "run-123",
    status: "running",
    agents: [{ id: "writer", name: "Writer", session: "writer-run-123", status: "running" }],
    sessions: ["writer-run-123"],
    workspacePath: workspace,
    runnerV2: {
      attempts: [{
        id: "run-123:writer:1", runId: "run-123", agentId: "writer",
        phase: "instructions_submitted", instructionLedger: [], recoveryDecisionCount: 0,
        createdAt: new Date(Date.now() - 60_000).toISOString(),
        updatedAt: new Date().toISOString(), transitions: [],
      }],
    },
  }));
  const chainPath = join(root, "chain.json");
  writeFileSync(chainPath, "{}\n");
  return { root, runDir, workspace, eventsDir, stateDir, runJsonPath, chainPath };
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
  lastCompletionContext = {};
  ptyMock.spawn.mockImplementation(async (name: string, _cmd: string, args: string[]) => {
    lastCompletionContext = consumeCompletionLaunchContext(args[3], {});
    return { name, pid: 4242 };
  });
  ptyMock.remove.mockResolvedValue(undefined);
  (spawnSync as jest.Mock).mockReturnValue({ status: 1 });
});

describe("monitor-v2 live IO", () => {
  it("accepts only a current, contract-compatible core generation artifact", () => {
    const f = fixture();
    mkdirSync(join(f.runDir, "artifacts"), { recursive: true });
    mkdirSync(join(f.runDir, ".internal"), { recursive: true });
    writeFileSync(join(f.runDir, ".internal", "generation-import-token"), "token\n");
    writeFileSync(f.chainPath, JSON.stringify({ metadata: { coreGenerationChain: true } }));
    updateRunJson(f.runJsonPath, (run) => ({
      ...(run as RunRecord),
      metadata: { generationJobId: "job-1", generationKind: "task" },
      runnerV2: {
        attempts: [{
          id: "run-123:writer:1", runId: "run-123", agentId: "writer",
          phase: "instructions_submitted", instructionLedger: [], recoveryDecisionCount: 0,
          createdAt: new Date(Date.now() - 10_000).toISOString(),
          updatedAt: new Date().toISOString(), transitions: [],
        }],
      },
    }));
    writeFileSync(join(f.runDir, "artifacts", "generation-result.json"), JSON.stringify({
      route: "task",
      task: { title: "Generated task", type: "task", priority: 2 },
    }));
    const context = {
      sessionName: "writer-run-123", chainPath: f.chainPath, runId: "run-123",
      runDir: f.runDir, runJsonPath: f.runJsonPath, agentId: "writer",
      workspaceType: "local", eventsDir: f.eventsDir, stateDir: f.stateDir,
      namespaceId: "default", orgId: "default", env: {},
    };
    expect(hasAuthoritativeGenerationArtifact(context)).toBe(true);
    writeFileSync(join(f.runDir, "artifacts", "generation-result.json"), JSON.stringify({ unrelated: true }));
    expect(hasAuthoritativeGenerationArtifact(context)).toBe(false);
  });

  it("latches only from durable assistant transcript marker or event file", async () => {
    const f = fixture();
    const transcript = join(f.root, "transcript.jsonl");
    writeFileSync(transcript, [
      JSON.stringify({
        type: "assistant",
        cwd: f.workspace,
        timestamp: new Date().toISOString(),
        message: { content: [{ type: "text", text: "run-123\nwork\nAGENT_COMPLETE\n" }] },
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
        cwd: f.workspace,
        timestamp: new Date().toISOString(),
        message: { content: [{ type: "text", text: "run-123\nwork\nAGENT_COMPLETE\n" }] },
      }),
      "",
    ].join("\n"));
    await liveIo(f, { MENTIKO_TRANSCRIPT_JSONL: transcript }).onComplete("writer-run-123");
    const codeRoot = process.cwd().replace(/\/web$/, "");
    const call = ptyMock.spawn.mock.calls[0];
    expect(call[0]).toEqual(expect.stringMatching(/^complete-writer-run-123-/));
    expect(call[1]).toBe(process.execPath);
    expect(call[2]).toEqual([
      join(codeRoot, "web", "scripts", "runner-v2-complete.cjs"),
      "writer-run-123",
      f.chainPath,
      expect.stringMatching(/mentiko-completion-context-.*\/context\.json$/),
    ]);
    expect(call[3]).toBeUndefined();
    expect(lastCompletionContext).toMatchObject({
      MENTIKO_RUN_ID: "run-123",
      MENTIKO_RUN_DIR: f.runDir,
      MENTIKO_CODE_ROOT: codeRoot,
      EVENTS_DIR: f.eventsDir,
      STATE_DIR: f.stateDir,
      MENTIKO_RUNNER_V2: "1",
      MENTIKO_RUNNER_V2_COMPLETION: "1",
      MENTIKO_MONITOR_COMPLETION_LATCH: "1",
    });
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

  describe("typed-only completion command (A1 -- fail closed, no shell fallthrough)", () => {
    // No MENTIKO_TRANSCRIPT_JSONL override in these tests, so onComplete's
    // agentCompleteMarker lookup falls through to pty.capture -- pin it to a
    // UUID-free string so resolveTranscriptJsonl short-circuits instead of
    // scanning the real homedir with whatever a prior test left mocked
    // (clearAllMocks clears calls, not mockResolvedValue implementations).
    beforeEach(() => {
      ptyMock.capture.mockResolvedValue("");
    });

    it("runs typed completion when the old completion flag is off", async () => {
      const f = fixture();
      await liveIo(f, { MENTIKO_RUNNER_V2: "1", MENTIKO_RUNNER_V2_COMPLETION: "" }).onComplete("writer-run-123");
      expect(ptyMock.spawn.mock.calls[0][1]).toBe(process.execPath);
      expect(ptyMock.spawn.mock.calls[0][2][0]).toContain("runner-v2-complete.cjs");
      expect(lastCompletionContext).toMatchObject({
        MENTIKO_RUNNER_V2: "1",
        MENTIKO_RUNNER_V2_COMPLETION: "1",
      });
    });

    it("runs typed completion when initial runner-v2 is off", async () => {
      const f = fixture();
      await liveIo(f, { MENTIKO_RUNNER_V2: "", MENTIKO_RUNNER_V2_COMPLETION: "1" }).onComplete("writer-run-123");
      expect(ptyMock.spawn.mock.calls[0][1]).toBe(process.execPath);
      expect(ptyMock.spawn.mock.calls[0][2][0]).toContain("runner-v2-complete.cjs");
    });

    it("passes completion argv directly without a shell process", async () => {
      const f = fixture();
      await liveIo(f, { MENTIKO_RUNNER_V2: "1", MENTIKO_RUNNER_V2_COMPLETION: "1" }).onComplete("writer-run-123");
      expect(ptyMock.spawn.mock.calls[0].slice(1, 3)).toEqual([
        process.execPath,
        [
          expect.stringContaining("runner-v2-complete.cjs"),
          "writer-run-123",
          f.chainPath,
          expect.stringMatching(/mentiko-completion-context-.*\/context\.json$/),
        ],
      ]);
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
      const canonical = new Set(["event", "source", "run_id", "timestamp", "processed", "data"]);
      writeFileSync(join(eventsDir, name), runnerEventFixture({
        event: fields.event,
        source: fields.source,
        runId: fields.run_id,
        timestamp: fields.timestamp,
        processed: fields.processed === "true",
        data: fields.data ?? "",
        extensions: Object.fromEntries(Object.entries(fields).filter(([key]) => !canonical.has(key))),
      }));
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

      const completionEnv = lastCompletionContext;
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
          command: expect.stringMatching(/runner-v2-launch-agent.*'reviewer'/),
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

  it("fails closed when no run or attempt identity boundary is provided", () => {
    expect(selectTranscriptFromCapture(`${DECOY}\n${REAL}`, () => "/transcript.jsonl")).toBe("");
  });

  it("returns '' when the capture has no UUID at all", () => {
    expect(selectTranscriptFromCapture("no uuids on this screen", () => "/transcript.jsonl", {
      workspacePath: "/workspace/current",
    })).toBe("");
  });

  it("is case-insensitive and de-duplicates repeated UUIDs before resolving", () => {
    const root = tempRoot();
    const realPath = join(root, `${REAL}.jsonl`);
    writeFileSync(realPath, JSON.stringify({
      type: "assistant", sessionId: REAL, cwd: "/workspace/current",
      timestamp: "2026-07-11T20:01:00.000Z",
    }));
    const capture = `${REAL.toUpperCase()} ... ${REAL} ... ${REAL}`;
    const seen: string[] = [];
    const spy = (uuid: string) => { seen.push(uuid); return realPath; };
    expect(selectTranscriptFromCapture(capture, spy, {
      workspacePath: "/workspace/current",
      attemptStartedAt: "2026-07-11T20:00:00.000Z",
      now: new Date("2026-07-11T20:02:00.000Z"),
    })).toBe(realPath);
    expect(seen).toEqual([REAL]); // lowercased + deduped to a single resolve attempt
  });

  it("selects the later real transcript and latches on the first tick when both UUID files exist", async () => {
    const f = fixture();
    const transcriptRoot = join(f.root, "transcripts");
    mkdirSync(transcriptRoot, { recursive: true });
    const decoyPath = join(transcriptRoot, `${DECOY}.jsonl`);
    const realPath = join(transcriptRoot, `${REAL}.jsonl`);
    const attemptAt = new Date(Date.now() - 30_000).toISOString();
    updateRunJson(f.runJsonPath, (run) => ({
      ...(run as RunRecord),
      workspacePath: f.workspace,
      runnerV2: {
        attempts: [{
          id: `${run!.id}:writer:1`, runId: run!.id, agentId: "writer",
          phase: "instructions_submitted", instructionLedger: [], recoveryDecisionCount: 0,
          createdAt: attemptAt, updatedAt: attemptAt, transitions: [],
        }],
      },
    }));
    writeFileSync(decoyPath, `${JSON.stringify({
      type: "assistant", sessionId: DECOY, cwd: join(f.root, "other-workspace"),
      timestamp: new Date().toISOString(),
      message: { content: [{ type: "text", text: "unrelated work" }] },
    })}\n`);
    writeFileSync(realPath, `${JSON.stringify({
      type: "assistant", sessionId: REAL, cwd: f.workspace,
      timestamp: new Date().toISOString(),
      message: { content: [{ type: "text", text: "done\nAGENT_COMPLETE\n" }] },
    })}\n`);
    const profile = join(f.root, "profile.json");
    writeFileSync(profile, JSON.stringify({ log_path: transcriptRoot }));
    ptyMock.alive.mockResolvedValue(true);
    ptyMock.capture.mockResolvedValue(`${DECOY}\nstatus ${REAL}`);
    ptyMock.pid.mockResolvedValue(undefined);
    const io = liveIo(f, { MENTIKO_AGENT_PROFILE_PATH: profile });
    const result = await runChainMonitor("writer-run-123", io, {}, 0);

    expect(result.reason).toBe("complete");
    expect(result.ticks).toBe(1);
    expect(ptyMock.sendRaw).not.toHaveBeenCalled();
    expect(ptyMock.spawn).toHaveBeenCalledTimes(1);
    expect(selectTranscriptFromCapture(`${DECOY}\n${REAL}`, (uuid) => (
      uuid === DECOY ? decoyPath : uuid === REAL ? realPath : ""
    ), {
      workspacePath: f.workspace,
      attemptStartedAt: attemptAt,
    })).toBe(realPath);
  });

  it("rejects an existing unrelated transcript even when it contains an old AGENT_COMPLETE", () => {
    const root = tempRoot();
    const decoyPath = join(root, `${DECOY}.jsonl`);
    const realPath = join(root, `${REAL}.jsonl`);
    writeFileSync(decoyPath, JSON.stringify({
      type: "assistant", sessionId: DECOY, cwd: "/workspace/unrelated",
      timestamp: "2026-07-11T19:59:00.000Z",
      message: { content: [{ type: "text", text: "AGENT_COMPLETE" }] },
    }));
    writeFileSync(realPath, JSON.stringify({
      type: "assistant", sessionId: REAL, cwd: "/workspace/current/subdir",
      timestamp: "2026-07-11T20:01:00.000Z",
      message: { content: [{ type: "text", text: "still working" }] },
    }));
    const paths: Record<string, string> = { [DECOY]: decoyPath, [REAL]: realPath };
    expect(selectTranscriptFromCapture(`${DECOY}\n${REAL}`, (uuid) => paths[uuid] || "", {
      workspacePath: "/workspace/current",
      attemptStartedAt: "2026-07-11T20:00:00.000Z",
      now: new Date("2026-07-11T20:02:00.000Z"),
    })).toBe(realPath);
  });

  it("rejects a same-workspace transcript whose timestamps predate the current attempt", () => {
    const root = tempRoot();
    const stalePath = join(root, `${DECOY}.jsonl`);
    const realPath = join(root, `${REAL}.jsonl`);
    writeFileSync(stalePath, JSON.stringify({
      type: "assistant", sessionId: DECOY, cwd: "/workspace/current",
      timestamp: "2026-07-11T18:00:00.000Z",
      message: { content: [{ type: "text", text: "AGENT_COMPLETE" }] },
    }));
    writeFileSync(realPath, JSON.stringify({
      type: "assistant", sessionId: REAL, cwd: "/workspace/current",
      timestamp: "2026-07-11T20:01:00.000Z",
      message: { content: [{ type: "text", text: "working" }] },
    }));
    const paths: Record<string, string> = { [DECOY]: stalePath, [REAL]: realPath };
    expect(selectTranscriptFromCapture(`${DECOY}\n${REAL}`, (uuid) => paths[uuid] || "", {
      workspacePath: "/workspace/current",
      attemptStartedAt: "2026-07-11T20:00:00.000Z",
      now: new Date("2026-07-11T20:02:00.000Z"),
    })).toBe(realPath);
  });

  it("fails closed when two transcripts satisfy the same workspace and attempt identity", () => {
    const root = tempRoot();
    const paths = Object.fromEntries([DECOY, REAL].map((uuid) => {
      const path = join(root, `${uuid}.jsonl`);
      writeFileSync(path, JSON.stringify({
        type: "assistant", sessionId: uuid, cwd: "/workspace/current",
        timestamp: "2026-07-11T20:01:00.000Z",
      }));
      return [uuid, path];
    }));
    expect(selectTranscriptFromCapture(`${DECOY}\n${REAL}`, (uuid) => paths[uuid] || "", {
      workspacePath: "/workspace/current",
      attemptStartedAt: "2026-07-11T20:00:00.000Z",
      now: new Date("2026-07-11T20:02:00.000Z"),
    })).toBe("");
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
