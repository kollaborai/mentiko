import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { executeLocalBootstrap } from "@/lib/runner-v2/bootstrap-executor";
import type { AgentBootstrapPlan } from "@/lib/runner-v2/agent-bootstrap-plan";
import type { RunnerV2LaunchContext } from "@/lib/runner-v2/types";

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
      chainId: "test-chain",
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

  it("ensures watchdog and chain event watcher singletons before attempt creation and pty launch", async () => {
    const root = tempDir();
    writeFileSync(join(root, "chain.json"), JSON.stringify({ agents: [{ id: "writer" }] }));
    const runJsonPath = join(root, "run.json");
    writeFileSync(runJsonPath, JSON.stringify({
      id: "run-1",
      sessions: [],
      agents: [{ id: "writer", status: "pending" }],
    }));
    const calls: Array<{ op: string; name: string; args?: unknown[] }> = [];
    const singletonAwarePlan = {
      ...plan(root),
      runContextExports: {
        ...plan(root).runContextExports,
        MENTIKO_CODE_ROOT: "/repo",
        NAMESPACE_ID: "acme",
      },
    };
    const executor = {
      has: jest.fn(async (name: string) => {
        calls.push({ op: "has", name });
        return false;
      }),
      remove: jest.fn(async (name: string) => {
        calls.push({ op: "remove", name });
      }),
      spawn: jest.fn(async (name: string, cmd?: string, args?: string[]) => {
        calls.push({ op: "spawn", name, args: [cmd, args] });
        return { name, pid: name === "workspace-writer-run-1" ? 123 : 456 };
      }),
      sendKeys: jest.fn(async (name: string) => {
        calls.push({ op: "sendKeys", name });
      }),
      capture: jest.fn(async () => "claude ready >"),
    };

    await executeLocalBootstrap(singletonAwarePlan, context(root), executor);

    expect(calls.slice(0, 7).map((call) => `${call.op}:${call.name}`)).toEqual([
      "has:mentiko-watchdog",
      "remove:mentiko-watchdog",
      "spawn:mentiko-watchdog",
      "has:mentiko-chain-watcher",
      "remove:mentiko-chain-watcher",
      "spawn:mentiko-chain-watcher",
      "remove:workspace-writer-run-1",
    ]);
    expect(executor.spawn).toHaveBeenCalledWith(
      "mentiko-watchdog",
      "bash",
      ["/repo/lib/watchdog.sh"],
      expect.objectContaining({
        cwd: "/repo",
        env: expect.objectContaining({
          MENTIKO_CODE_ROOT: "/repo",
          NAMESPACE_ID: "acme",
        }),
      }),
    );
    expect(executor.spawn).toHaveBeenCalledWith(
      "mentiko-chain-watcher",
      "bash",
      ["/repo/lib/chain-event-watcher.sh", "--namespace", "acme"],
      expect.objectContaining({
        cwd: "/repo",
        env: expect.objectContaining({
          MENTIKO_CODE_ROOT: "/repo",
          NAMESPACE_ID: "acme",
        }),
      }),
    );
    const attempts = (JSON.parse(readFileSync(runJsonPath, "utf8")).runnerV2 || {}).attempts || [];
    expect(attempts[0]?.phase).toBe("instructions_submitted");
  });

  it("does not duplicate live watchdog and chain event watcher sessions", async () => {
    const root = tempDir();
    writeFileSync(join(root, "chain.json"), JSON.stringify({ agents: [{ id: "writer" }] }));
    writeFileSync(join(root, "run.json"), JSON.stringify({
      id: "run-1",
      sessions: [],
      agents: [{ id: "writer", status: "pending" }],
    }));
    const executor = {
      has: jest.fn(async (name: string) => name === "mentiko-watchdog" || name === "mentiko-chain-watcher"),
      remove: jest.fn(async () => {}),
      spawn: jest.fn(async (name: string) => ({ name, pid: 123 })),
      sendKeys: jest.fn(async () => {}),
      capture: jest.fn(async () => "claude ready >"),
    };

    await executeLocalBootstrap(plan(root), context(root), executor);

    expect(executor.remove).not.toHaveBeenCalledWith("mentiko-watchdog");
    expect(executor.remove).not.toHaveBeenCalledWith("mentiko-chain-watcher");
    expect(executor.spawn).not.toHaveBeenCalledWith(
      "mentiko-watchdog",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(executor.spawn).not.toHaveBeenCalledWith(
      "mentiko-chain-watcher",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(executor.spawn).toHaveBeenCalledWith(
      "workspace-writer-run-1",
      "zsh",
      [],
      expect.anything(),
    );
  });

  it("keeps launch best-effort when singleton startup fails like v1", async () => {
    const root = tempDir();
    writeFileSync(join(root, "chain.json"), JSON.stringify({ agents: [{ id: "writer" }] }));
    writeFileSync(join(root, "run.json"), JSON.stringify({
      id: "run-1",
      sessions: [],
      agents: [{ id: "writer", status: "pending" }],
    }));
    const executor = {
      has: jest.fn(async (name: string) => {
        if (name === "mentiko-watchdog") throw new Error("daemon lookup failed");
        return false;
      }),
      remove: jest.fn(async () => {}),
      spawn: jest.fn(async (name: string) => ({ name, pid: 123 })),
      sendKeys: jest.fn(async () => {}),
      capture: jest.fn(async () => "claude ready >"),
    };

    await executeLocalBootstrap(plan(root), context(root), executor);

    expect(executor.spawn).toHaveBeenCalledWith(
      "workspace-writer-run-1",
      "zsh",
      [],
      expect.anything(),
    );
    const run = JSON.parse(readFileSync(join(root, "run.json"), "utf8"));
    expect(run).toMatchObject({
      sessions: ["workspace-writer-run-1"],
      agents: [expect.objectContaining({ id: "writer", status: "running" })],
    });
  });

  it("blocks before pty launch when chain concurrency cap is full", async () => {
    const root = tempDir();
    writeFileSync(join(root, "chain.json"), JSON.stringify({ agents: [{ id: "writer" }] }));
    writeFileSync(join(root, "run.json"), JSON.stringify({
      id: "run-1",
      status: "running",
      sessions: [],
      agents: [{ id: "writer", status: "pending" }],
    }));
    mkdirSync(join(root, "run-existing"), { recursive: true });
    writeFileSync(join(root, "run-existing", "run.json"), JSON.stringify({
      id: "run-existing",
      status: "running",
      sessions: ["other-agent"],
      agents: [{ id: "other", status: "running" }],
    }));
    const executor = executorWithCapture("claude ready >");

    await executeLocalBootstrap(plan(root), {
      ...context(root),
      env: {
        ...context(root).env,
        MENTIKO_MAX_CONCURRENT_CHAINS: "1",
        MENTIKO_CAP_MAX_WAIT_SECS: "0",
        MENTIKO_CAP_POLL_SECS: "0.01",
      },
    }, executor);

    expect(executor.remove).not.toHaveBeenCalled();
    expect(executor.spawn).not.toHaveBeenCalled();
    expect(executor.sendKeys).not.toHaveBeenCalled();
    const run = JSON.parse(readFileSync(join(root, "run.json"), "utf8"));
    expect(run).toMatchObject({
      status: "blocked",
      status_message: expect.stringContaining("concurrency cap: waited"),
      agents: [expect.objectContaining({ id: "writer", status: "blocked" })],
    });
    const attempts = (run.runnerV2 || {}).attempts || [];
    expect(attempts[0]).toMatchObject({
      phase: "human_action_required",
      terminalReason: "concurrency_cap_blocked",
    });
  });

  it("promotes pending to running before pty launch when a chain cap slot is available", async () => {
    const root = tempDir();
    writeProfile(root, { enabled: true, ready_patterns: [{ name: "ready", value: "claude ready" }] });
    writeFileSync(join(root, "chain.json"), JSON.stringify({ agents: [{ id: "writer" }] }));
    writeFileSync(join(root, "run.json"), JSON.stringify({
      id: "run-1",
      status: "pending",
      sessions: [],
      agents: [{ id: "writer", status: "pending" }],
    }));
    const executor = executorWithCapture("claude ready >");

    await executeLocalBootstrap(plan(root), {
      ...context(root),
      env: {
        ...context(root).env,
        MENTIKO_MAX_CONCURRENT_CHAINS: "1",
      },
    }, executor);

    expect(executor.spawn).toHaveBeenCalledWith(
      "workspace-writer-run-1",
      "zsh",
      [],
      expect.objectContaining({ cwd: join(root, "workspace") }),
    );
    const run = JSON.parse(readFileSync(join(root, "run.json"), "utf8"));
    expect(run).toMatchObject({
      status: "running",
      sessions: ["workspace-writer-run-1"],
      agents: [expect.objectContaining({ id: "writer", status: "running" })],
    });
    const attempts = (run.runnerV2 || {}).attempts || [];
    expect(attempts[0]?.transitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ to: "lease_acquired" }),
      expect.objectContaining({ to: "pty_allocated" }),
    ]));
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
      chainId: "test-chain",
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
      chainId: "test-chain",
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

  it("submits instructions for a profile-less agent in legacy mode (v1: missing profile is unknown, not blocked)", async () => {
    const previous = process.env.MENTIKO_READINESS_FAIL_CLOSED;
    delete process.env.MENTIKO_READINESS_FAIL_CLOSED;
    const root = tempDir();
    writeFileSync(join(root, "chain.json"), JSON.stringify({ agents: [{ id: "writer" }] }));
    writeFileSync(join(root, "run.json"), JSON.stringify({
      id: "run-1",
      sessions: [],
      agents: [{ id: "writer", status: "pending" }],
    }));
    // no readiness glyph, no known prompt token: the killed isLikelyAgentPrompt
    // heuristic would have polled to a timeout here; v1 treats a missing profile
    // as unknown -> legacy proceeds.
    const executor = executorWithCapture("plain zsh shell with no ready glyph");

    try {
      const noProfilePlan = { ...plan(root) };
      delete noProfilePlan.profileId;
      delete noProfilePlan.profilePath;
      await executeLocalBootstrap(noProfilePlan, context(root), executor);
    } finally {
      if (previous !== undefined) process.env.MENTIKO_READINESS_FAIL_CLOSED = previous;
    }

    expect(executor.sendKeys).toHaveBeenCalledWith("workspace-writer-run-1", expect.stringContaining("writer-instructions.md"));
    const attempts = (JSON.parse(readFileSync(join(root, "run.json"), "utf8")).runnerV2 || {}).attempts || [];
    expect(attempts[0]?.phase).toBe("instructions_submitted");
  });

  it("blocks a profile-less agent at the readiness deadline under fail-closed (no instructions)", async () => {
    const previous = process.env.MENTIKO_READINESS_FAIL_CLOSED;
    process.env.MENTIKO_READINESS_FAIL_CLOSED = "1";
    const root = tempDir();
    writeFileSync(join(root, "chain.json"), JSON.stringify({ agents: [{ id: "writer" }] }));
    writeFileSync(join(root, "run.json"), JSON.stringify({
      id: "run-1",
      sessions: [],
      agents: [{ id: "writer", status: "pending" }],
    }));
    const executor = executorWithCapture("plain zsh shell");

    try {
      const noProfilePlan = { ...plan(root) };
      delete noProfilePlan.profileId;
      delete noProfilePlan.profilePath;
      noProfilePlan.runContextExports = {
        ...noProfilePlan.runContextExports,
        MENTIKO_CLI_READY_TIMEOUT: "0.1",
        MENTIKO_CLI_READY_POLL: "0.02",
      };
      await executeLocalBootstrap(noProfilePlan, context(root), executor);
    } finally {
      if (previous === undefined) delete process.env.MENTIKO_READINESS_FAIL_CLOSED;
      else process.env.MENTIKO_READINESS_FAIL_CLOSED = previous;
    }

    expect(executor.sendKeys).toHaveBeenCalledTimes(1);
    expect(executor.remove).toHaveBeenCalledTimes(1);
    const run = JSON.parse(readFileSync(join(root, "run.json"), "utf8"));
    expect(run).toMatchObject({
      status: "blocked",
      blockedReason: expect.stringContaining("startup_recovery:unknown"),
      agents: [expect.objectContaining({ id: "writer", status: "blocked" })],
    });
    expect(readFileSync(join(root, "state", "writer-run-1.state"), "utf8")).toContain("status: blocked");
    expect(readFileSync(join(root, "artifacts", "writer-startup-capture.txt"), "utf8")).toBe("plain zsh shell");
    expect(JSON.parse(readFileSync(join(root, "artifacts", "writer-startup-readiness.json"), "utf8"))).toMatchObject({
      status: "unknown",
    });
    const attempts = (run.runnerV2 || {}).attempts || [];
    expect(attempts[0]).toMatchObject({ terminalReason: "readiness_deadline_expired" });
    expect(attempts[0]?.transitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ to: "startup_failed", reason: "readiness_deadline_expired" }),
    ]));
  });

  it("uses the selected profile ready pattern instead of generic prompt heuristics", async () => {
    const root = tempDir();
    writeProfile(root, {
      enabled: true,
      ready_patterns: [{ name: "provider-ready", type: "text", value: "Provider boot complete" }],
    });
    writeFileSync(join(root, "chain.json"), JSON.stringify({ agents: [{ id: "writer" }] }));
    writeFileSync(join(root, "run.json"), JSON.stringify({
      id: "run-1",
      sessions: [],
      agents: [{ id: "writer", status: "pending" }],
    }));
    const executor = executorWithCapture("Provider boot complete\nno prompt glyph yet");

    await executeLocalBootstrap(plan(root), context(root), executor);

    expect(executor.sendKeys).toHaveBeenCalledWith("workspace-writer-run-1", expect.stringContaining("writer-instructions.md"));
    const attempts = (JSON.parse(readFileSync(join(root, "run.json"), "utf8")).runnerV2 || {}).attempts || [];
    expect(attempts[0]?.phase).toBe("instructions_submitted");
  });

  it.each([
    {
      label: "blocked",
      readiness: { enabled: true, blocked_patterns: [{ name: "auth-required", value: "Log in required", action: "block" }] },
      output: "Log in required\nclaude ready >",
      terminalPhase: "human_action_required",
      reason: "readiness_policy_blocked",
    },
    {
      label: "recover",
      readiness: { enabled: true, recoverable_patterns: [{ name: "mcp-auth", value: "MCP auth refresh needed", action: "recover" }] },
      output: "MCP auth refresh needed\nclaude ready >",
      terminalPhase: "startup_failed",
      reason: "readiness_policy_recoverable",
    },
    {
      label: "retry",
      readiness: { enabled: true, retry_patterns: [{ name: "rate-limit", value: "Rate limit exceeded", action: "retry" }] },
      output: "Rate limit exceeded\nclaude ready >",
      terminalPhase: "startup_failed",
      reason: "readiness_policy_retry",
    },
  ])("blocks without killing the session when the selected profile reports $label readiness", async ({ readiness, output, terminalPhase, reason }) => {
    const root = tempDir();
    writeProfile(root, readiness);
    writeFileSync(join(root, "chain.json"), JSON.stringify({ agents: [{ id: "writer" }] }));
    writeFileSync(join(root, "run.json"), JSON.stringify({
      id: "run-1",
      sessions: [],
      agents: [{ id: "writer", status: "pending" }],
    }));
    const executor = executorWithCapture(output);

    await executeLocalBootstrap(plan(root), context(root), executor);

    expect(executor.sendKeys).toHaveBeenCalledTimes(1);
    expect(executor.remove).toHaveBeenCalledTimes(1);
    const run = JSON.parse(readFileSync(join(root, "run.json"), "utf8"));
    expect(run).toMatchObject({
      status: "blocked",
      blockedReason: expect.stringContaining("startup_recovery:"),
      agents: [expect.objectContaining({ id: "writer", status: "blocked" })],
    });
    expect(readFileSync(join(root, "state", "writer-run-1.state"), "utf8")).toContain("status: blocked");
    expect(readFileSync(join(root, "artifacts", "writer-startup-capture.txt"), "utf8")).toBe(output);
    expect(JSON.parse(readFileSync(join(root, "artifacts", "writer-startup-readiness.json"), "utf8"))).toMatchObject({
      status: readiness.recoverable_patterns ? "recover" : readiness.retry_patterns ? "retry" : "blocked",
    });
    const attempts = (run.runnerV2 || {}).attempts || [];
    expect(attempts[0]).toMatchObject({ terminalReason: reason });
    expect(attempts[0]?.transitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ to: terminalPhase, reason }),
    ]));
  });

  it("does not inject instructions when fail-closed is on and the selected profile has no ready signal", async () => {
    const previous = process.env.MENTIKO_READINESS_FAIL_CLOSED;
    process.env.MENTIKO_READINESS_FAIL_CLOSED = "1";
    const root = tempDir();
    writeProfile(root, { enabled: true, blocked_patterns: [{ name: "blocked", value: "blocked" }] });
    writeFileSync(join(root, "chain.json"), JSON.stringify({ agents: [{ id: "writer" }] }));
    writeFileSync(join(root, "run.json"), JSON.stringify({
      id: "run-1",
      sessions: [],
      agents: [{ id: "writer", status: "pending" }],
    }));
    const executor = executorWithCapture("claude ready >");

    try {
      await executeLocalBootstrap(plan(root), context(root), executor);
    } finally {
      if (previous === undefined) delete process.env.MENTIKO_READINESS_FAIL_CLOSED;
      else process.env.MENTIKO_READINESS_FAIL_CLOSED = previous;
    }

    expect(executor.sendKeys).toHaveBeenCalledTimes(1);
    expect(executor.remove).toHaveBeenCalledTimes(1);
    const run = JSON.parse(readFileSync(join(root, "run.json"), "utf8"));
    expect(run).toMatchObject({
      status: "blocked",
      blockedReason: expect.stringContaining("startup_recovery:no_ready_signal"),
      agents: [expect.objectContaining({ id: "writer", status: "blocked" })],
    });
    expect(readFileSync(join(root, "state", "writer-run-1.state"), "utf8")).toContain("status: blocked");
    expect(readFileSync(join(root, "artifacts", "writer-startup-capture.txt"), "utf8")).toBe("claude ready >");
    expect(JSON.parse(readFileSync(join(root, "artifacts", "writer-startup-readiness.json"), "utf8"))).toMatchObject({
      status: "no_ready_signal",
    });
    const attempts = (run.runnerV2 || {}).attempts || [];
    expect(attempts[0]).toMatchObject({ terminalReason: "readiness_no_ready_signal" });
    expect(attempts[0]?.transitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ to: "startup_failed", reason: "readiness_no_ready_signal" }),
    ]));
  });

  it("preserves legacy permissive readiness when the selected profile policy is disabled and fail-closed is off", async () => {
    const previous = process.env.MENTIKO_READINESS_FAIL_CLOSED;
    delete process.env.MENTIKO_READINESS_FAIL_CLOSED;
    const root = tempDir();
    writeProfile(root, { enabled: false });
    writeFileSync(join(root, "chain.json"), JSON.stringify({ agents: [{ id: "writer" }] }));
    writeFileSync(join(root, "run.json"), JSON.stringify({
      id: "run-1",
      sessions: [],
      agents: [{ id: "writer", status: "pending" }],
    }));
    const executor = executorWithCapture("plain startup text with no generic prompt");

    try {
      await executeLocalBootstrap(plan(root), context(root), executor);
    } finally {
      if (previous !== undefined) process.env.MENTIKO_READINESS_FAIL_CLOSED = previous;
    }

    expect(executor.sendKeys).toHaveBeenCalledWith("workspace-writer-run-1", expect.stringContaining("writer-instructions.md"));
    const attempts = (JSON.parse(readFileSync(join(root, "run.json"), "utf8")).runnerV2 || {}).attempts || [];
    expect(attempts[0]?.phase).toBe("instructions_submitted");
  });
});

function context(root: string): RunnerV2LaunchContext {
  return {
    chainPath: join(root, "chain.json"),
    runDir: root,
    runId: "run-1",
    chainId: "test-chain",
    chainName: "Test Chain",
    logFd: 1,
    cwd: "/repo",
    env: { NODE_ENV: "test" as const, RUNS_DIR: root, PATH: "/bin" },
  };
}

function writeProfile(root: string, readiness: unknown) {
  mkdirSync(join(root, "profiles"), { recursive: true });
  writeFileSync(join(root, "profiles", "default.json"), JSON.stringify({
    id: "default",
    name: "Default",
    cli: "claude",
    readiness,
  }));
}

function executorWithCapture(output: string) {
  return {
    remove: jest.fn(async () => {}),
    spawn: jest.fn(async (name: string) => ({ name, pid: 123 })),
    sendKeys: jest.fn(async () => {}),
    sendRaw: jest.fn(async () => {}),
    capture: jest.fn(async () => output),
  };
}
