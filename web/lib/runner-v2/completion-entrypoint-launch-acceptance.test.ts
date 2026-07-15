import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";
import { runRunnerV2CompletionEntrypoint } from "@/lib/runner-v2/completion-entrypoint";
import {
  captureRunnerEventAcceptedTrigger,
  consumeRunnerEvents,
} from "@/lib/runner-v2/event-lifecycle";
import { readFanGroup } from "@/lib/runner-v2/fan-group-store";
import { readLoopState, shellLoopStatePath, writeLoopState } from "@/lib/runner-v2/loop-state";
import { createRunRecord, readRunJson, updateRunJson } from "@/lib/runner-v2/run-state";
import { runnerEventFixture } from "@/lib/runner-v2/test-support/runner-event-fixture";

jest.mock("child_process", () => ({
  ...jest.requireActual("child_process"),
  spawnSync: jest.fn(),
}));

const mockSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "runner-v2-launch-acceptance-"));
  const runDir = join(root, "runs", "run-123");
  const eventsDir = join(root, "events");
  const stateDir = join(root, "state");
  mkdirSync(runDir, { recursive: true });
  mkdirSync(eventsDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  const chainPath = join(root, "chain.json");
  writeFileSync(chainPath, `${JSON.stringify({
    id: "chain",
    name: "Build Chain",
    config: { project_root: root },
    agents: [
      { id: "writer", name: "Writer", emits: "draft-ready" },
      { id: "reviewer", name: "Reviewer", triggers: ["draft-ready"] },
    ],
  })}\n`);
  const runJsonPath = join(runDir, "run.json");
  const run = createRunRecord({ chainName: "Build Chain", goal: "ship" });
  updateRunJson(runJsonPath, () => ({
    ...run,
    id: "run-123",
    status: "running",
    agents: [
      { id: "writer", name: "Writer", session: "writer-run-123", status: "running" },
      { id: "reviewer", name: "Reviewer", session: "", status: "pending" },
    ],
    sessions: ["writer-run-123"],
  }));
  const eventPath = join(eventsDir, "writer.event");
  writeFileSync(eventPath, runnerEventFixture({
    event: "draft-ready",
    source: "writer-run-123",
    runId: "run-123",
    timestamp: "2026-07-15T12:00:00.000Z",
  }));
  return { root, runDir, eventsDir, stateDir, chainPath, runJsonPath, eventPath };
}

function env(input: ReturnType<typeof fixture>) {
  return {
    MENTIKO_RUN_ID: "run-123",
    MENTIKO_RUN_DIR: input.runDir,
    EVENTS_DIR: input.eventsDir,
    STATE_DIR: input.stateDir,
    MENTIKO_RUNNER_V2: "1",
    MENTIKO_RUNNER_V2_COMPLETION: "1",
  };
}

function complete(
  input: ReturnType<typeof fixture>,
  sessionName = "writer-run-123",
  now = "2026-07-15T12:00:01.000Z",
) {
  return runRunnerV2CompletionEntrypoint({
    sessionName,
    chainPath: input.chainPath,
    env: env(input),
    now: new Date(now),
  });
}

function recordAcceptedTarget(
  runJsonPath: string,
  sequence = 1,
  agentId = "reviewer",
  createdAt = "2026-07-15T12:00:01.000Z",
): void {
  updateRunJson(runJsonPath, (current) => {
    if (!current) throw new Error("missing run fixture");
    const runnerV2 = current.runnerV2 && typeof current.runnerV2 === "object"
      ? current.runnerV2 as Record<string, unknown>
      : {};
    const attempts = Array.isArray(runnerV2.attempts) ? runnerV2.attempts : [];
    return {
      ...current,
      agents: (current.agents || []).some((agent) => agent.id === agentId)
        ? (current.agents || []).map((agent) => agent.id === agentId
          ? { ...agent, status: "running", session: `${agentId}-run-123` }
          : agent)
        : [...(current.agents || []), {
          id: agentId,
          name: agentId,
          status: "running",
          session: `${agentId}-run-123`,
        }],
      sessions: Array.from(new Set([...(current.sessions || []), `${agentId}-run-123`])),
      runnerV2: {
        ...runnerV2,
        attempts: [
          ...attempts,
          {
            id: `run-123:${agentId}:${sequence}`,
            runId: "run-123",
            agentId,
            phase: "instructions_submitted",
            desiredPhase: "completed",
            observedPhase: "instructions_submitted",
            processEvidence: { processPid: 4242, ptySessionId: `${agentId}-run-123` },
            instructionLedger: [],
            recoveryDecisionCount: 0,
            createdAt,
            updatedAt: createdAt,
            transitions: [],
          },
        ],
      },
    };
  });
}

