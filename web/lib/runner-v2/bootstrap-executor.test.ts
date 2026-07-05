import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { executeLocalBootstrap } from "@/lib/runner-v2/bootstrap-executor";
import type { AgentBootstrapPlan } from "@/lib/runner-v2/agent-bootstrap-plan";

jest.mock("@/lib/api/audit-exec", () => ({
  shellEscape: (value: string) => `'${value.replace(/'/g, "'\\''")}'`,
}));

function tempDir() {
  return mkdtempSync(join(tmpdir(), "runner-v2-bootstrap-exec-"));
}

function plan(root: string): AgentBootstrapPlan {
  return {
    agentId: "writer",
    agentName: "Writer",
    sessionPrefix: "writer",
    sessionName: "workspace-writer-run-1",
    monitorSessionName: "monitor-workspace-writer-run-1",
    statePath: join(root, "state", "writer-run-1.state"),
    artifactsDir: join(root, "artifacts"),
    eventsDir: join(root, "events"),
    projectRoot: join(root, "workspace"),
    profileId: "default",
    profilePath: join(root, "profiles", "default.json"),
    runContextExports: {
      PATH: "/repo/bin:/bin",
      MENTIKO_BIN: "/repo/bin/mentiko",
      MENTIKO_RUN_ID: "run-1",
      RUN_ID: "run-1",
      NAMESPACE_ID: "default",
      ORG_ID: "default",
      MENTIKO_AGENT_ID: "writer",
      MENTIKO_AGENT_EMITS: "done",
      MENTIKO_CODE_ROOT: "/repo",
      MENTIKO_PROJECT_ROOT: join(root, "workspace"),
      MENTIKO_ORG_ROOT: "",
      MENTIKO_NAMESPACE_ROOT: "",
      EVENTS_DIR: join(root, "events"),
      ARTIFACTS_DIR: join(root, "artifacts"),
      MENTIKO_SESSION_ID: "",
      MENTIKO_SESSION_TOKEN: "",
      MENTIKO_WEB_URL: "",
      KOLLABOR_ENGINE_URL: "",
    },
    instructionPath: join(root, "artifacts", "writer-instructions.md"),
    instructionPointer: `Read ${join(root, "artifacts", "writer-instructions.md")}`,
    localStartCommand: "source '/repo/lib/agent-profile.sh' && eval \"$(build_profile_command '/tmp/profile.json' --interactive)\"",
    monitorCommand: "monitor-chain-agent workspace-writer-run-1",
  };
}

