import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { assertTypedMonitorRuntimeAvailable, buildTypedCompletionContract, executeLocalBootstrap } from "@/lib/runner-v2/bootstrap-executor";
import { startLaunch } from "@/lib/runner-v2/adapters";
import { createRunRecord, updateRunJson, type RunStatus } from "@/lib/runner-v2/run-state";
import { createRunRecordFile } from "@/lib/runs/run-record";
import type { AgentBootstrapPlan } from "@/lib/runner-v2/agent-bootstrap-plan";
import type { RunnerV2LaunchContext } from "@/lib/runner-v2/types";

jest.mock("@/lib/api/audit-exec", () => ({
  shellEscape: (value: string) => `'${value.replace(/'/g, "'\\''")}'`,
}));

function tempDir() {
  return mkdtempSync(join(tmpdir(), "runner-v2-bootstrap-exec-"));
}

function seedRunJson(root: string, status: RunStatus = "pending"): string {
  const runJsonPath = join(root, "run.json");
  updateRunJson(runJsonPath, () => ({
    ...createRunRecord({ runId: "run-1", chainName: "Test Chain", goal: "bootstrap test" }),
    status,
    agents: [{ id: "writer", name: "Writer", session: "", status: "pending" }],
  }));
  return runJsonPath;
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
    sourceWorkspacePath: join(root, "workspace"),
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
    localStartCommand: "eval \"$(node '/repo/lib/runner-agent-profile.js' command --profile-path '/tmp/profile.json' --interactive true --namespace-id 'default' --org-id 'default')\"",
    monitorSpec: {
      chainPath: join(root, "chain.json"),
      emits: "done",
      interval: "5",
      maxStale: "5",
      runId: "run-1",
    },
    monitorCommand: "monitor-chain-agent workspace-writer-run-1",
  };
}