function recordReleasedTarget(runJsonPath: string): void {
  updateRunJson(runJsonPath, (current) => {
    if (!current) throw new Error("missing run fixture");
    const runnerV2 = current.runnerV2 && typeof current.runnerV2 === "object"
      ? current.runnerV2 as Record<string, unknown>
      : {};
    const attempts = Array.isArray(runnerV2.attempts) ? runnerV2.attempts : [];
    return {
      ...current,
      runnerV2: {
        ...runnerV2,
        attempts: [...attempts, {
          id: "run-123:reviewer:1",
          runId: "run-123",
          agentId: "reviewer",
          phase: "released",
          desiredPhase: "lease_acquired",
          observedPhase: "released",
          terminalReason: "released",
          releaseReason: "released",
          instructionLedger: [],
          recoveryDecisionCount: 0,
          createdAt: "2026-07-15T12:00:01.000Z",
          updatedAt: "2026-07-15T12:00:01.000Z",
          transitions: [],
        }],
      },
    };
  });
}

function recordFastTerminalTarget(runJsonPath: string): void {
  updateRunJson(runJsonPath, (current) => {
    if (!current) throw new Error("missing run fixture");
    const runnerV2 = current.runnerV2 && typeof current.runnerV2 === "object"
      ? current.runnerV2 as Record<string, unknown>
      : {};
    const attempts = Array.isArray(runnerV2.attempts) ? runnerV2.attempts : [];
    const session = "reviewer-run-123-fast";
    return {
      ...current,
      agents: (current.agents || []).map((agent) => agent.id === "reviewer"
        ? { ...agent, status: "complete", session }
        : agent),
      sessions: Array.from(new Set([...(current.sessions || []), session])),
      runnerV2: {
        ...runnerV2,
        watchdog: { scannedAt: "2026-07-15T12:00:02.000Z", source: "concurrent-monitor" },
        attempts: [...attempts, {
          id: "run-123:reviewer:1",
          runId: "run-123",
          agentId: "reviewer",
          phase: "released",
          observedPhase: "released",
          terminalReason: "completed_from_event",
          releaseReason: "released",
          processEvidence: { processPid: 4242, ptySessionId: session },
          instructionLedger: [],
          recoveryDecisionCount: 0,
          createdAt: "2026-07-15T12:00:01.000Z",
          updatedAt: "2026-07-15T12:00:02.000Z",
          transitions: [],
        }],
      },
    };
  });
}

