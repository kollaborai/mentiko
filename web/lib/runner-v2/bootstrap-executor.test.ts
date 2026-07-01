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