function routedPlan(root: string, agentId: string, agentName: string, emits: string): AgentBootstrapPlan {
  const base = plan(root);
  const sessionName = `workspace-${agentId}-run-1`;
  return {
    ...base,
    agentId,
    agentName,
    sessionPrefix: agentId,
    sessionName,
    monitorSessionName: `monitor-${sessionName}`,
    statePath: join(root, "state", `${agentId}-run-1.state`),
    instructionPath: join(root, "artifacts", `${agentId}-instructions.md`),
    instructionPointer: `Read ${join(root, "artifacts", `${agentId}-instructions.md`)}`,
    monitorCommand: `monitor-chain-agent ${sessionName}`,
    runContextExports: {
      ...base.runContextExports,
      MENTIKO_AGENT_ID: agentId,
      MENTIKO_AGENT_EMITS: emits,
    },
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

  it("fails before PTY allocation when the compiled typed monitor bundle is absent", () => {
    const root = tempDir();

    expect(() => assertTypedMonitorRuntimeAvailable(root)).toThrow(
      `typed monitor runtime bundle missing: ${join(root, "lib", "monitor-v2.js")}`,
    );
  });

  it("accepts a concrete compiled typed monitor bundle", () => {
    const root = tempDir();
    const monitor = join(root, "lib", "monitor-v2.js");
    mkdirSync(join(root, "lib"), { recursive: true });
    writeFileSync(monitor, "#!/usr/bin/env node\n");

    expect(() => assertTypedMonitorRuntimeAvailable(root)).not.toThrow();
  });

  it("builds an exact typed completion contract for declared emits", () => {
    const root = tempDir();
    const contract = buildTypedCompletionContract({
      agentId: "writer",
      artifactsDir: join(root, "artifacts"),
      eventsDir: join(root, "events"),
      runContextExports: {
        MENTIKO_RUN_ID: "run-1",
        RUN_ID: "run-1",
        MENTIKO_AGENT_ID: "writer",
        MENTIKO_AGENT_EMITS: "done",
      },
    });

    expect(contract).toContain("Run context: RUN_ID=run-1, MENTIKO_AGENT_ID=writer");
    expect(contract).toContain(`- ${join(root, "artifacts", "writer-summary.json")}`);
    expect(contract).toContain(`- ${join(root, "artifacts", "writer-summary.md")}`);
    expect(contract).toContain("mentiko emit done");
    expect(contract).toContain("Do NOT hand-write any .event file.");
    expect(contract).toContain("Do not put literal line breaks inside JSON strings");
    expect(contract).toContain("Before emitting completion, validate the summary with: node -e");
    expect(contract).toContain("The final non-empty line must be exactly AGENT_COMPLETE.");
    expect(contract.split("\n")).toContain("The completion marker line must contain exactly the token AGENT_COMPLETE and nothing else.");
    expect(contract.split("\n")).toContain("The final non-empty line must be exactly AGENT_COMPLETE. Do not write anything after it. Do not put AGENT_COMPLETE inside files or earlier in your response.");
  });

  it("keeps generation-result punctuation exact in the core-generation contract", () => {
    const contract = buildTypedCompletionContract({
      agentId: "generator",
      artifactsDir: "/run/artifacts",
      eventsDir: "/run/events",
      coreGenerationChain: true,
      runContextExports: {
        MENTIKO_RUN_ID: "run-generation",
        MENTIKO_AGENT_ID: "generator",
        MENTIKO_AGENT_EMITS: "generation-complete",
      },
    });

    expect(contract).toContain("/run/artifacts/generation-result.json.");
    expect(contract).not.toContain("generation-result.json.\",,");
    expect(contract).toContain("mentiko emit generation-complete");
    expect(contract).toContain("the generation file remains authoritative.");
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
    const runJsonPath = seedRunJson(root);

    const typedPlan = plan(root);
    typedPlan.runContextExports.TASK_ID = "TASK-12";
    typedPlan.runContextExports.TASK_CONTEXT = "TASK ID: TASK-12\nTITLE: Typed task";
    await executeLocalBootstrap(typedPlan, {
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

    const instructions = readFileSync(join(root, "artifacts", "writer-instructions.md"), "utf8");
    expect(instructions).toContain("Agent-ID: writer");
    expect(instructions).toContain("COMPLETION CONTRACT:");
    expect(instructions).toContain("Run context: RUN_ID=run-1, MENTIKO_AGENT_ID=writer");
    expect(instructions).toContain(`Event root: EVENTS_DIR=${join(root, "events")}`);
    expect(instructions).toContain(`Artifact root: ARTIFACTS_DIR=${join(root, "artifacts")}`);
    expect(instructions).toContain(join(root, "artifacts", "writer-summary.json"));
    expect(instructions).toContain(join(root, "artifacts", "writer-summary.md"));
    expect(instructions).toContain("mentiko emit done");
    expect(instructions).toContain("Do NOT hand-write any .event file.");
    expect(instructions).toContain("Typed task context:");
    expect(instructions).toContain("TASK ID: TASK-12\nTITLE: Typed task");
    expect(instructions).not.toContain("ensure-event-file");
    expect(instructions).not.toContain("monitor-chain-agent");
    const startScript = readFileSync(join(root, "artifacts", "writer-start.sh"), "utf8");
    expect(startScript).toContain("runner-agent-profile.js");
    expect(startScript).not.toContain("SECRET_THAT_MUST_NOT_BE_IN_SCRIPT");
    expect(startScript).not.toContain("chain-runner.sh");
    expect(calls.map((call) => call.op)).toEqual(["remove", "spawn", "sendKeys", "sendKeys", "remove", "spawn"]);
    expect(executor.sendKeys).toHaveBeenNthCalledWith(
      1,
      "workspace-writer-run-1",
      // no trailing \r: the daemon appends the return itself (sendKeys sets enter:true)
      `cd '${join(root, "workspace")}' && bash '${join(root, "artifacts", "writer-start.sh")}' || exit $?`,
    );
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

  it("launches a Git-backed agent in its run-owned worktree with baseline evidence", async () => {
    const root = tempDir();
    const workspace = initializeGitWorkspace(root);
    writeFileSync(join(workspace, "component.ts"), "export const value = 'preexisting-dirty';\n");
    writeFileSync(join(root, "chain.json"), JSON.stringify({ agents: [{ id: "writer" }] }));
    const runJsonPath = seedRunJson(root);
    const executor = executorWithCapture("claude ready >");

    await executeLocalBootstrap(plan(root), {
      ...context(root),
      workspacePath: workspace,
    }, executor);

    const run = JSON.parse(readFileSync(runJsonPath, "utf8"));
    expect(run.workspaceExecution).toMatchObject({
      tracking: "git",
      isolation: "git-worktree",
      concurrentWritesIsolated: true,
      baseline: { dirtyFromHead: true },
      baselineRef: expect.stringContaining("refs/mentiko/runs/"),
      integrationRef: expect.stringContaining("refs/mentiko/runs/"),
      handoffs: [{
        agentId: "writer",
        tracking: "git",
        nodeWorkspaceRecordPath: expect.any(String),
      }],
    });
    const handoffPath = run.workspaceExecution.handoffs[0].artifactPath as string;
    const handoff = JSON.parse(readFileSync(handoffPath, "utf8"));
    expect(handoff).toMatchObject({
      kind: "workspace-handoff",
      tracking: "git",
      isolation: "git-worktree",
      concurrentWritesIsolated: true,
      workspacePath: expect.stringContaining(".internal/workspace-isolation/worktrees/"),
      nodeBaseCommit: run.workspaceExecution.baseline.snapshotCommit,
      changeSet: { summary: { filesChanged: 0 } },
    });
    const agentSpawn = executor.spawn.mock.calls.find((call) => call[0] === "workspace-writer-run-1");
    expect(agentSpawn?.[3]).toMatchObject({
      cwd: handoff.workspacePath,
      env: expect.objectContaining({ MENTIKO_PROJECT_ROOT: handoff.workspacePath }),
    });
    expect(handoff.workspacePath).not.toBe(workspace);
    expect(readFileSync(join(workspace, "component.ts"), "utf8")).toContain("preexisting-dirty");
    const instructions = readFileSync(join(root, "artifacts", "writer-instructions.md"), "utf8");
    expect(instructions).toContain("WORKSPACE EVIDENCE:");
    expect(instructions).toContain(`Run baseline artifact: ${run.workspaceExecution.baselineArtifactPath}`);
    expect(instructions).toContain(`Agent handoff artifact: ${handoffPath}`);
    expect(instructions).toContain("HEAD is not the run baseline.");
    expect(instructions).toContain("the handoff artifact changeSet is the authoritative task delta");
    expect(instructions).toContain("Isolation: dedicated Git worktree (concurrent node writes are isolated).");
    expect(instructions).toContain(`Node workspace: ${handoff.workspacePath}`);
  });

  it("leaves watcher and watchdog ownership with the background worker", async () => {
    const root = tempDir();
    writeFileSync(join(root, "chain.json"), JSON.stringify({ agents: [{ id: "writer" }] }));
    seedRunJson(root);
    const executor = {
      has: jest.fn(async () => false),
      remove: jest.fn(async () => {}),
      spawn: jest.fn(async (name: string) => ({ name, pid: 123 })),
      sendKeys: jest.fn(async () => {}),
      capture: jest.fn(async () => "claude ready >"),
    };

    await executeLocalBootstrap(plan(root), context(root), executor);

    expect(executor.has).not.toHaveBeenCalled();
    expect(executor.remove).not.toHaveBeenCalledWith("mentiko-watchdog");
    expect(executor.remove).not.toHaveBeenCalledWith("mentiko-chain-watcher");
    expect(executor.spawn.mock.calls.map((call) => call[0])).not.toEqual(
      expect.arrayContaining(["mentiko-watchdog", "mentiko-chain-watcher"]),
    );
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

  it("registers a routed target that is absent from a shell-created run", async () => {
    const root = tempDir();
    writeFileSync(join(root, "chain.json"), JSON.stringify({ agents: [{ id: "writer" }] }));
    const runJsonPath = join(root, "run.json");
    updateRunJson(runJsonPath, () => ({
      ...createRunRecord({ runId: "run-1", chainName: "Test Chain", goal: "bootstrap test" }),
      status: "running",
      agents: [],
    }));
    const executor = executorWithCapture("claude ready >");

    await executeLocalBootstrap(plan(root), context(root), executor);

    expect(JSON.parse(readFileSync(runJsonPath, "utf8"))).toMatchObject({
      status: "running",
      sessions: ["workspace-writer-run-1"],
      agents: [{
        id: "writer",
        name: "Writer",
        status: "running",
        session: "workspace-writer-run-1",
        started: expect.any(String),
      }],
    });
  });

  it("rejects a terminal run before stale state can relaunch an already completed agent", async () => {
    const root = tempDir();
    writeFileSync(join(root, "chain.json"), JSON.stringify({ agents: [{ id: "writer" }] }));
    const runJsonPath = seedRunJson(root, "completed");
    mkdirSync(join(root, "state"), { recursive: true });
    writeFileSync(join(root, "state", "writer-run-1.state"), "session: workspace-writer-run-1\nagent_id: writer\nstatus: completed\n");
    updateRunJson(runJsonPath, (run) => ({
      ...run!,
      agents: [{ id: "writer", name: "Writer", session: "workspace-writer-run-1", status: "complete" }],
      runnerV2: {
        attempts: [{
          id: "run-1:writer:1",
          runId: "run-1",
          agentId: "writer",
          phase: "completed",
          desiredPhase: "completed",
          observedPhase: "completed",
          terminalReason: "completed_from_event",
          instructionLedger: [],
          recoveryDecisionCount: 0,
          createdAt: "2026-07-15T00:00:00.000Z",
          updatedAt: "2026-07-15T00:01:00.000Z",
          transitions: [],
        }],
      },
    }));
    const executor = executorWithCapture("claude ready >");

    await expect(executeLocalBootstrap(plan(root), context(root), executor)).rejects.toThrow(
      "run run-1 is terminal (completed)",
    );

    expect(executor.spawn).not.toHaveBeenCalled();
    expect(executor.sendKeys).not.toHaveBeenCalled();
    expect(readFileSync(join(root, "state", "writer-run-1.state"), "utf8")).toContain("status: completed");
    expect(JSON.parse(readFileSync(runJsonPath, "utf8"))).toMatchObject({
      status: "completed",
      runnerV2: { attempts: [expect.objectContaining({ phase: "completed" })] },
    });
  });

  it("rejects an unscoped relaunch when the target AgentAttempt is terminal", async () => {
    const root = tempDir();
    writeFileSync(join(root, "chain.json"), JSON.stringify({ agents: [{ id: "writer" }] }));
    const runJsonPath = seedRunJson(root, "running");
    updateRunJson(runJsonPath, (run) => ({
      ...run!,
      agents: [{ id: "writer", name: "Writer", session: "writer-run-1", status: "complete" }],
      runnerV2: {
        attempts: [{
          id: "run-1:writer:1",
          runId: "run-1",
          agentId: "writer",
          phase: "completed",
          desiredPhase: "completed",
          observedPhase: "completed",
          terminalReason: "completed_from_event",
          instructionLedger: [],
          recoveryDecisionCount: 0,
          createdAt: "2026-07-15T00:00:00.000Z",
          updatedAt: "2026-07-15T00:01:00.000Z",
          transitions: [],
        }],
      },
    }));
    const executor = executorWithCapture("claude ready >");

    await expect(executeLocalBootstrap(plan(root), context(root), executor)).rejects.toThrow(
      "agent writer has terminal attempt run-1:writer:1 (completed)",
    );
    expect(executor.spawn).not.toHaveBeenCalled();
  });

  it("allows the resume route's durable resumedAt to create a fresh typed attempt", async () => {
    const root = tempDir();
    writeFileSync(join(root, "chain.json"), JSON.stringify({ agents: [{ id: "writer" }] }));
    const runJsonPath = seedRunJson(root, "running");
    updateRunJson(runJsonPath, (run) => ({
      ...run!,
      resumedAt: "2026-07-15T00:02:00.000Z",
      runnerV2: {
        attempts: [{
          id: "run-1:writer:1",
          runId: "run-1",
          agentId: "writer",
          phase: "completed",
          desiredPhase: "completed",
          observedPhase: "completed",
          terminalReason: "completed_from_event",
          instructionLedger: [],
          recoveryDecisionCount: 0,
          createdAt: "2026-07-15T00:00:00.000Z",
          updatedAt: "2026-07-15T00:01:00.000Z",
          transitions: [],
        }],
      },
    }));
    const executor = executorWithCapture("claude ready >");

    await executeLocalBootstrap(plan(root), context(root), executor);

    expect(executor.spawn).toHaveBeenCalledWith(
      "workspace-writer-run-1",
      "zsh",
      [],
      expect.objectContaining({ cwd: join(root, "workspace") }),
    );
    const run = JSON.parse(readFileSync(runJsonPath, "utf8"));
    expect(run.runnerV2.attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "run-1:writer:1", phase: "completed" }),
      expect.objectContaining({ id: "run-1:writer:2", leaseId: "workspace-writer-run-1" }),
    ]));
  });

  it("makes two absent fan-out targets durably acceptable through real bootstrap registration", async () => {
    const root = tempDir();
    const runJsonPath = join(root, "run.json");
    writeFileSync(join(root, "chain.json"), JSON.stringify({
      agents: [{ id: "writer" }, { id: "designer" }, { id: "editor" }],
    }));
    updateRunJson(runJsonPath, () => ({
      ...createRunRecord({ runId: "run-1", chainName: "Test Chain", goal: "bootstrap test" }),
      status: "running",
      agents: [{ id: "writer", name: "Writer", session: "writer-run-1", status: "complete" }],
      sessions: ["writer-run-1"],
    }));
    const executor = executorWithCapture("claude ready >");
    const designer = routedPlan(root, "designer", "Designer", "designer-done");
    const editor = routedPlan(root, "editor", "Editor", "editor-done");

    await executeLocalBootstrap(designer, context(root), executor);
    await executeLocalBootstrap(editor, context(root), executor);

    const adapterContext = { runJsonPath, stateDir: join(root, "state") };
    expect(startLaunch({
      kind: "fan-out",
      agentIds: ["designer"],
      command: "must not spawn: designer already accepted",
      env: { MENTIKO_RUN_ID: "run-1" },
    }, adapterContext)).toMatchObject({
      targets: [expect.objectContaining({ agentId: "designer", session: "workspace-designer-run-1" })],
    });
    expect(startLaunch({
      kind: "fan-out",
      agentIds: ["editor"],
      command: "must not spawn: editor already accepted",
      env: { MENTIKO_RUN_ID: "run-1" },
    }, adapterContext)).toMatchObject({
      targets: [expect.objectContaining({ agentId: "editor", session: "workspace-editor-run-1" })],
    });
    expect(JSON.parse(readFileSync(runJsonPath, "utf8"))).toMatchObject({
      agents: expect.arrayContaining([
        expect.objectContaining({ id: "designer", status: "running", session: "workspace-designer-run-1" }),
        expect.objectContaining({ id: "editor", status: "running", session: "workspace-editor-run-1" }),
      ]),
    });
  });

  it("blocks before pty launch when chain concurrency cap is full", async () => {
    const root = tempDir();
    writeFileSync(join(root, "chain.json"), JSON.stringify({ agents: [{ id: "writer" }] }));
    seedRunJson(root, "running");
    createRunRecordFile(root, {
      ...createRunRecord({ runId: "run-existing", chainName: "Existing Chain", goal: "hold capacity" }),
      status: "running",
      sessions: ["other-agent"],
      agents: [{ id: "other", name: "Other", session: "other-agent", status: "running" }],
    });
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
    seedRunJson(root);
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
    const runJsonPath = seedRunJson(root);
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
    const runJsonPath = seedRunJson(root);
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

  it("bounds a stalled composer capture by the submission deadline and leaves monitor recovery active", async () => {
    const previousDeadline = process.env.MENTIKO_RUNNER_V2_SUBMISSION_DEADLINE_MS;
    process.env.MENTIKO_RUNNER_V2_SUBMISSION_DEADLINE_MS = "20";
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-09T00:00:00.000Z"));

    try {
      const root = tempDir();
      const runJsonPath = seedRunJson(root);
      writeFileSync(join(root, "chain.json"), JSON.stringify({ agents: [{ id: "writer" }] }));
      let captureCount = 0;
      const executor = {
        remove: jest.fn(async () => {}),
        spawn: jest.fn(async (name: string) => ({ name, pid: 123 })),
        sendKeys: jest.fn(async () => {}),
        sendRaw: jest.fn(async () => {}),
        capture: jest.fn(() => {
          captureCount += 1;
          if (captureCount === 1) return Promise.resolve("claude ready >");
          // Models the PTY client's independent 10s socket timeout. The
          // submission confirmation must finish at 20ms without waiting for it.
          return new Promise<string>((resolve) => setTimeout(() => resolve("❯ Read instructions"), 10_000));
        }),
      };

      const startedAt = Date.now();
      const bootstrap = executeLocalBootstrap(plan(root), context(root), executor);
      await flushMicrotasks();
      await jest.advanceTimersByTimeAsync(20);
      await expect(bootstrap).resolves.toBeUndefined();

      expect(Date.now() - startedAt).toBeLessThanOrEqual(20);
      expect(executor.capture).toHaveBeenCalledTimes(2);
      expect(executor.sendRaw).not.toHaveBeenCalled();
      const attempts = (JSON.parse(readFileSync(runJsonPath, "utf8")).runnerV2 || {}).attempts || [];
      expect(attempts[0]?.phase).toBe("stuck");
      expect(executor.spawn).toHaveBeenLastCalledWith(
        "monitor-workspace-writer-run-1",
        "bash",
        ["-lc", "monitor-chain-agent workspace-writer-run-1"],
        expect.anything(),
      );
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
      if (previousDeadline === undefined) delete process.env.MENTIKO_RUNNER_V2_SUBMISSION_DEADLINE_MS;
      else process.env.MENTIKO_RUNNER_V2_SUBMISSION_DEADLINE_MS = previousDeadline;
    }
  });

  it("bounds a stalled bare-enter retry by the submission deadline", async () => {
    const previousDeadline = process.env.MENTIKO_RUNNER_V2_SUBMISSION_DEADLINE_MS;
    process.env.MENTIKO_RUNNER_V2_SUBMISSION_DEADLINE_MS = "20";
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-09T00:00:00.000Z"));

    try {
      const root = tempDir();
      const runJsonPath = seedRunJson(root);
      writeFileSync(join(root, "chain.json"), JSON.stringify({ agents: [{ id: "writer" }] }));
      const captures = ["claude ready >", "❯ Read instructions"];
      const executor = {
        remove: jest.fn(async () => {}),
        spawn: jest.fn(async (name: string) => ({ name, pid: 123 })),
        sendKeys: jest.fn(async () => {}),
        sendRaw: jest.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 10_000))),
        capture: jest.fn(async () => captures.shift() || "❯ Read instructions"),
      };

      const startedAt = Date.now();
      const bootstrap = executeLocalBootstrap(plan(root), context(root), executor);
      await flushMicrotasks();
      await jest.advanceTimersByTimeAsync(20);
      await expect(bootstrap).resolves.toBeUndefined();

      expect(Date.now() - startedAt).toBeLessThanOrEqual(20);
      expect(executor.sendRaw).toHaveBeenCalledTimes(1);
      const attempts = (JSON.parse(readFileSync(runJsonPath, "utf8")).runnerV2 || {}).attempts || [];
      expect(attempts[0]?.phase).toBe("stuck");
      expect(executor.spawn).toHaveBeenLastCalledWith(
        "monitor-workspace-writer-run-1",
        "bash",
        ["-lc", "monitor-chain-agent workspace-writer-run-1"],
        expect.anything(),
      );
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
      if (previousDeadline === undefined) delete process.env.MENTIKO_RUNNER_V2_SUBMISSION_DEADLINE_MS;
      else process.env.MENTIKO_RUNNER_V2_SUBMISSION_DEADLINE_MS = previousDeadline;
    }
  });

  it("submits instructions for a profile-less agent in legacy mode (v1: missing profile is unknown, not blocked)", async () => {
    const previous = process.env.MENTIKO_READINESS_FAIL_CLOSED;
    delete process.env.MENTIKO_READINESS_FAIL_CLOSED;
    const root = tempDir();
    writeFileSync(join(root, "chain.json"), JSON.stringify({ agents: [{ id: "writer" }] }));
    seedRunJson(root);
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
    seedRunJson(root);
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
      completed: expect.any(String),
      blockedReason: expect.stringContaining("startup_recovery:unknown"),
      agents: [expect.objectContaining({ id: "writer", status: "blocked" })],
    });
    expect(run.agents[0].completed).toBeUndefined();
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
    seedRunJson(root);
    const executor = executorWithCapture("Provider boot complete\nno prompt glyph yet");

    await executeLocalBootstrap(plan(root), context(root), executor);

    expect(executor.sendKeys).toHaveBeenCalledWith("workspace-writer-run-1", expect.stringContaining("writer-instructions.md"));
    const attempts = (JSON.parse(readFileSync(join(root, "run.json"), "utf8")).runnerV2 || {}).attempts || [];
    expect(attempts[0]?.phase).toBe("instructions_submitted");
  });

  it("applies a bounded typed startup recovery decision before submitting instructions", async () => {
    const root = tempDir();
    const profilesDir = join(root, "profiles");
    const advisorCli = join(root, "advisor-cli.sh");
    writeProfile(root, {
      enabled: true,
      ready_patterns: [{ name: "ready", type: "text", value: "Provider boot complete" }],
      recoverable_patterns: [{ name: "press-enter", type: "text", value: "Press Enter", action: "recover", risk: "low" }],
    });
    writeFileSync(advisorCli, [
      "#!/usr/bin/env bash",
      "cat >/dev/null",
      "printf '%s\\n' '{\"action\":\"send_keys\",\"keys\":[\"ENTER\"],\"confidence\":0.99,\"risk\":\"low\",\"reason\":\"benign startup prompt\"}'",
      "",
    ].join("\n"));
    chmodSync(advisorCli, 0o700);
    writeFileSync(join(profilesDir, "advisor.json"), JSON.stringify({
      id: "advisor",
      name: "Advisor",
      cli: advisorCli,
      isAdvisorDefault: true,
    }));
    writeFileSync(join(root, "chain.json"), JSON.stringify({ agents: [{ id: "writer" }] }));
    const runJsonPath = seedRunJson(root);
    let captureCount = 0;
    const executor = {
      remove: jest.fn(async () => {}),
      spawn: jest.fn(async (name: string) => ({ name, pid: 123 })),
      sendKeys: jest.fn(async () => {}),
      sendRaw: jest.fn(async () => {}),
      capture: jest.fn(async () => {
        captureCount += 1;
        return captureCount === 1 ? "Press Enter to continue" : "Provider boot complete";
      }),
    };
    const recoveryPlan = plan(root);
    recoveryPlan.runContextExports = {
      ...recoveryPlan.runContextExports,
      AGENT_PROFILES_DIR: profilesDir,
      MENTIKO_STARTUP_RECOVERY: "1",
      MENTIKO_STARTUP_RECOVERY_MAX: "1",
    };

    await executeLocalBootstrap(recoveryPlan, context(root), executor);

    expect(executor.sendRaw).toHaveBeenCalledWith("workspace-writer-run-1", "\r");
    expect(readFileSync(join(root, "artifacts", "writer-startup-recovery-decisions.jsonl"), "utf8")).toContain(
      "\"action\":\"send_keys\"",
    );
    const attempts = (JSON.parse(readFileSync(runJsonPath, "utf8")).runnerV2 || {}).attempts || [];
    expect(attempts[0]).toMatchObject({
      phase: "instructions_submitted",
      recoveryDecisionCount: 1,
    });
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
    seedRunJson(root);
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
    seedRunJson(root);
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
    seedRunJson(root);
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
    spawn: jest.fn(async (
      name: string,
      _cmd?: string,
      _args?: string[],
      _opts?: { cwd?: string; env?: Record<string, string> },
    ) => ({ name, pid: 123 })),
    sendKeys: jest.fn(async () => {}),
    sendRaw: jest.fn(async () => {}),
    capture: jest.fn(async () => output),
  };
}

function initializeGitWorkspace(root: string): string {
  const workspace = join(root, "workspace");
  mkdirSync(workspace, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: workspace });
  execFileSync("git", ["config", "user.name", "Bootstrap Test"], { cwd: workspace });
  execFileSync("git", ["config", "user.email", "bootstrap@example.com"], { cwd: workspace });
  writeFileSync(join(workspace, "component.ts"), "export const value = 'original';\n");
  execFileSync("git", ["add", "component.ts"], { cwd: workspace });
  execFileSync("git", ["commit", "-qm", "initial"], { cwd: workspace });
  return workspace;
}

async function flushMicrotasks(iterations = 12): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}