describe("runner-v2 routed launch durable acceptance", () => {
  beforeEach(() => mockSpawnSync.mockReset());

  const isRoutedLaunch = (args: readonly unknown[]) => (
    Array.isArray(args[1])
    && typeof args[1][0] === "string"
    && args[1][0].includes("runner-v2-launch-agent")
  );
  const routedLaunchCalls = () => mockSpawnSync.mock.calls.filter((call) => isRoutedLaunch(call));
  const nonLaunchResult = { status: 1, pid: 4000, stdout: "", stderr: "not running" } as ReturnType<typeof spawnSync>;

  it("accepts durable target state before consuming and only no-ops after consumption", () => {
    const input = fixture();
    mockSpawnSync.mockImplementation((...args) => {
      if (isRoutedLaunch(args)) {
        expect(existsSync(input.eventPath)).toBe(true);
        recordAcceptedTarget(input.runJsonPath);
        return { status: 0, pid: 4242, stdout: "accepted", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      return nonLaunchResult;
    });

    const handled = complete(input);
    expect(handled).toMatchObject({ status: "handled", decision: "route" });
    expect(routedLaunchCalls()).toHaveLength(1);
    expect(existsSync(input.eventPath)).toBe(false);
    expect(readRunJson(input.runJsonPath).agents).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "reviewer", status: "running", session: "reviewer-run-123" }),
    ]));
    const duplicate = complete(input);
    expect(duplicate).toMatchObject({ status: "handled", decision: "already-completed" });
    expect(routedLaunchCalls()).toHaveLength(1);
  });

  it("preserves an accepted handoff across event-consume failure and replay does not relaunch", () => {
    const input = fixture();
    const heartbeatAt = "2026-07-15T12:00:02.000Z";
    mockSpawnSync.mockImplementation((...args) => {
      if (isRoutedLaunch(args)) {
        recordAcceptedTarget(input.runJsonPath);
        updateRunJson(input.runJsonPath, (current) => {
          if (!current) throw new Error("missing run fixture");
          return {
            ...current,
            agents: current.agents.map((agent) => agent.id === "writer"
              ? { ...agent, lastHeartbeat: heartbeatAt }
              : agent),
          };
        });
        writeFileSync(join(input.eventsDir, "archive"), "blocks archive directory\n");
        return { status: 0, pid: 4242, stdout: "accepted", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      return nonLaunchResult;
    });

    expect(() => complete(input)).toThrow(/archive/i);
    expect(existsSync(input.eventPath)).toBe(true);
    expect(readRunJson(input.runJsonPath).agents).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "reviewer", status: "running", session: "reviewer-run-123" }),
    ]));
    const writer = readRunJson(input.runJsonPath).agents.find((agent) => agent.id === "writer");
    expect(writer).toMatchObject({ id: "writer", status: "running", lastHeartbeat: heartbeatAt });
    expect(writer).not.toHaveProperty("completed");
    const attempts = (readRunJson(input.runJsonPath).runnerV2 as { attempts?: Array<{ agentId: string }> } | undefined)?.attempts || [];
    expect(attempts).toEqual(expect.arrayContaining([expect.objectContaining({ agentId: "reviewer" })]));
    expect(attempts.some((attempt) => attempt.agentId === "writer")).toBe(false);

    rmSync(join(input.eventsDir, "archive"));
    mockSpawnSync.mockClear();
    const replay = complete(input);
    expect(replay).toMatchObject({ status: "handled", decision: "route", plan: { launches: [] } });
    expect(routedLaunchCalls()).toHaveLength(0);
    expect(existsSync(input.eventPath)).toBe(false);
  });

  it("preserves fast-terminal target provenance and concurrent monitor state across locked rollback", () => {
    const input = fixture();
    mockSpawnSync.mockImplementation((...args) => {
      if (isRoutedLaunch(args)) {
        recordFastTerminalTarget(input.runJsonPath);
        writeFileSync(join(input.eventsDir, "archive"), "blocks archive directory\n");
        return { status: 0, pid: 4242, stdout: "accepted then completed", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      return nonLaunchResult;
    });

    expect(() => complete(input)).toThrow(/archive/i);
    expect(existsSync(input.eventPath)).toBe(true);
    expect(readRunJson(input.runJsonPath)).toMatchObject({
      agents: expect.arrayContaining([
        expect.objectContaining({ id: "writer", status: "running" }),
        expect.objectContaining({ id: "reviewer", status: "complete", session: "reviewer-run-123-fast" }),
      ]),
      runnerV2: {
        attempts: expect.arrayContaining([
          expect.objectContaining({ id: "run-123:reviewer:1", phase: "released" }),
        ]),
        launchAcceptances: expect.any(Object),
        watchdog: { scannedAt: "2026-07-15T12:00:02.000Z", source: "concurrent-monitor" },
      },
    });

    rmSync(join(input.eventsDir, "archive"));
    mockSpawnSync.mockClear();
    expect(complete(input)).toMatchObject({ status: "handled" });
    expect(routedLaunchCalls()).toHaveLength(0);
    expect(existsSync(input.eventPath)).toBe(false);
  });

  it("does not roll concurrent watchdog terminalization back to a live run", () => {
    const input = fixture();
    const watchdogAt = "2026-07-15T12:00:02.000Z";
    mockSpawnSync.mockImplementation((...args) => {
      if (isRoutedLaunch(args)) {
        updateRunJson(input.runJsonPath, (current) => {
          if (!current) throw new Error("missing run fixture");
          return {
            ...current,
            status: "stopped",
            completed: watchdogAt,
            status_message: "watchdog: no live completion session",
            agents: current.agents.map((agent) => agent.id === "writer"
              ? { ...agent, status: "stopped", completed: watchdogAt }
              : agent),
            runnerV2: {
              ...(current.runnerV2 || {}),
              watchdog: {
                status: "stalled",
                detectedAt: watchdogAt,
                runId: current.id,
                reason: "no live completion session",
                lastAgent: "writer",
                lastAgentStatus: "running",
                pendingAgents: ["reviewer"],
              },
            },
          };
        });
        writeFileSync(join(input.eventsDir, "archive"), "blocks archive directory\n");
        return { status: 0, pid: 4242, stdout: "accepted before watchdog", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      return nonLaunchResult;
    });

    expect(() => complete(input)).toThrow(/missing_durable_state/i);
    expect(readRunJson(input.runJsonPath)).toMatchObject({
      status: "stopped",
      completed: watchdogAt,
      status_message: "watchdog: no live completion session",
      agents: expect.arrayContaining([
        expect.objectContaining({ id: "writer", status: "stopped", completed: watchdogAt }),
      ]),
      runnerV2: {
        watchdog: expect.objectContaining({
          status: "stalled",
          detectedAt: watchdogAt,
          lastAgent: "writer",
        }),
      },
    });
  });

  it("preserves a concurrent loop-state write when completion rollback runs", () => {
    const input = fixture();
    mockSpawnSync.mockImplementation((...args) => {
      if (isRoutedLaunch(args)) {
        writeLoopState(input.runDir, { visited: ["concurrent:visit"], round: 7 });
        writeFileSync(join(input.eventsDir, "archive"), "blocks archive directory\n");
        return { status: 0, pid: 4242, stdout: "accepted after concurrent loop update", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      return nonLaunchResult;
    });

    expect(() => complete(input)).toThrow(/missing_durable_state/i);
    expect(readLoopState(input.runDir)).toEqual({
      visited: ["concurrent:visit"],
      round: 7,
    });
    expect(existsSync(shellLoopStatePath(input.runDir))).toBe(true);
  });

  it("leaves retry and circuit state untouched when the retry launch is rejected", () => {
    const input = fixture();
    rmSync(input.eventPath);
    writeFileSync(input.chainPath, `${JSON.stringify({
      id: "chain",
      name: "Build Chain",
      config: { project_root: input.root },
      agents: [
        {
          id: "writer",
          name: "Writer",
          emits: "draft-ready",
          retry: { max_retries: 1, base_delay_ms: 0, max_delay_ms: 0 },
        },
      ],
    })}\n`);
    mockSpawnSync.mockImplementation((...args) => {
      if (isRoutedLaunch(args)) {
        return { status: 17, pid: 4242, stdout: "", stderr: "retry bootstrap rejected" } as ReturnType<typeof spawnSync>;
      }
      return nonLaunchResult;
    });

    expect(() => complete(input)).toThrow(/nonzero_exit/);
    expect(existsSync(join(input.stateDir, "retry"))).toBe(false);
    const restored = readRunJson(input.runJsonPath);
    expect(restored).toMatchObject({
      status: "running",
      agents: expect.arrayContaining([expect.objectContaining({ id: "writer", status: "running" })]),
    });
    expect((restored.runnerV2 as { attempts?: unknown[] } | undefined)?.attempts || []).toHaveLength(0);
  });

  it("does not resurrect an occurrence consumed by a concurrent claimant after the snapshot", () => {
    const input = fixture();
    const acceptedTrigger = captureRunnerEventAcceptedTrigger({
      eventsDir: input.eventsDir,
      file: input.eventPath,
    });
    mockSpawnSync.mockImplementation((...args) => {
      if (isRoutedLaunch(args)) {
        consumeRunnerEvents({
          eventsDir: input.eventsDir,
          runId: "run-123",
          source: "writer",
          sessionName: "writer-run-123",
          triggered: input.eventPath,
          expectedEvent: "draft-ready",
          allAgentIds: ["writer", "reviewer"],
          acceptedTrigger,
        });
        return { status: 19, pid: 4242, stdout: "", stderr: "concurrent claimant won" } as ReturnType<typeof spawnSync>;
      }
      return nonLaunchResult;
    });

    expect(() => complete(input)).toThrow(/nonzero_exit/);
    expect(existsSync(input.eventPath)).toBe(false);
    expect(existsSync(join(input.eventsDir, "archive", "writer.event"))).toBe(true);
  });

  it("keeps a failed first attempt and retries with a fresh accepted sequence", () => {
    const input = fixture();
    mockSpawnSync.mockImplementation((...args) => {
      if (isRoutedLaunch(args)) {
        recordReleasedTarget(input.runJsonPath);
        return { status: 17, pid: 4242, stdout: "", stderr: "bootstrap rejected" } as ReturnType<typeof spawnSync>;
      }
      return nonLaunchResult;
    });

    expect(() => complete(input)).toThrow(/nonzero_exit/);
    expect(existsSync(input.eventPath)).toBe(true);
    expect(readRunJson(input.runJsonPath).runnerV2).toMatchObject({
      attempts: expect.arrayContaining([expect.objectContaining({ id: "run-123:reviewer:1", phase: "released" })]),
    });

    mockSpawnSync.mockImplementation((...args) => {
      if (isRoutedLaunch(args)) {
        const attempts = (readRunJson(input.runJsonPath).runnerV2 as { attempts: Array<{ id: string }> }).attempts;
        expect(attempts.some((attempt) => attempt.id === "run-123:reviewer:1")).toBe(true);
        recordAcceptedTarget(input.runJsonPath, 2);
        return { status: 0, pid: 4343, stdout: "accepted", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      return nonLaunchResult;
    });

    const retried = complete(input);
    expect(retried).toMatchObject({ status: "handled", decision: "route" });
    expect(existsSync(input.eventPath)).toBe(false);
    expect(readRunJson(input.runJsonPath).runnerV2).toMatchObject({
      attempts: expect.arrayContaining([expect.objectContaining({ id: "run-123:reviewer:2", phase: "instructions_submitted" })]),
    });
  });

  it("reuses one fan-group after partial launch failure and launches fan-in exactly once", () => {
    const input = fixture();
    writeFileSync(input.chainPath, `${JSON.stringify({
      id: "fan-chain",
      name: "Fan Chain",
      config: { project_root: input.root },
      branches: {
        "draft-ready": {
          fan_out: ["designer", "editor"],
          fan_in: "merge",
          wait_for: "all",
        },
      },
      agents: [
        { id: "writer", name: "Writer", emits: "draft-ready" },
        { id: "designer", name: "Designer", emits: "designer-done" },
        { id: "editor", name: "Editor", emits: "editor-done" },
        { id: "merge", name: "Merge", emits: "merge-done" },
      ],
    })}\n`);

    const targetCalls: string[] = [];
    const groupIds: string[] = [];
    let rejectEditor = true;
    mockSpawnSync.mockImplementation((...args) => {
      if (!isRoutedLaunch(args)) return nonLaunchResult;
      const cliArgs = args[1] as string[];
      const target = cliArgs[cliArgs.length - 1];
      const options = args[2] as { env?: Record<string, string> };
      targetCalls.push(target);
      if (options.env?.AGENT_FAN_GROUP_ID) groupIds.push(options.env.AGENT_FAN_GROUP_ID);
      if (target === "editor" && rejectEditor) {
        rejectEditor = false;
        return { status: 17, pid: 4243, stdout: "", stderr: "editor rejected" } as ReturnType<typeof spawnSync>;
      }
      recordAcceptedTarget(input.runJsonPath, 1, target);
      return { status: 0, pid: 4242, stdout: `${target} accepted`, stderr: "" } as ReturnType<typeof spawnSync>;
    });

    expect(() => complete(input)).toThrow(/nonzero_exit/);
    expect(targetCalls).toEqual(["designer", "editor"]);
    expect(groupIds).toHaveLength(2);
    expect(new Set(groupIds).size).toBe(1);
    const groupId = groupIds[0];
    expect(readFanGroup(input.stateDir, groupId)).toMatchObject({
      id: groupId,
      fanOutAgents: ["designer", "editor"],
    });
    expect(existsSync(input.eventPath)).toBe(true);

    writeFileSync(join(input.eventsDir, "designer.event"), runnerEventFixture({
      event: "designer-done",
      source: "designer-run-123",
      runId: "run-123",
      timestamp: "2026-07-15T12:01:00.000Z",
    }));
    expect(complete(input, "designer-run-123", "2026-07-15T12:01:01.000Z")).toMatchObject({
      decision: "fan-group-member",
    });
    expect(readFanGroup(input.stateDir, groupId)).toMatchObject({
      completed: 1,
      members: { designer: "complete" },
    });

    expect(complete(input, "writer-run-123", "2026-07-15T12:02:00.000Z")).toMatchObject({ decision: "route" });
    expect(targetCalls.filter((target) => target === "designer")).toHaveLength(1);
    expect(targetCalls.filter((target) => target === "editor")).toHaveLength(2);
    expect(groupIds.every((candidate) => candidate === groupId)).toBe(true);
    expect(readFanGroup(input.stateDir, groupId)).toMatchObject({
      completed: 1,
      members: { designer: "complete" },
    });

    writeFileSync(join(input.eventsDir, "editor.event"), runnerEventFixture({
      event: "editor-done",
      source: "editor-run-123",
      runId: "run-123",
      timestamp: "2026-07-15T12:03:00.000Z",
    }));
    expect(complete(input, "editor-run-123", "2026-07-15T12:03:01.000Z")).toMatchObject({
      decision: "fan-group-member",
    });
    expect(targetCalls.filter((target) => target === "merge")).toHaveLength(1);
    expect(readFanGroup(input.stateDir, groupId)).toMatchObject({
      status: "complete",
      completed: 2,
      members: { designer: "complete", editor: "complete" },
    });

    expect(complete(input, "editor-run-123", "2026-07-15T12:04:00.000Z")).toMatchObject({
      decision: "already-completed",
    });
    expect(targetCalls.filter((target) => target === "merge")).toHaveLength(1);
  });

  it("routes a true second loop occurrence instead of no-oping on the prior archive receipt", () => {
    const input = fixture();
    writeFileSync(input.chainPath, `${JSON.stringify({
      id: "loop-chain",
      name: "Loop Chain",
      config: { project_root: input.root, max_rounds: 5 },
      agents: [
        { id: "writer", name: "Writer", emits: "draft-ready", triggers: ["revision-ready"] },
        { id: "reviewer", name: "Reviewer", emits: "revision-ready", triggers: ["draft-ready"] },
      ],
    })}\n`);
    mockSpawnSync.mockImplementation((...args) => {
      if (isRoutedLaunch(args)) {
        recordAcceptedTarget(input.runJsonPath, 1, "reviewer", "2026-07-15T12:00:01.000Z");
        return { status: 0, pid: 4242, stdout: "accepted", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      return nonLaunchResult;
    });
    expect(complete(input)).toMatchObject({ decision: "route", plan: { launches: [expect.objectContaining({ agentIds: ["reviewer"] })] } });

    const reviewerEvent = join(input.eventsDir, "reviewer.event");
    writeFileSync(reviewerEvent, runnerEventFixture({
      event: "revision-ready",
      source: "reviewer-run-123",
      runId: "run-123",
      timestamp: "2026-07-15T12:01:00.000Z",
    }));
    mockSpawnSync.mockImplementation((...args) => {
      if (isRoutedLaunch(args)) {
        recordAcceptedTarget(input.runJsonPath, 2, "writer", "2026-07-15T12:01:01.000Z");
        return { status: 0, pid: 4343, stdout: "accepted", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      return nonLaunchResult;
    });
    expect(complete(input, "reviewer-run-123", "2026-07-15T12:01:01.000Z")).toMatchObject({
      decision: "route",
      plan: { launches: [expect.objectContaining({ agentIds: ["writer"] })] },
    });

    // Same writer/event identity as iteration one, but a new active occurrence.
    // The old processed receipt must not short-circuit this completion.
    writeFileSync(input.eventPath, runnerEventFixture({
      event: "draft-ready",
      source: "writer-run-123",
      runId: "run-123",
      timestamp: "2026-07-15T12:02:00.000Z",
    }));
    writeLoopState(input.runDir, { visited: [], round: 2 });
    mockSpawnSync.mockImplementation((...args) => {
      if (isRoutedLaunch(args)) {
        recordAcceptedTarget(input.runJsonPath, 2, "reviewer", "2026-07-15T12:02:01.000Z");
        return { status: 0, pid: 4444, stdout: "accepted", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      return nonLaunchResult;
    });
    const secondWriterVisit = complete(input, "writer-run-123", "2026-07-15T12:02:01.000Z");
    expect(secondWriterVisit).toMatchObject({
      status: "handled",
      decision: "route",
      plan: { launches: [expect.objectContaining({ agentIds: ["reviewer"] })] },
    });
    expect(readRunJson(input.runJsonPath)).toMatchObject({
      agents: expect.arrayContaining([
        expect.objectContaining({ id: "writer", status: "complete" }),
        expect.objectContaining({ id: "reviewer", status: "running" }),
      ]),
      runnerV2: {
        attempts: expect.arrayContaining([
          expect.objectContaining({ id: "run-123:writer:2" }),
          expect.objectContaining({ id: "run-123:reviewer:2" }),
        ]),
      },
    });
  });
});