describe("runner-v2 bootstrap executor", () => {
  beforeAll(() => {
    process.env.MENTIKO_RUNNER_V2_SUBMISSION_POLL_MS = "5";
    process.env.MENTIKO_RUNNER_V2_SUBMISSION_DEADLINE_MS = "200";
  });

  afterAll(() => {
    delete process.env.MENTIKO_RUNNER_V2_SUBMISSION_POLL_MS;
    delete process.env.MENTIKO_RUNNER_V2_SUBMISSION_DEADLINE_MS;
  });

  it("creates local pty session and sends start script plus existing instruction pointer", async () => {
    const root = tempDir();
    writeFileSync(join(root, "chain.json"), JSON.stringify({ agents: [{ id: "writer" }] }));
    const calls: Array<{ op: string; args: unknown[] }> = [];
    const executor = {
      remove: jest.fn(async (...args: unknown[]) => { calls.push({ op: "remove", args }); }),
      spawn: jest.fn(async (...args: unknown[]) => {
        calls.push({ op: "spawn", args });
        return { name: String(args[0]), pid: 123 };
      }),
      sendKeys: jest.fn(async (...args: unknown[]) => { calls.push({ op: "sendKeys", args }); }),
      capture: jest.fn(async () => "claude ready >"),
    };
    const runJsonPath = join(root, "run.json");
    writeFileSync(runJsonPath, JSON.stringify({
      id: "run-1",
      sessions: [],
      agents: [{ id: "writer", status: "pending" }],
    }));

    await executeLocalBootstrap(plan(root), {
      chainPath: join(root, "chain.json"),
      runDir: root,
      runId: "run-1",
      chainName: "Test Chain",
      logFd: 1,
      cwd: "/repo",
      env: {
        NODE_ENV: "test",
        RUNS_DIR: root,
        PATH: "/bin",
        SECRET_THAT_MUST_NOT_BE_IN_SCRIPT: "nope",
      },
    }, executor);

    expect(readFileSync(join(root, "artifacts", "writer-instructions.md"), "utf8")).toContain("Agent-ID: writer");
    const startScript = readFileSync(join(root, "artifacts", "writer-start.sh"), "utf8");
    expect(startScript).toContain("build_profile_command");
    expect(startScript).not.toContain("SECRET_THAT_MUST_NOT_BE_IN_SCRIPT");
    expect(startScript).not.toContain("chain-runner.sh");
    expect(calls.map((call) => call.op)).toEqual(["remove", "spawn", "sendKeys", "sendKeys", "remove", "spawn"]);
    expect(executor.spawn).toHaveBeenCalledWith(
      "workspace-writer-run-1",
      "zsh",
      [],
      expect.objectContaining({
        cwd: join(root, "workspace"),
        env: expect.objectContaining({
          MENTIKO_RUNNER_V2_ACTIVE: "1",
          MENTIKO_RUNNER_V2_MODE: "typed-plan",
          MENTIKO_AGENT_ID: "writer",
        }),
      }),
    );
    expect(executor.spawn).not.toHaveBeenCalledWith(
      "workspace-writer-run-1",
      "zsh",
      [],
      expect.objectContaining({
        env: expect.objectContaining({
          SECRET_THAT_MUST_NOT_BE_IN_SCRIPT: "nope",
        }),
      }),
    );
    expect(executor.sendKeys).toHaveBeenLastCalledWith("workspace-writer-run-1", expect.stringContaining("writer-instructions.md"));
    // the pointer must NOT embed a trailing enter: multi-line text goes to the
    // CLI as a bracketed paste and an embedded \r is swallowed into the paste;
    // the pty daemon appends the enter after its paste settle delay.
    const pointerSend = executor.sendKeys.mock.calls[executor.sendKeys.mock.calls.length - 1][1] as string;
    expect(pointerSend.endsWith("\r")).toBe(false);
    const happyAttempts = (JSON.parse(readFileSync(runJsonPath, "utf8")).runnerV2 || {}).attempts || [];
    expect(happyAttempts[0]?.phase).toBe("instructions_submitted");
    expect(JSON.parse(readFileSync(runJsonPath, "utf8"))).toMatchObject({
      sessions: ["workspace-writer-run-1"],
      agents: [{ id: "writer", status: "running", session: "workspace-writer-run-1" }],
    });
    expect(executor.spawn).toHaveBeenLastCalledWith(
      "monitor-workspace-writer-run-1",
      "bash",
      ["-lc", "monitor-chain-agent workspace-writer-run-1"],
      expect.objectContaining({ cwd: join(root, "workspace") }),
    );
  });

  it("retries bare enters until the composer accepts the pasted instructions", async () => {
    const root = tempDir();
    writeFileSync(join(root, "chain.json"), JSON.stringify({ agents: [{ id: "writer" }] }));
    const runJsonPath = join(root, "run.json");
    writeFileSync(runJsonPath, JSON.stringify({
      id: "run-1",
      sessions: [],
      agents: [{ id: "writer", status: "pending" }],
    }));
    // readiness poll sees a booted CLI; the first two post-send captures show
    // the composer still holding the paste (enter swallowed during boot),
    // then it clears after a bare-enter retry.
    const captures = [
      "claude ready >",
      "❯ [Pasted text #1 +7 lines]\n  statusline",
      "❯ Read instructions\n  statusline",
      "❯ \n  statusline",
      "❯ \n  statusline",
    ];
    const executor = {
      remove: jest.fn(async () => {}),
      spawn: jest.fn(async (name: string) => ({ name, pid: 123 })),
      sendKeys: jest.fn(async () => {}),
      sendRaw: jest.fn(async () => {}),
      capture: jest.fn(async () => captures.length > 1 ? captures.shift()! : captures[0]),
    };

    await executeLocalBootstrap(plan(root), {
      chainPath: join(root, "chain.json"),
      runDir: root,
      runId: "run-1",
      chainName: "Test Chain",
      logFd: 1,
      cwd: "/repo",
      env: { NODE_ENV: "test", RUNS_DIR: root, PATH: "/bin" },
    }, executor);

    expect(executor.sendRaw).toHaveBeenCalledWith("workspace-writer-run-1", "\r");
    const attempts = (JSON.parse(readFileSync(runJsonPath, "utf8")).runnerV2 || {}).attempts || [];
    expect(attempts[0]?.phase).toBe("instructions_submitted");
  });

  it("marks the attempt stuck when the composer never accepts the paste", async () => {
    const root = tempDir();
    writeFileSync(join(root, "chain.json"), JSON.stringify({ agents: [{ id: "writer" }] }));
    const runJsonPath = join(root, "run.json");
    writeFileSync(runJsonPath, JSON.stringify({
      id: "run-1",
      sessions: [],
      agents: [{ id: "writer", status: "pending" }],
    }));
    let sent = false;
    const executor = {
      remove: jest.fn(async () => {}),
      spawn: jest.fn(async (name: string) => ({ name, pid: 123 })),
      sendKeys: jest.fn(async (_name: string, text: string) => { if (text.includes("writer-instructions.md")) sent = true; }),
      sendRaw: jest.fn(async () => {}),
      capture: jest.fn(async () => sent ? "❯ [Pasted text #1 +7 lines]\n  statusline" : "claude ready >"),
    };

    await executeLocalBootstrap(plan(root), {
      chainPath: join(root, "chain.json"),
      runDir: root,
      runId: "run-1",
      chainName: "Test Chain",
      logFd: 1,
      cwd: "/repo",
      env: { NODE_ENV: "test", RUNS_DIR: root, PATH: "/bin" },
    }, executor);

    const attempts = (JSON.parse(readFileSync(runJsonPath, "utf8")).runnerV2 || {}).attempts || [];
    expect(attempts[0]?.phase).toBe("stuck");
    expect(executor.sendRaw.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(executor.sendRaw.mock.calls.length).toBeLessThanOrEqual(4);
    // session must be left alive for monitor rescue, and the monitor must
    // still be watching it
    expect(executor.remove).toHaveBeenCalledTimes(2); // only the pre-spawn idempotent removes
    expect(executor.spawn).toHaveBeenLastCalledWith(
      "monitor-workspace-writer-run-1",
      "bash",
      ["-lc", "monitor-chain-agent workspace-writer-run-1"],
      expect.anything(),
    );
  });

  it("does not send instructions when the agent cli readiness never appears", async () => {
    jest.useFakeTimers();
    const root = tempDir();
    writeFileSync(join(root, "run.json"), JSON.stringify({
      id: "run-1",
      sessions: [],
      agents: [{ id: "writer", status: "pending" }],
    }));
    const executor = {
      remove: jest.fn(async () => {}),
      spawn: jest.fn(async (name: string) => ({ name, pid: 123 })),
      sendKeys: jest.fn(async () => {}),
      capture: jest.fn(async () => "plain zsh shell"),
    };

    const promise = expect(executeLocalBootstrap(plan(root), {
      chainPath: join(root, "chain.json"),
      runDir: root,
      runId: "run-1",
      chainName: "Test Chain",
      logFd: 1,
      cwd: "/repo",
      env: { NODE_ENV: "test", PATH: "/bin" },
    }, executor)).rejects.toThrow("timed out waiting for agent CLI readiness");
    await jest.advanceTimersByTimeAsync(16_000);
    await promise;
    jest.useRealTimers();

    expect(executor.sendKeys).toHaveBeenCalledTimes(1);
  });
});
