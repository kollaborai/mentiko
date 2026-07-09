import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createLiveMonitorIO } from "@/lib/runner-v2/monitor-live-io";
import { createRunRecord, readRunJson, updateRunJson } from "@/lib/runner-v2/run-state";

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
});

function readDirOne(dir: string): string {
  return jest.requireActual("node:fs").readdirSync(dir)[0];
}
