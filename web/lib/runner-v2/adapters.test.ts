import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { spawn, spawnSync } from "child_process";
import { applyTypedExecutorPlan, recordCircuitFailure, startLaunch } from "@/lib/runner-v2/adapters";
import { planCompletionEventSideEffects } from "@/lib/runner-v2/event-side-effects";
import { parseRunnerEvent } from "@/lib/runner-v2/events";
import { createFanGroupState } from "@/lib/runner-v2/fan-group";
import { fanGroupPath } from "@/lib/runner-v2/fan-group-store";
import { createRunRecord, readRunJson, updateRunJson, type RunAgentRecord } from "@/lib/runner-v2/run-state";
import { planTerminalCompletion } from "@/lib/runner-v2/terminal-plan";
import { runnerEventFixture } from "@/lib/runner-v2/test-support/runner-event-fixture";

jest.mock("child_process", () => ({
  ...jest.requireActual("child_process"),
  spawn: jest.fn(() => ({ pid: 4242, unref: jest.fn() })),
  spawnSync: jest.fn(() => ({ status: 0, stdout: "import ok", stderr: "" })),
}));

function tempDir() {
  return mkdtempSync(join(tmpdir(), "runner-v2-adapters-"));
}

function seedRun(dir: string) {
  const runJsonPath = join(dir, "run.json");
  const run = createRunRecord({ chainName: "chain", goal: "goal" });
  updateRunJson(runJsonPath, () => ({
    ...run,
    id: "run-123",
    status: "running",
    agents: [],
    sessions: [],
  }));
  return runJsonPath;
}

function eventFile(dir: string, name: string, content: string) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

function jsonlRecords(path: string): Array<Record<string, unknown>> {
  return readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line));
}

function circuitStatePaths(dir: string): string[] {
  const root = join(dir, "retry");
  return readdirSync(root)
    .filter((name) => name.startsWith("circuit_") && name.endsWith(".json"))
    .sort()
    .map((name) => join(root, name));
}

function onlyCircuitStatePath(dir: string): string {
  const paths = circuitStatePaths(dir);
  expect(paths).toHaveLength(1);
  return paths[0];
}

function mockAcceptedLaunch(runJsonPath: string, agentId: string, assertBefore?: () => void) {
  (spawnSync as jest.Mock).mockImplementationOnce(() => {
    assertBefore?.();
    const session = `${agentId}-run-123`;
    updateRunJson(runJsonPath, (current) => {
      if (!current) throw new Error("missing run fixture");
      const agents = current.agents || [];
      const hasAgent = agents.some((agent) => agent.id === agentId);
      const acceptedAgent = { id: agentId, name: agentId, status: "running", session } satisfies RunAgentRecord;
      const runnerV2 = current.runnerV2 && typeof current.runnerV2 === "object"
        ? current.runnerV2 as Record<string, unknown>
        : {};
      const attempts = Array.isArray(runnerV2.attempts) ? runnerV2.attempts : [];
      return {
        ...current,
        agents: hasAgent
          ? agents.map((agent) => agent.id === agentId ? { ...agent, ...acceptedAgent } : agent)
          : [...agents, acceptedAgent],
        sessions: Array.from(new Set([...(current.sessions || []), session])),
        runnerV2: {
          ...runnerV2,
          attempts: [
            ...attempts,
            {
              id: `run-123:${agentId}:${attempts.length + 1}`,
              runId: "run-123",
              agentId,
              phase: "instructions_submitted",
              desiredPhase: "completed",
              observedPhase: "instructions_submitted",
              processEvidence: { processPid: 4242, ptySessionId: session },
              instructionLedger: [],
              recoveryDecisionCount: 0,
              createdAt: "2026-07-15T00:00:00.000Z",
              updatedAt: "2026-07-15T00:00:00.000Z",
              transitions: [],
            },
          ],
        },
      };
    });
    return { status: 0, pid: 4242, stdout: "accepted", stderr: "" };
  });
}

function mockFastTerminalLaunch(runJsonPath: string, agentId: string) {
  (spawnSync as jest.Mock).mockImplementationOnce(() => {
    const session = `${agentId}-run-123-fast`;
    updateRunJson(runJsonPath, (current) => {
      if (!current) throw new Error("missing run fixture");
      const runnerV2 = current.runnerV2 && typeof current.runnerV2 === "object"
        ? current.runnerV2 as Record<string, unknown>
        : {};
      const attempts = Array.isArray(runnerV2.attempts) ? runnerV2.attempts : [];
      const acceptedAgent = { id: agentId, name: agentId, status: "complete", session } satisfies RunAgentRecord;
      const agents = current.agents || [];
      return {
        ...current,
        agents: agents.some((agent) => agent.id === agentId)
          ? agents.map((agent) => agent.id === agentId ? { ...agent, ...acceptedAgent } : agent)
          : [...agents, acceptedAgent],
        sessions: Array.from(new Set([...(current.sessions || []), session])),
        runnerV2: {
          ...runnerV2,
          attempts: [...attempts, {
            id: `run-123:${agentId}:${attempts.length + 1}`,
            runId: "run-123",
            agentId,
            phase: "released",
            observedPhase: "released",
            terminalReason: "completed_from_event",
            releaseReason: "released",
            processEvidence: { processPid: 4242, ptySessionId: session },
            instructionLedger: [],
            recoveryDecisionCount: 0,
            createdAt: "2026-07-15T00:00:00.000Z",
            updatedAt: "2026-07-15T00:00:01.000Z",
            transitions: [],
          }],
        },
      };
    });
    return { status: 0, pid: 4242, stdout: "accepted then completed", stderr: "" };
  });
}

function seedNextChainChild(
  runsDir: string,
  input: { id?: string; parentRunId: string; chainName: string; chainId?: string },
) {
  const childRunDir = join(runsDir, input.id || "run-child");
  mkdirSync(childRunDir, { recursive: true });
  const child = {
    ...createRunRecord({
      chainName: input.chainName,
      goal: "chained",
      parentRunId: input.parentRunId,
      now: new Date("2026-07-15T00:00:01.000Z"),
    }),
    id: input.id || "run-child",
  };
  updateRunJson(join(childRunDir, "run.json"), () => ({
    ...child,
    ...(input.chainId ? { chainId: input.chainId } : {}),
    status: "running",
  }));
}

describe("runner-v2 adapters", () => {
  it("delegates a live root scan that consumes owned events and isolates sibling, other-run, and runless events", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const eventsDir = join(dir, "events");
    const triggeredPath = eventFile(eventsDir, "trigger.event", runnerEventFixture({ event: "done", source: "writer", runId: "run-123" }));
    const ownedPath = eventFile(eventsDir, "owned.event", runnerEventFixture({ event: "note", source: "writer-helper", runId: "run-123" }));
    const siblingPath = eventFile(eventsDir, "sibling.event", runnerEventFixture({ event: "note", source: "reviewer", runId: "run-123" }));
    const otherPath = eventFile(eventsDir, "other-run.event", runnerEventFixture({ event: "note", source: "writer", runId: "run-999" }));
    const runlessPath = eventFile(eventsDir, "runless.event", runnerEventFixture({ event: "manual", source: "writer", runId: "" }));
    const triggered = { ...parseRunnerEvent(readFileSync(triggeredPath, "utf8")), path: triggeredPath };
    const sibling = { ...parseRunnerEvent(readFileSync(siblingPath, "utf8")), path: siblingPath };
    const other = { ...parseRunnerEvent(readFileSync(otherPath, "utf8")), path: otherPath };
    const runless = { ...parseRunnerEvent(readFileSync(runlessPath, "utf8")), path: runlessPath };

    const sideEffects = planCompletionEventSideEffects(
      triggered,
      [triggered, sibling, other, runless],
      ["writer", "reviewer"],
    );
    expect(sideEffects.triggeredPath).toBe(triggeredPath);

    applyTypedExecutorPlan({
      action: "route",
      effects: [{
        type: "event-side-effects",
        plan: sideEffects,
      }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
      eventsDir: join(dir, "events"),
    });

    const archivedTriggerPath = join(eventsDir, "archive", "trigger.event");
    expect(existsSync(triggeredPath)).toBe(false);
    expect(parseRunnerEvent(readFileSync(archivedTriggerPath, "utf8")).processed).toBe(true);
    expect(existsSync(ownedPath)).toBe(false);
    expect(parseRunnerEvent(readFileSync(join(eventsDir, "archive", "owned.event"), "utf8")).processed).toBe(true);
    expect(existsSync(siblingPath)).toBe(true);
    expect(existsSync(other.path || "")).toBe(true);
    expect(existsSync(runless.path || "")).toBe(true);
  });

  it("uses the canonical completing agent to consume diagnostic siblings of a session-suffixed trigger", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const eventsDir = join(dir, "events");
    const triggeredPath = eventFile(
      eventsDir,
      "writer.event",
      runnerEventFixture({ event: "done", source: "writer-run-123", runId: "run-123" }),
    );
    const diagnosticPath = eventFile(
      eventsDir,
      "monitor.event",
      runnerEventFixture({
        event: "monitor-finished",
        source: "monitor",
        runId: "run-123",
        extensions: { agent: "writer" },
      }),
    );
    const triggered = { ...parseRunnerEvent(readFileSync(triggeredPath, "utf8")), path: triggeredPath };

    applyTypedExecutorPlan({
      action: "route",
      effects: [{
        type: "event-side-effects",
        plan: planCompletionEventSideEffects(
          triggered,
          [triggered],
          ["writer", "reviewer"],
          { agentId: "writer", sessionName: "writer-run-123" },
        ),
      }],
      launches: [],
    }, { runJsonPath, stateDir: dir, eventsDir });

    expect(existsSync(triggeredPath)).toBe(false);
    expect(existsSync(diagnosticPath)).toBe(false);
    expect(existsSync(join(eventsDir, "archive", "monitor.event"))).toBe(true);
  });

  it("does not clobber an existing archive entry and collision-archives the consumed trigger", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const eventsDir = join(dir, "events");
    const archiveDir = join(eventsDir, "archive");
    const triggeredPath = eventFile(eventsDir, "trigger.event", runnerEventFixture({ event: "done", source: "writer", runId: "run-123" }));
    const triggered = { ...parseRunnerEvent(readFileSync(triggeredPath, "utf8")), path: triggeredPath };
    mkdirSync(archiveDir, { recursive: true });
    writeFileSync(join(archiveDir, "trigger.event"), "existing archive evidence\n");

    applyTypedExecutorPlan({
      action: "route",
      effects: [{
        type: "event-side-effects",
        plan: planCompletionEventSideEffects(triggered, [triggered], ["writer"]),
      }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
      eventsDir,
      eventsArchiveDir: archiveDir,
    });

    expect(readFileSync(join(archiveDir, "trigger.event"), "utf8")).toBe("existing archive evidence\n");
    expect(existsSync(triggeredPath)).toBe(false);
    const collisionName = readdirSync(archiveDir).find((name) => name.startsWith("trigger-collision-"));
    expect(collisionName).toMatch(/^trigger-collision-[a-f0-9]{16}\.event$/);
    expect(parseRunnerEvent(readFileSync(join(archiveDir, collisionName!), "utf8")).processed).toBe(true);
  });

  it("rejects an explicit path outside the active event policy without touching the artifact", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const eventsDir = join(dir, "events");
    mkdirSync(eventsDir);
    const artifactPath = eventFile(join(dir, "artifacts"), "writer-summary.json", "{\"summary\":true}\n");
    const triggered = {
      ...parseRunnerEvent(runnerEventFixture({ event: "done", source: "writer", runId: "run-123" })),
      path: artifactPath,
    };

    expect(() => applyTypedExecutorPlan({
      action: "route",
      effects: [{
        type: "event-side-effects",
        plan: { markProcessed: triggered, triggeredPath: artifactPath, allAgentIds: ["writer"] },
      }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
      eventsDir,
    })).toThrow("event-side-effects requires the accepted trigger fingerprint");

    expect(readFileSync(artifactPath, "utf8")).toBe("{\"summary\":true}\n");
  });

  it("rejects a supplied archive directory outside <eventsDir>/archive before consuming", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const eventsDir = join(dir, "events");
    const triggeredPath = eventFile(eventsDir, "trigger.event", runnerEventFixture({ event: "done", source: "writer", runId: "run-123" }));
    const triggered = { ...parseRunnerEvent(readFileSync(triggeredPath, "utf8")), path: triggeredPath };

    expect(() => applyTypedExecutorPlan({
      action: "route",
      effects: [{
        type: "event-side-effects",
        plan: planCompletionEventSideEffects(triggered, [triggered], ["writer"]),
      }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
      eventsDir,
      eventsArchiveDir: join(dir, "different-archive"),
    })).toThrow("eventsArchiveDir must equal the configured events archive");

    expect(parseRunnerEvent(readFileSync(triggeredPath, "utf8")).processed).toBe(false);
  });

  it("rejects an explicit trigger path that does not match the accepted completion record", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const eventsDir = join(dir, "events");
    const triggeredPath = eventFile(eventsDir, "trigger.event", runnerEventFixture({ event: "done", source: "writer", runId: "run-123" }));
    const otherPath = eventFile(eventsDir, "other.event", runnerEventFixture({ event: "done", source: "reviewer", runId: "run-123" }));
    const triggered = { ...parseRunnerEvent(readFileSync(triggeredPath, "utf8")), path: triggeredPath };

    expect(() => applyTypedExecutorPlan({
      action: "route",
      effects: [{
        type: "event-side-effects",
        plan: { markProcessed: triggered, triggeredPath: otherPath, allAgentIds: ["writer", "reviewer"] },
      }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
      eventsDir,
    })).toThrow("Invalid explicit triggered-event policy");

    expect(parseRunnerEvent(readFileSync(triggeredPath, "utf8")).processed).toBe(false);
  });

  it("rejects a same-owner path swap to a different event before consume", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const eventsDir = join(dir, "events");
    const triggeredPath = eventFile(
      eventsDir,
      "trigger.event",
      runnerEventFixture({ event: "done", source: "writer", runId: "run-123" }),
    );
    const triggered = {
      ...parseRunnerEvent(readFileSync(triggeredPath, "utf8")),
      path: triggeredPath,
    };
    const plan = planCompletionEventSideEffects(triggered, [triggered], ["writer"]);
    writeFileSync(
      triggeredPath,
      runnerEventFixture({ event: "different", source: "writer", runId: "run-123" }),
    );

    expect(() => applyTypedExecutorPlan({
      action: "route",
      effects: [{ type: "event-side-effects", plan }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
      eventsDir,
    })).toThrow(/no longer matches the accepted trigger occurrence/i);

    expect(parseRunnerEvent(readFileSync(triggeredPath, "utf8"))).toMatchObject({
      event: "different",
      processed: false,
    });
    expect(existsSync(join(eventsDir, "archive"))).toBe(false);
  });

  it("propagates a missing explicit trigger error", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const eventsDir = join(dir, "events");
    const triggeredPath = eventFile(eventsDir, "trigger.event", runnerEventFixture({ event: "done", source: "writer", runId: "run-123" }));
    const triggered = { ...parseRunnerEvent(readFileSync(triggeredPath, "utf8")), path: triggeredPath };
    const plan = planCompletionEventSideEffects(triggered, [triggered], ["writer"]);
    unlinkSync(triggeredPath);

    expect(() => applyTypedExecutorPlan({
      action: "route",
      effects: [{ type: "event-side-effects", plan }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
      eventsDir,
    })).toThrow("Triggered event file not found and no archive receipt exists");
  });

  it("keeps pathless and synthetic completion records as filesystem no-ops", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const pathless = parseRunnerEvent(runnerEventFixture({ event: "done", source: "writer", runId: "run-123" }));
    const synthetic = { ...pathless, path: join(dir, "artifacts", "writer-summary.json") };

    for (const triggered of [pathless, synthetic]) {
      expect(() => applyTypedExecutorPlan({
        action: "route",
        effects: [{
          type: "event-side-effects",
          plan: planCompletionEventSideEffects(triggered, [triggered], ["writer"]),
        }],
        launches: [],
      }, {
        runJsonPath,
        stateDir: dir,
      })).not.toThrow();
    }
  });

  it("persists fan-group create effects", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const group = createFanGroupState({
      id: "group-1",
      event: "done",
      fanOutAgents: ["a", "b"],
      fanInAgent: "merge",
    });

    applyTypedExecutorPlan({
      action: "route",
      effects: [{ type: "fan-group-create", group }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
    });

    expect(JSON.parse(readFileSync(fanGroupPath(dir, "group-1"), "utf8"))).toMatchObject({
      id: "group-1",
      fanOutAgents: ["a", "b"],
      fanInAgent: "merge",
    });
  });

  it("applies fan-group member completion under lock and launches fan-in only for the claim winner", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const chainPath = join(dir, "chain.json");
    writeFileSync(chainPath, "{}\n");
    const group = createFanGroupState({
      id: "group-1",
      event: "done",
      fanOutAgents: ["a", "b"],
      fanInAgent: "merge",
      chainPath,
      runId: "run-123",
    });
    applyTypedExecutorPlan({
      action: "route",
      effects: [{ type: "fan-group-create", group }],
      launches: [],
    }, { runJsonPath, stateDir: dir });

    const first = applyTypedExecutorPlan({
      action: "fan-group-member",
      effects: [{ type: "fan-group", plan: { group, claimed: false }, agentId: "a", status: "complete" }],
      launches: [],
    }, { runJsonPath, stateDir: dir });
    expect(first.launchesStarted).toEqual([]);

    mockAcceptedLaunch(runJsonPath, "merge");
    const second = applyTypedExecutorPlan({
      action: "fan-group-member",
      effects: [{ type: "fan-group", plan: { group, claimed: false }, agentId: "b", status: "complete" }],
      launches: [],
    }, { runJsonPath, stateDir: dir });
    expect(second.launchesStarted).toHaveLength(1);
    expect(second.launchesStarted[0].command).toMatch(/runner-v2-launch-agent.*'merge'/);
    expect(second.launchesStarted[0].command).not.toContain("chain-runner.sh");

    const duplicate = applyTypedExecutorPlan({
      action: "fan-group-member",
      effects: [{ type: "fan-group", plan: { group, claimed: false }, agentId: "b", status: "complete" }],
      launches: [],
    }, { runJsonPath, stateDir: dir });
    expect(duplicate.launchesStarted).toEqual([]);

    expect(JSON.parse(readFileSync(fanGroupPath(dir, "group-1"), "utf8"))).toMatchObject({
      status: "complete",
      completed: 2,
      members: { a: "complete", b: "complete" },
    });
    expect(readRunJson(runJsonPath)).toMatchObject({
      runnerV2: { launchAcceptances: expect.any(Object) },
    });
  });

  it("applies terminal run-status effects to run.json", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);

    applyTypedExecutorPlan({
      action: "loop-complete",
      effects: [{ type: "run-terminal", status: "completed", reason: "visited-agent-event" }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
    });

    expect(readRunJson(runJsonPath)).toMatchObject({
      status: "completed",
      status_message: "visited-agent-event",
    });
  });

  it("starts launch plans through the process adapter", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    mockAcceptedLaunch(runJsonPath, "writer");
    const result = applyTypedExecutorPlan({
      action: "route",
      effects: [],
      launches: [{
        kind: "single",
        agentIds: ["writer"],
        command: "echo ok",
        env: { MENTIKO_RUN_ID: "run-123" },
      }],
    }, {
      runJsonPath,
      stateDir: dir,
    });

    expect(result.launchesStarted).toEqual([{ command: "echo ok", pid: 4242 }]);
    expect(readRunJson(runJsonPath)).toMatchObject({
      agents: [expect.objectContaining({ id: "writer", status: "running", session: "writer-run-123" })],
      runnerV2: { attempts: [expect.objectContaining({ agentId: "writer", phase: "instructions_submitted" })] },
    });
  });

  it("keeps the strict trigger active until routed launch acceptance", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const eventsDir = join(dir, "events");
    const triggeredPath = eventFile(
      eventsDir,
      "trigger.event",
      runnerEventFixture({ event: "done", source: "writer", runId: "run-123" }),
    );
    const triggered = {
      ...parseRunnerEvent(readFileSync(triggeredPath, "utf8")),
      path: triggeredPath,
    };
    const eventPlan = planCompletionEventSideEffects(triggered, [triggered], ["writer"]);
    expect(eventPlan.acceptedTrigger).toEqual(expect.objectContaining({
      sourceFilename: "trigger.event",
      occurrenceToken: expect.stringMatching(/^[a-f0-9]{64}$/),
      rawContentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      normalizedRecordSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    mockAcceptedLaunch(runJsonPath, "reviewer", () => {
      expect(existsSync(triggeredPath)).toBe(true);
    });

    applyTypedExecutorPlan({
      action: "route",
      effects: [{
        type: "event-side-effects",
        plan: eventPlan,
      }],
      launches: [{
        kind: "single",
        agentIds: ["reviewer"],
        command: "echo launch-reviewer",
        env: { MENTIKO_RUN_ID: "run-123" },
      }],
    }, {
      runJsonPath,
      stateDir: dir,
      eventsDir,
    });

    expect(existsSync(triggeredPath)).toBe(false);
    expect(existsSync(join(eventsDir, "archive", "trigger.event"))).toBe(true);
  });

  it("launches first but refuses to consume missing B with A's older receipt", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const eventsDir = join(dir, "events");
    const triggeredPath = eventFile(
      eventsDir,
      "trigger.event",
      runnerEventFixture({ event: "done", source: "writer", runId: "run-123", data: "content A" }),
    );
    const eventA = { ...parseRunnerEvent(readFileSync(triggeredPath, "utf8")), path: triggeredPath };
    const planA = planCompletionEventSideEffects(eventA, [eventA], ["writer"]);
    applyTypedExecutorPlan({
      action: "route",
      effects: [{ type: "event-side-effects", plan: planA }],
      launches: [],
    }, { runJsonPath, stateDir: dir, eventsDir });

    eventFile(
      eventsDir,
      "trigger.event",
      runnerEventFixture({ event: "done", source: "writer", runId: "run-123", data: "content B" }),
    );
    const eventB = { ...parseRunnerEvent(readFileSync(triggeredPath, "utf8")), path: triggeredPath };
    const planB = planCompletionEventSideEffects(eventB, [eventB], ["writer"]);
    expect(planB.acceptedTrigger).not.toEqual(planA.acceptedTrigger);
    mockAcceptedLaunch(runJsonPath, "reviewer", () => {
      expect(existsSync(triggeredPath)).toBe(true);
      unlinkSync(triggeredPath);
    });

    expect(() => applyTypedExecutorPlan({
      action: "route",
      effects: [{ type: "event-side-effects", plan: planB }],
      launches: [{
        kind: "single",
        agentIds: ["reviewer"],
        command: "echo launch-reviewer",
        env: {
          MENTIKO_RUN_ID: "run-123",
          MENTIKO_COMPLETION_OCCURRENCE_ID: "content-b-occurrence",
        },
      }],
    }, { runJsonPath, stateDir: dir, eventsDir })).toThrow(/no archive receipt exists/);

    expect(readRunJson(runJsonPath).agents).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "reviewer", status: "running" }),
    ]));
    const receipts = readdirSync(join(eventsDir, "archive"))
      .filter((name) => name.startsWith(".event-receipt-"));
    expect(receipts).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(eventsDir, "archive", receipts[0]), "utf8"))).toMatchObject({
      acceptedContentSha256: planA.acceptedTrigger?.rawContentSha256,
      occurrenceToken: planA.acceptedTrigger?.occurrenceToken,
    });
  });

  it("replays an active trigger after accepted child state without relaunching the child", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const eventsDir = join(dir, "events");
    const triggeredPath = eventFile(
      eventsDir,
      "trigger.event",
      runnerEventFixture({ event: "done", source: "writer", runId: "run-123" }),
    );
    const triggered = { ...parseRunnerEvent(readFileSync(triggeredPath, "utf8")), path: triggeredPath };
    const launch = {
      kind: "single" as const,
      agentIds: ["reviewer"],
      command: "echo launch-reviewer",
      env: { MENTIKO_RUN_ID: "run-123" },
    };

    mockAcceptedLaunch(runJsonPath, "reviewer");
    startLaunch(launch, { runJsonPath, stateDir: dir, eventsDir });
    expect(existsSync(triggeredPath)).toBe(true);

    (spawnSync as jest.Mock).mockClear();
    applyTypedExecutorPlan({
      action: "route",
      effects: [{
        type: "event-side-effects",
        plan: planCompletionEventSideEffects(triggered, [triggered], ["writer", "reviewer"]),
      }],
      launches: [launch],
    }, { runJsonPath, stateDir: dir, eventsDir });

    expect(spawnSync).not.toHaveBeenCalled();
    expect(existsSync(triggeredPath)).toBe(false);
    expect(existsSync(join(eventsDir, "archive", "trigger.event"))).toBe(true);
  });

  it("refuses an unowned queued target with no reclaimable launch job", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    updateRunJson(runJsonPath, (current) => ({
      ...current!,
      agents: [{
        id: "reviewer",
        name: "Reviewer",
        status: "pending",
        session: "reviewer-run-123",
      }],
      runnerV2: {
        attempts: [{
          id: "run-123:reviewer:1",
          runId: "run-123",
          agentId: "reviewer",
          phase: "queued",
          desiredPhase: "lease_acquired",
          observedPhase: "queued",
          instructionLedger: [],
          recoveryDecisionCount: 0,
          createdAt: "2026-08-09T20:00:00.000Z",
          updatedAt: "2026-08-09T20:00:00.000Z",
          transitions: [{
            from: "created",
            to: "queued",
            at: "2026-08-09T20:00:00.000Z",
          }],
        }],
      },
    }));
    (spawnSync as jest.Mock).mockClear();

    expect(() => startLaunch({
      kind: "single",
      agentIds: ["reviewer"],
      command: "echo launch-reviewer",
      env: { MENTIKO_RUN_ID: "run-123" },
    }, { runJsonPath, stateDir: dir })).toThrow(/acceptance_pending/);
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("accepts a newly launched target that reaches terminal release and replays by exact receipt", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const launch = {
      kind: "single" as const,
      agentIds: ["reviewer"],
      command: "echo launch-reviewer",
      env: {
        MENTIKO_RUN_ID: "run-123",
        MENTIKO_COMPLETION_OCCURRENCE_ID: "run-123:writer:event-1",
      },
    };
    mockFastTerminalLaunch(runJsonPath, "reviewer");

    expect(startLaunch(launch, { runJsonPath, stateDir: dir })).toMatchObject({ pid: 4242 });
    expect(readRunJson(runJsonPath)).toMatchObject({
      agents: [expect.objectContaining({ id: "reviewer", status: "complete", session: "reviewer-run-123-fast" })],
      runnerV2: {
        attempts: [expect.objectContaining({ agentId: "reviewer", phase: "released" })],
        launchAcceptances: expect.any(Object),
      },
    });

    (spawnSync as jest.Mock).mockClear();
    expect(startLaunch(launch, { runJsonPath, stateDir: dir })).toMatchObject({ pid: 4242 });
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("leaves the strict trigger active when routed launch acceptance throws", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const eventsDir = join(dir, "events");
    const triggeredPath = eventFile(
      eventsDir,
      "trigger.event",
      runnerEventFixture({ event: "done", source: "writer", runId: "run-123" }),
    );
    const triggered = {
      ...parseRunnerEvent(readFileSync(triggeredPath, "utf8")),
      path: triggeredPath,
    };
    (spawnSync as jest.Mock).mockReturnValueOnce({ status: 19, pid: 4242, stdout: "", stderr: "injected launch rejection" });

    expect(() => applyTypedExecutorPlan({
      action: "route",
      effects: [{
        type: "event-side-effects",
        plan: planCompletionEventSideEffects(triggered, [triggered], ["writer"]),
      }],
      launches: [{
        kind: "single",
        agentIds: ["reviewer"],
        command: "echo launch-reviewer",
        env: { MENTIKO_RUN_ID: "run-123" },
      }],
    }, {
      runJsonPath,
      stateDir: dir,
      eventsDir,
    })).toThrow(/nonzero_exit.*injected launch rejection/);

    expect(existsSync(triggeredPath)).toBe(true);
    expect(existsSync(join(eventsDir, "archive"))).toBe(false);
  });

  it("leaves the strict trigger active when routed launch acceptance times out", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const eventsDir = join(dir, "events");
    const triggeredPath = eventFile(
      eventsDir,
      "trigger.event",
      runnerEventFixture({ event: "done", source: "writer", runId: "run-123" }),
    );
    const triggered = { ...parseRunnerEvent(readFileSync(triggeredPath, "utf8")), path: triggeredPath };
    const timeout = Object.assign(new Error("launch acceptance timed out"), { code: "ETIMEDOUT" });
    (spawnSync as jest.Mock).mockReturnValueOnce({ status: null, signal: "SIGTERM", error: timeout, stdout: "", stderr: "" });

    expect(() => applyTypedExecutorPlan({
      action: "route",
      effects: [{ type: "event-side-effects", plan: planCompletionEventSideEffects(triggered, [triggered], ["writer", "reviewer"]) }],
      launches: [{
        kind: "single",
        agentIds: ["reviewer"],
        command: "echo launch-reviewer",
        env: { MENTIKO_RUN_ID: "run-123" },
      }],
    }, { runJsonPath, stateDir: dir, eventsDir })).toThrow(/\(timeout\)/);

    expect(existsSync(triggeredPath)).toBe(true);
    expect(existsSync(join(eventsDir, "archive"))).toBe(false);
  });

  it("leaves the trigger active when a synchronous effect fails before consumption", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const eventsDir = join(dir, "events");
    const triggeredPath = eventFile(eventsDir, "trigger.event", runnerEventFixture({ event: "done", source: "writer", runId: "run-123" }));
    const triggered = { ...parseRunnerEvent(readFileSync(triggeredPath, "utf8")), path: triggeredPath };
    (spawnSync as jest.Mock).mockReturnValueOnce({ status: 7, stdout: "", stderr: "import rejected" });

    expect(() => applyTypedExecutorPlan({
      action: "generation-terminal",
      effects: [
        { type: "generation-import", plan: { jobId: "job-1", generationKind: "agent", runId: "run-123", artifactsDir: join(dir, "artifacts") } },
        { type: "event-side-effects", plan: planCompletionEventSideEffects(triggered, [triggered], ["writer"]) },
      ],
      launches: [],
    }, { runJsonPath, stateDir: dir, eventsDir })).toThrow("generation import failed");

    expect(existsSync(triggeredPath)).toBe(true);
    expect(existsSync(join(eventsDir, "archive"))).toBe(false);
  });

  it("retries a fan-in claim after launch rejection and commits only after durable acceptance", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const chainPath = join(dir, "chain.json");
    writeFileSync(chainPath, "{}\n");
    const eventsDir = join(dir, "events");
    const triggeredPath = eventFile(eventsDir, "b.event", runnerEventFixture({ event: "done", source: "b", runId: "run-123" }));
    const triggered = { ...parseRunnerEvent(readFileSync(triggeredPath, "utf8")), path: triggeredPath };
    const group = createFanGroupState({
      id: "group-retry",
      event: "done",
      fanOutAgents: ["a", "b"],
      fanInAgent: "merge",
      chainPath,
      runId: "run-123",
    });
    applyTypedExecutorPlan({ action: "route", effects: [{ type: "fan-group-create", group }], launches: [] }, { runJsonPath, stateDir: dir });
    applyTypedExecutorPlan({
      action: "fan-group-member",
      effects: [{ type: "fan-group", plan: { group, claimed: false }, agentId: "a", status: "complete" }],
      launches: [],
    }, { runJsonPath, stateDir: dir });
    const completionPlan = {
      action: "fan-group-member" as const,
      effects: [
        { type: "fan-group" as const, plan: { group, claimed: false }, agentId: "b", status: "complete" as const },
        { type: "event-side-effects" as const, plan: planCompletionEventSideEffects(triggered, [triggered], ["a", "b", "merge"]) },
      ],
      launches: [],
    };
    (spawnSync as jest.Mock).mockReturnValueOnce({ status: 9, stdout: "", stderr: "bootstrap failed" });

    expect(() => applyTypedExecutorPlan(completionPlan, { runJsonPath, stateDir: dir, eventsDir })).toThrow(/nonzero_exit/);
    expect(JSON.parse(readFileSync(fanGroupPath(dir, "group-retry"), "utf8"))).toMatchObject({
      status: "running",
      completed: 1,
      members: { a: "complete" },
    });
    expect(existsSync(triggeredPath)).toBe(true);

    mockAcceptedLaunch(runJsonPath, "merge");
    applyTypedExecutorPlan(completionPlan, { runJsonPath, stateDir: dir, eventsDir });
    expect(JSON.parse(readFileSync(fanGroupPath(dir, "group-retry"), "utf8"))).toMatchObject({
      status: "complete",
      completed: 2,
      members: { a: "complete", b: "complete" },
    });
    expect(existsSync(triggeredPath)).toBe(false);
  });

  it("dry run records planned work without mutating files or spawning", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);

    const result = applyTypedExecutorPlan({
      action: "route",
      effects: [{ type: "run-terminal", status: "completed", reason: "dry" }],
      launches: [{ kind: "single", command: "echo ok", env: {} }],
    }, {
      runJsonPath,
      stateDir: dir,
      dryRun: true,
    });

    expect(result).toEqual({
      effectsApplied: ["run-terminal"],
      operations: [],
      launchesStarted: [{ command: "echo ok", pid: undefined }],
    });
    expect(readRunJson(runJsonPath).status).toBe("running");
  });

  it("applies generation import effects through the mentiko CLI", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const artifactsDir = join(dir, "artifacts");
    mkdirSync(artifactsDir, { recursive: true });

    const result = applyTypedExecutorPlan({
      action: "generation-terminal",
      effects: [{
        type: "generation-import",
        plan: {
          jobId: "job-1",
          generationKind: "chain_recommendation",
          runId: "run-123",
          artifactsDir,
          namespaceId: "default",
          orgId: "default",
        },
      }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
    });

    expect(result.operations).toEqual([
      expect.objectContaining({
        type: "generation-import",
        jobId: "job-1",
        generationKind: "chain_recommendation",
        artifactsDir,
      }),
    ]);
    expect(readFileSync(join(dir, "generation-import.jsonl"), "utf8")).toContain("\"status\":\"complete\"");
    expect(spawn).not.toHaveBeenCalledWith(expect.stringContaining("mentiko"), expect.arrayContaining(["generation", "import"]), expect.anything());
    expect(spawnSync).toHaveBeenCalledWith(expect.stringContaining("/bin/mentiko"), ["generation", "import"], expect.objectContaining({
      env: expect.objectContaining({
        ARTIFACTS_DIR: artifactsDir,
        MENTIKO_GENERATION_JOB_ID: "job-1",
        MENTIKO_GENERATION_KIND: "chain_recommendation",
      }),
    }));
  });

  it("applies event artifact effects under the run artifacts dir", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const artifactsDir = join(dir, "artifacts");
    mkdirSync(artifactsDir, { recursive: true });

    const result = applyTypedExecutorPlan({
      action: "fail",
      effects: [{
        type: "event-artifact",
        plan: {
          namespaceId: "default",
          orgId: "default",
          runId: "run-123",
          runArtifactsDir: artifactsDir,
          payload: {
            event: { name: "quality_gate.failed", source: "runner-v2", timestamp: "2026-06-26T00:00:00.000Z" },
            namespace: { id: "default" },
            org: { id: "default" },
            run: { id: "run-123", status: "failed", artifactsDir },
            task: { id: "FEAT-1", title: "Fix API", status: "in_progress" },
            qualityGate: { status: "failed", reason: "tests failed", findings: [], risks: [], nextActions: [] },
            evidence: { changedFiles: [], liveSessions: [], artifacts: [] },
          },
        },
      }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
    });

    expect(result.effectsApplied).toEqual(["event-artifact"]);
    expect(result.operations).toEqual([expect.objectContaining({
      type: "event-artifact",
      runId: "run-123",
      status: "planned",
    })]);
    expect(existsSync(join(artifactsDir, "triage-result.json"))).toBe(true);
  });

  it("records terminal side-effect operations while applying run status", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    mkdirSync(join(dir, "events"));
    const terminal = planTerminalCompletion({
      runId: "run-123",
      chainName: "Build Chain",
      chainPath: join(dir, "chain.json"),
      taskId: "task-1",
      lastEvent: "done",
      lastAgentId: "writer",
      sessions: ["writer-run-123"],
      schedule: "daily",
      onComplete: "chain:next-chain",
    });

    const result = applyTypedExecutorPlan({
      action: "terminal",
      occurrenceId: "terminal-operation-occurrence",
      effects: [{ type: "terminal", plan: terminal }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
      eventsDir: join(dir, "events"),
    });

    expect(readRunJson(runJsonPath).status).toBe("completed");
    expect(result.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "task-status", status: "completed", taskId: "task-1" }),
      expect.objectContaining({ type: "schedule-mark", status: "success" }),
      expect.objectContaining({ type: "webhook", event: "chain_complete" }),
      expect.objectContaining({ type: "event", event: "chain-complete" }),
      expect.objectContaining({ type: "plugin", event: "chain-completed" }),
      expect.objectContaining({ type: "notification", event: "chain-completed" }),
      expect.objectContaining({ type: "hook", event: "run-completed" }),
      expect.objectContaining({ type: "metadata-webhooks", event: "completed" }),
      expect.objectContaining({ type: "next-chain", chainName: "next-chain" }),
    ]));
    expect(readFileSync(join(dir, "events", "run-123-Build_Chain-chain-complete.event"), "utf8")).toContain("event: chain-complete");
    const scheduleState = JSON.parse(readFileSync(join(dir, "schedules", "state.json"), "utf8"));
    expect(scheduleState["chain.json"]).toEqual(expect.any(Number));
    expect(readFileSync(join(dir, "schedules", "chain.json.history"), "utf8")).toContain("success");
    expect(jsonlRecords(join(dir, "watchdog-hooks", "dispatch.jsonl")).at(-1)).toMatchObject({
      event: "run-completed",
      runId: "run-123",
      hookCount: 0,
      status: "dispatched",
    });
  });

  it("records retry exhausted side-effect operations while applying stopped status", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const retryStatePath = join(dir, "retry", "retry_run-123_writer.json");
    mkdirSync(join(dir, "retry"), { recursive: true });
    writeFileSync(retryStatePath, JSON.stringify({ version: 1, runId: "run-123", agentId: "writer", attempt: 1, status: "active" }));

    const result = applyTypedExecutorPlan({
      action: "exhausted",
      occurrenceId: "retry-exhausted-occurrence",
      effects: [{
        type: "retry",
        plan: {
          action: "exhausted",
          maxRetries: 1,
          currentAttempt: 1,
          circuitBreaker: { threshold: 5, timeout: 300 },
          onError: "rollback",
          steps: [
            { type: "circuit-breaker", action: "record-failure", chainName: "Build Chain", agentId: "writer", threshold: 5, timeout: 300, failureId: "retry-failure:run-123:writer:1" },
            { type: "retry-state", action: "clear", agentId: "writer" },
            { type: "rollback", action: "plan-only", agentId: "writer", startSha: "abc123" },
            { type: "run-status", status: "stopped", reason: "agent error, retries exhausted" },
            { type: "task-status", status: "stopped", taskId: "task-1" },
            { type: "hook", event: "run-error", runId: "run-123", details: { run_id: "run-123" } },
            { type: "notification", event: "agent-failed", chainName: "Build Chain", runId: "run-123", agentId: "writer", reason: "failed" },
            { type: "plugin", event: "chain-stopped", chainName: "Build Chain", runId: "run-123", agentId: "writer" },
            { type: "notification", event: "chain-failed", chainName: "Build Chain", runId: "run-123", reason: "failed" },
            { type: "metadata-webhooks", event: "failed", chainName: "Build Chain", runId: "run-123" },
          ],
        },
      }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
    });

    expect(readRunJson(runJsonPath)).toMatchObject({
      status: "stopped",
      status_message: "agent error, retries exhausted",
    });
    expect(result.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "circuit-breaker", action: "record-failure" }),
      expect.objectContaining({ type: "retry-state", action: "clear" }),
      expect.objectContaining({ type: "rollback", action: "plan-only" }),
      expect.objectContaining({ type: "task-status", status: "stopped" }),
      expect.objectContaining({ type: "hook", event: "run-error" }),
      expect.objectContaining({ type: "notification", event: "agent-failed" }),
      expect.objectContaining({ type: "plugin", event: "chain-stopped" }),
      expect.objectContaining({ type: "metadata-webhooks", event: "failed" }),
    ]));
    expect(JSON.parse(readFileSync(retryStatePath, "utf8"))).toMatchObject({
      version: 1,
      runId: "run-123",
      agentId: "writer",
      attempt: 1,
      status: "exhausted",
    });
    expect(JSON.parse(readFileSync(onlyCircuitStatePath(dir), "utf8"))).toMatchObject({
      version: 1,
      chain_name: "Build Chain",
      agent_id: "writer",
      failure_count: 1,
      threshold: 5,
      timeout: 300,
    });
    expect(jsonlRecords(join(dir, "watchdog-hooks", "dispatch.jsonl")).at(-1)).toMatchObject({
      event: "run-error",
      runId: "run-123",
      hookCount: 0,
      status: "dispatched",
    });
  });

  it("applies retryable failure accounting and persists the next retry attempt", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);

    const result = applyTypedExecutorPlan({
      action: "retry",
      effects: [{
        type: "retry",
        plan: {
          action: "retry",
          nextAttempt: 1,
          maxRetries: 2,
          delayMs: 1000,
          delaySeconds: 1,
          strategy: "exponential",
          circuitBreaker: { threshold: 5, timeout: 300 },
          steps: [
            { type: "circuit-breaker", action: "record-failure", chainName: "Build Chain", agentId: "writer", threshold: 5, timeout: 300, failureId: "retry-failure:run-123:writer:0" },
            { type: "retry-state", action: "set", agentId: "writer", attempt: 1 },
          ],
          launch: { agentId: "writer", reason: "missing-event" },
        },
      }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
    });

    expect(result.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "circuit-breaker", action: "record-failure" }),
      expect.objectContaining({ type: "retry-state", action: "set", agentId: "writer", attempt: 1 }),
    ]));
    expect(JSON.parse(readFileSync(join(dir, "retry", "retry_run-123_writer.json"), "utf8"))).toEqual({
      version: 1,
      runId: "run-123",
      agentId: "writer",
      attempt: 1,
      status: "active",
    });
    expect(JSON.parse(readFileSync(onlyCircuitStatePath(dir), "utf8"))).toMatchObject({
      chain_name: "Build Chain",
      agent_id: "writer",
      failure_count: 1,
      threshold: 5,
      timeout: 300,
    });
  });

  it("deduplicates circuit failure accounting when an accepted retry replays after a later effect fails", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const plan = {
      action: "retry" as const,
      effects: [{
        type: "retry" as const,
        plan: {
          action: "retry" as const,
          nextAttempt: 1,
          maxRetries: 2,
          delayMs: 0,
          delaySeconds: 0,
          strategy: "fixed",
          circuitBreaker: { threshold: 5, timeout: 300 },
          steps: [
            {
              type: "circuit-breaker" as const,
              action: "record-failure" as const,
              chainName: "Build Chain",
              agentId: "writer",
              threshold: 5,
              timeout: 300,
              failureId: "retry-failure:run-123:writer:0",
            },
            { type: "retry-state" as const, action: "set" as const, agentId: "writer", attempt: 1 },
          ],
          launch: { agentId: "writer", reason: "missing-event" as const },
        },
      }],
      launches: [{
        kind: "single" as const,
        agentIds: ["writer"],
        command: "echo retry-writer",
        env: {
          MENTIKO_RUN_ID: "run-123",
          MENTIKO_COMPLETION_OCCURRENCE_ID: "retry-occurrence-1",
        },
      }],
    };
    (spawnSync as jest.Mock).mockClear();
    mockAcceptedLaunch(runJsonPath, "writer");
    expect(() => applyTypedExecutorPlan(plan, {
      runJsonPath,
      stateDir: dir,
      beforeOperation: (operation) => {
        if (operation.type === "retry-state") throw new Error("injected retry-state failure");
      },
    })).toThrow("injected retry-state failure");

    const circuitPath = onlyCircuitStatePath(dir);
    expect(JSON.parse(readFileSync(circuitPath, "utf8"))).toMatchObject({
      failure_count: 1,
      applied_failure_ids: ["retry-failure:run-123:writer:0"],
    });
    expect(spawnSync).toHaveBeenCalledTimes(1);

    applyTypedExecutorPlan(plan, { runJsonPath, stateDir: dir });
    expect(spawnSync).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readFileSync(circuitPath, "utf8"))).toMatchObject({
      failure_count: 1,
      applied_failure_ids: ["retry-failure:run-123:writer:0"],
    });
    expect(JSON.parse(readFileSync(join(dir, "retry", "retry_run-123_writer.json"), "utf8"))).toMatchObject({
      attempt: 1,
      status: "active",
    });
  });

  it("contains adversarial circuit names and retains exact old failure identities", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const context = { runJsonPath, stateDir: dir };
    for (let attempt = 0; attempt < 140; attempt += 1) {
      recordCircuitFailure({
        type: "circuit-breaker",
        action: "record-failure",
        chainName: "../../outside/nested",
        agentId: "../writer",
        threshold: 500,
        timeout: 300,
        failureId: `terminal-failure:run-123:writer:${attempt}`,
      }, context);
    }
    recordCircuitFailure({
      type: "circuit-breaker",
      action: "record-failure",
      chainName: "../../outside/nested",
      agentId: "../writer",
      threshold: 500,
      timeout: 300,
      failureId: "terminal-failure:run-123:writer:0",
    }, context);

    const retryRoot = resolve(dir, "retry");
    const circuitFiles = readdirSync(retryRoot).filter((name) => name.startsWith("circuit_") && name.endsWith(".json"));
    expect(circuitFiles).toHaveLength(1);
    const circuitPath = resolve(retryRoot, circuitFiles[0]);
    expect(circuitPath.startsWith(`${retryRoot}/`)).toBe(true);
    const circuit = JSON.parse(readFileSync(circuitPath, "utf8")) as {
      chain_name: string;
      agent_id: string;
      failure_count: number;
      applied_failure_ids: string[];
    };
    expect(circuit.chain_name).toBe("../../outside/nested");
    expect(circuit.agent_id).toBe("../writer");
    expect(circuit.failure_count).toBe(140);
    expect(circuit.applied_failure_ids).toHaveLength(140);
    expect(circuit.applied_failure_ids[0]).toBe("terminal-failure:run-123:writer:0");
    expect(existsSync(resolve(dir, "outside"))).toBe(false);
  });

  it("keeps sanitized identity aliases in distinct circuit records", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const context = { runJsonPath, stateDir: dir };
    const operation = (chainName: string, failureId: string) => ({
      type: "circuit-breaker" as const,
      action: "record-failure",
      chainName,
      agentId: "writer",
      threshold: 5,
      timeout: 300,
      failureId,
    });

    recordCircuitFailure(operation("a/b", "failure-a"), context);
    recordCircuitFailure(operation("a_b", "failure-b"), context);

    const paths = circuitStatePaths(dir);
    expect(paths).toHaveLength(2);
    const records = paths.map((path) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>);
    expect(new Set(records.map((record) => record.chain_name))).toEqual(new Set(["a/b", "a_b"]));
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ chain_name: "a/b", agent_id: "writer", applied_failure_ids: ["failure-a"] }),
      expect.objectContaining({ chain_name: "a_b", agent_id: "writer", applied_failure_ids: ["failure-b"] }),
    ]));
  });

  it("rejects a circuit record whose persisted raw identity was changed", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const context = { runJsonPath, stateDir: dir };
    const operation = {
      type: "circuit-breaker" as const,
      action: "record-failure",
      chainName: "Build Chain",
      agentId: "writer",
      threshold: 5,
      timeout: 300,
      failureId: "failure-a",
    };
    recordCircuitFailure(operation, context);
    const path = onlyCircuitStatePath(dir);
    const tampered = {
      ...JSON.parse(readFileSync(path, "utf8")),
      chain_name: "Other Chain",
    };
    writeFileSync(path, `${JSON.stringify(tampered)}\n`);
    const before = readFileSync(path, "utf8");

    expect(() => recordCircuitFailure({ ...operation, failureId: "failure-b" }, context))
      .toThrow(/mismatched circuit breaker identity/);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("dedupes one occurrence attempt but counts a later occurrence at the same attempt", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const context = { runJsonPath, stateDir: dir };
    const operation = (failureId: string) => ({
      type: "circuit-breaker" as const,
      action: "record-failure",
      chainName: "Build Chain",
      agentId: "writer",
      threshold: 5,
      timeout: 300,
      failureId,
    });
    recordCircuitFailure(operation("retry-failure:completion-occurrence-a:0"), context);
    recordCircuitFailure(operation("retry-failure:completion-occurrence-a:0"), context);
    recordCircuitFailure(operation("retry-failure:completion-occurrence-b:0"), context);

    expect(JSON.parse(readFileSync(onlyCircuitStatePath(dir), "utf8"))).toMatchObject({
      failure_count: 2,
      applied_failure_ids: [
        "retry-failure:completion-occurrence-a:0",
        "retry-failure:completion-occurrence-b:0",
      ],
    });
  });

  it("applies terminal-failure steps: queues external effects and records the circuit breaker", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);

    const result = applyTypedExecutorPlan({
      action: "fail",
      effects: [{
        type: "terminal-failure",
        plan: {
          reason: "no-completion-event",
          steps: [
            { type: "task-status", status: "failed", taskId: "task-1", runId: "run-123" },
            { type: "circuit-breaker", action: "record-failure", chainName: "Build Chain", agentId: "writer", threshold: 5, timeout: 300, failureId: "terminal-failure:run-123:writer:no-completion-event" },
            { type: "notification", event: "agent-failed", chainName: "Build Chain", runId: "run-123", agentId: "writer", reason: "no completion event" },
            { type: "metadata-webhooks", event: "failed", chainName: "Build Chain", runId: "run-123" },
          ],
        },
      }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
      namespaceId: "default",
      orgId: "default",
    });

    expect(result.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "task-status", status: "failed" }),
      expect.objectContaining({ type: "circuit-breaker", action: "record-failure" }),
      expect.objectContaining({ type: "notification", event: "agent-failed" }),
      expect.objectContaining({ type: "metadata-webhooks", event: "failed" }),
    ]));
    const outbox = readFileSync(join(dir, "external-effects.jsonl"), "utf8");
    expect(outbox).toContain("\"type\":\"task-status\"");
    expect(outbox).toContain("agent-failed");
    expect(outbox).toContain("\"namespaceId\":\"default\"");
    expect(JSON.parse(readFileSync(onlyCircuitStatePath(dir), "utf8"))).toMatchObject({
      failure_count: 1,
      threshold: 5,
      timeout: 300,
    });
  });

  it("dispatches executable watchdog hooks with explicit argv", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const hooksDir = join(dir, "hooks");
    mkdirSync(hooksDir, { recursive: true });
    const hookPath = join(hooksDir, "notify.sh");
    writeFileSync(hookPath, "#!/bin/bash\nexit 0\n");
    chmodSync(hookPath, 0o755);

    applyTypedExecutorPlan({
      action: "terminal",
      occurrenceId: "hook-dispatch-occurrence",
      effects: [{
        type: "terminal",
        plan: {
          reason: "no-downstream",
          steps: [
            { type: "run-status", status: "completed" },
            { type: "hook", event: "run-completed", runId: "run-123", details: { run_id: "run-123", task_id: "task-1" } },
          ],
        },
      }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
      hooksDir,
    });

    const hookCall = (spawn as jest.Mock).mock.calls.find((call) => call[1]?.[0] === hookPath);
    expect(hookCall?.slice(0, 3)).toEqual(["/bin/bash", expect.arrayContaining([
      hookPath,
      "run-completed",
      "run-123",
    ]), expect.objectContaining({
      detached: true,
      stdio: "ignore",
      env: expect.objectContaining({
        MENTIKO_COMPLETION_OCCURRENCE_ID: "hook-dispatch-occurrence",
        MENTIKO_IDEMPOTENCY_KEY: expect.stringMatching(/^runner-v2-completion-operation:/),
      }),
    })]);
    expect(JSON.parse(hookCall?.[1]?.[3])).toMatchObject({
      run_id: "run-123",
      task_id: "task-1",
      completion_occurrence_id: "hook-dispatch-occurrence",
      idempotency_key: expect.stringMatching(/^runner-v2-completion-operation:/),
    });
    expect(jsonlRecords(join(hooksDir, "dispatch.jsonl")).at(-1)).toMatchObject({
      event: "run-completed",
      runId: "run-123",
      hookCount: 1,
      status: "dispatched",
    });
  });

  it("audits session policy decisions without mutating sessions directly", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);

    applyTypedExecutorPlan({
      action: "terminal",
      occurrenceId: "session-policy-occurrence",
      effects: [{
        type: "terminal",
        plan: {
          reason: "no-downstream",
          steps: [
            { type: "run-status", status: "completed" },
            { type: "session-policy", policy: "stop", sessions: ["writer-run-123", "monitor-writer-run-123"] },
          ],
        },
      }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
    });

    expect(JSON.parse(readFileSync(join(dir, "session-policy.jsonl"), "utf8").trim())).toMatchObject({
      policy: "stop",
      sessions: ["writer-run-123", "monitor-writer-run-123"],
      applied: false,
      reason: "typed completion cleanup is applied separately after the verdict",
    });
  });

  it("launches resolved next-chain policies and audits missing chains", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const runsDir = join(dir, "runs");
    const chainsDir = join(dir, "chains");
    const deployChainDir = join(chainsDir, "deploy");
    mkdirSync(deployChainDir, { recursive: true });
    writeFileSync(join(deployChainDir, "chain.json"), JSON.stringify({ id: "deploy-chain", name: "deploy" }));
    (spawnSync as jest.Mock).mockImplementationOnce((command: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
      expect(command).toBe("node");
      expect(args).toEqual(expect.arrayContaining([
        expect.stringContaining("runner-v2-next-chain.js"),
        realpathSync(join(deployChainDir, "chain.json")),
        "--parent-run-id", "run-123", "--runs-dir", runsDir,
      ]));
      expect(options.env).not.toHaveProperty("MENTIKO_RUN_ID");
      expect(options.env).not.toHaveProperty("RUN_ID");
      expect(options.env).not.toHaveProperty("MENTIKO_RUN_DIR");
      seedNextChainChild(runsDir, { parentRunId: "run-123", chainName: "deploy", chainId: "deploy-chain" });
      return { status: 0, pid: 4242, stdout: "", stderr: "" };
    });

    const found = applyTypedExecutorPlan({
      action: "terminal",
      effects: [{
        type: "terminal",
        plan: {
          reason: "no-downstream",
          steps: [
            { type: "run-status", status: "completed" },
            { type: "next-chain", chainName: "deploy", parentRunId: "run-123" },
          ],
        },
      }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
      chainsDir,
      runsDir,
    });

    expect(found.launchesStarted).toEqual([expect.objectContaining({
      command: expect.stringContaining(join(deployChainDir, "chain.json")),
      pid: 4242,
    })]);
    expect(spawnSync).toHaveBeenCalledWith("node", expect.arrayContaining([
      expect.stringContaining("runner-v2-next-chain.js"),
      realpathSync(join(deployChainDir, "chain.json")),
      "--parent-run-id", "run-123", "--runs-dir", runsDir,
    ]), expect.objectContaining({
      timeout: expect.any(Number),
      env: expect.not.objectContaining({ MENTIKO_PARENT_RUN_ID: expect.anything() }),
    }));
    expect(JSON.parse(readFileSync(join(dir, "next-chain.jsonl"), "utf8").trim())).toMatchObject({
      chainName: "deploy",
      parentRunId: "run-123",
      status: "accepted",
      childRunId: "run-child",
    });

    applyTypedExecutorPlan({
      action: "terminal",
      effects: [{
        type: "terminal",
        plan: {
          reason: "no-downstream",
          steps: [
            { type: "run-status", status: "completed" },
            { type: "next-chain", chainName: "missing", parentRunId: "run-123" },
          ],
        },
      }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
      chainsDir,
      runsDir,
    });

    const records = readFileSync(join(dir, "next-chain.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(records[1]).toMatchObject({
      chainName: "missing",
      parentRunId: "run-123",
      status: "missing",
    });
  });

  it("recovers a next-chain child accepted before its ledger write without relaunching", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const runsDir = join(dir, "runs");
    const chainsDir = join(dir, "chains");
    const deployChainDir = join(chainsDir, "deploy");
    mkdirSync(deployChainDir, { recursive: true });
    writeFileSync(join(deployChainDir, "chain.json"), JSON.stringify({ id: "deploy-chain", name: "Deploy Chain" }));
    seedNextChainChild(runsDir, {
      id: "run-child-accepted",
      parentRunId: "run-123",
      chainName: "Deploy Chain",
      chainId: "deploy-chain",
    });
    (spawnSync as jest.Mock).mockClear();

    const plan = {
      action: "terminal" as const,
      effects: [{
        type: "terminal" as const,
        plan: {
          reason: "no-downstream" as const,
          steps: [{ type: "next-chain" as const, chainName: "deploy", parentRunId: "run-123" }],
        },
      }],
      launches: [],
    };
    applyTypedExecutorPlan(plan, { runJsonPath, stateDir: dir, chainsDir, runsDir });
    applyTypedExecutorPlan(plan, { runJsonPath, stateDir: dir, chainsDir, runsDir });

    expect(spawnSync).not.toHaveBeenCalled();
    const records = readFileSync(join(dir, "next-chain.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      parentRunId: "run-123",
      childRunId: "run-child-accepted",
      resolvedChainName: "Deploy Chain",
      status: "accepted",
      recovered: true,
      idempotencyKey: expect.any(String),
    });
  });

  it("keeps the terminal trigger active when next-chain acceptance exits nonzero", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const runsDir = join(dir, "runs");
    const chainsDir = join(dir, "chains");
    const deployChainDir = join(chainsDir, "deploy");
    mkdirSync(deployChainDir, { recursive: true });
    writeFileSync(join(deployChainDir, "chain.json"), JSON.stringify({ name: "deploy" }));
    const eventsDir = join(dir, "events");
    const triggeredPath = eventFile(eventsDir, "terminal.event", runnerEventFixture({ event: "done", source: "writer", runId: "run-123" }));
    const triggered = { ...parseRunnerEvent(readFileSync(triggeredPath, "utf8")), path: triggeredPath };
    (spawnSync as jest.Mock).mockReturnValueOnce({ status: 12, signal: null, stdout: "", stderr: "next launch rejected" });

    expect(() => applyTypedExecutorPlan({
      action: "terminal",
      effects: [
        {
          type: "terminal",
          plan: {
            reason: "no-downstream",
            steps: [
              { type: "run-status", status: "completed" },
              { type: "next-chain", chainName: "deploy", parentRunId: "run-123" },
            ],
          },
        },
        { type: "event-side-effects", plan: planCompletionEventSideEffects(triggered, [triggered], ["writer"]) },
      ],
      launches: [],
    }, { runJsonPath, stateDir: dir, chainsDir, eventsDir, runsDir })).toThrow(/nonzero_exit.*next-chain deploy/);

    expect(existsSync(triggeredPath)).toBe(true);
    expect(existsSync(join(eventsDir, "archive"))).toBe(false);
    expect(existsSync(join(dir, "next-chain.jsonl"))).toBe(false);
  });

  it("writes auditable outbox records for external terminal operations", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);

    applyTypedExecutorPlan({
      action: "terminal",
      effects: [{
        type: "terminal",
        plan: {
          reason: "no-downstream",
          steps: [
            { type: "run-status", status: "completed" },
            { type: "task-status", status: "completed", taskId: "task-1" },
            { type: "webhook", event: "chain_complete", chainId: "build-chain", chainPath: join(dir, "chain.json"), lastEvent: "done", lastAgentId: "writer" },
            { type: "plugin", event: "chain-completed", chainName: "Build Chain", runId: "run-123", agentId: "writer" },
            { type: "notification", event: "chain-completed", chainName: "Build Chain", runId: "run-123", agentId: "writer" },
            { type: "metadata-webhooks", event: "completed", chainId: "build-chain", chainPath: join(dir, "chain.json"), chainName: "Build Chain", runId: "run-123" },
            { type: "legacy-webhook", url: "https://hooks.example.test/chain", payload: { chain: "Build Chain", status: "complete" } },
          ],
        },
      }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
    });

    const records = readFileSync(join(dir, "external-effects.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "task-status", status: "queued", operation: expect.objectContaining({ taskId: "task-1" }) }),
      expect.objectContaining({ type: "webhook", status: "queued", operation: expect.objectContaining({ event: "chain_complete", chainId: "build-chain" }) }),
      expect.objectContaining({ type: "plugin", status: "queued", operation: expect.objectContaining({ event: "chain-completed" }) }),
      expect.objectContaining({ type: "notification", status: "queued", operation: expect.objectContaining({ event: "chain-completed" }) }),
      expect.objectContaining({ type: "metadata-webhooks", status: "queued", operation: expect.objectContaining({ event: "completed", chainId: "build-chain" }) }),
      expect.objectContaining({ type: "legacy-webhook", status: "queued", operation: expect.objectContaining({ url: "https://hooks.example.test/chain" }) }),
    ]));
    expect(records.every((record) => (
      typeof record.idempotencyKey === "string"
      && record.operation.idempotencyKey === record.idempotencyKey
    ))).toBe(true);
  });

  it("writes rollback as plan-only audit instead of mutating git state", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);

    applyTypedExecutorPlan({
      action: "exhausted",
      occurrenceId: "rollback-plan-occurrence",
      effects: [{
        type: "retry",
        plan: {
          action: "exhausted",
          maxRetries: 1,
          currentAttempt: 1,
          circuitBreaker: { threshold: 5, timeout: 300 },
          onError: "rollback",
          steps: [
            { type: "rollback", action: "plan-only", agentId: "writer", startSha: "abc123" },
            { type: "run-status", status: "stopped", reason: "agent error, retries exhausted" },
          ],
        },
      }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
    });

    expect(JSON.parse(readFileSync(join(dir, "rollback-plan.jsonl"), "utf8").trim())).toMatchObject({
      agentId: "writer",
      startSha: "abc123",
      action: "plan-only",
      applied: false,
      reason: "destructive rollback requires explicit operator approval",
    });
  });

  it("queues agent-completion steps to the external-effects outbox with tenant identity", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);

    const result = applyTypedExecutorPlan({
      action: "route",
      effects: [{
        type: "agent-completion",
        plan: {
          reason: "agent-complete",
          steps: [
            { type: "plugin", event: "agent-completed", chainName: "chain", runId: "run-123", agentId: "writer" },
            { type: "notification", event: "agent-completed", chainName: "chain", runId: "run-123", agentId: "writer" },
            { type: "legacy-webhook", url: "https://example.com/hook", payload: { event: "agent_complete", chain: "chain" } },
          ],
        },
      }],
      launches: [],
    }, {
      runJsonPath,
      stateDir: dir,
      namespaceId: "ns-1",
      orgId: "org-1",
    });

    expect(result.effectsApplied).toEqual(["agent-completion"]);
    expect(result.operations.map((operation) => operation.type)).toEqual(["plugin", "notification", "legacy-webhook"]);

    const outbox = readFileSync(join(dir, "external-effects.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(outbox).toHaveLength(3);
    expect(outbox.map((record) => record.type)).toEqual(["plugin", "notification", "legacy-webhook"]);
    expect(outbox.every((record) => record.status === "queued" && record.namespaceId === "ns-1" && record.orgId === "org-1")).toBe(true);
  });

  it("dedupes replay of one completion occurrence without collapsing a later occurrence", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const planFor = (occurrenceId: string) => ({
      action: "route" as const,
      effects: [{
        type: "agent-completion" as const,
        plan: {
          reason: "agent-complete" as const,
          steps: [
            { type: "plugin" as const, event: "agent-completed" as const, chainName: "chain", runId: "run-123", agentId: "writer", occurrenceId },
            { type: "notification" as const, event: "agent-completed" as const, chainName: "chain", runId: "run-123", agentId: "writer", occurrenceId },
          ],
        },
      }],
      launches: [],
    });
    const context = { runJsonPath, stateDir: dir, namespaceId: "ns-1", orgId: "org-1" };

    applyTypedExecutorPlan(planFor("event-a:attempt-1:round-1"), context);
    applyTypedExecutorPlan(planFor("event-a:attempt-1:round-1"), context);
    applyTypedExecutorPlan(planFor("event-b:attempt-1:round-2"), context);

    const outbox = readFileSync(join(dir, "external-effects.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { idempotencyKey: string; operation: { occurrenceId: string } });
    expect(outbox).toHaveLength(4);
    expect(new Set(outbox.map((record) => record.idempotencyKey)).size).toBe(4);
    expect(outbox.filter((record) => record.operation.occurrenceId === "event-a:attempt-1:round-1")).toHaveLength(2);
    expect(outbox.filter((record) => record.operation.occurrenceId === "event-b:attempt-1:round-2")).toHaveLength(2);
  });

  it("dispatches a hook once after a later failure, then lets a distinct completion occurrence dispatch independently", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const hooksDir = join(dir, "hooks");
    const eventsDir = join(dir, "events");
    mkdirSync(hooksDir, { recursive: true });
    const hookPath = join(hooksDir, "notify.sh");
    writeFileSync(hookPath, "#!/bin/bash\nexit 0\n");
    chmodSync(hookPath, 0o755);
    (spawn as jest.Mock).mockClear();

    const planFor = (occurrenceId: string, eventPath: string) => {
      const event = { ...parseRunnerEvent(readFileSync(eventPath, "utf8")), path: eventPath };
      return {
        action: "terminal" as const,
        occurrenceId,
        effects: [
          {
            type: "terminal" as const,
            plan: {
              reason: "no-downstream" as const,
              steps: [
                { type: "hook" as const, event: "run-completed" as const, runId: "run-123", details: { run_id: "run-123" } },
                { type: "session-policy" as const, policy: "keep" as const },
              ],
            },
          },
          {
            type: "event-side-effects" as const,
            plan: planCompletionEventSideEffects(event, [event], ["writer"]),
          },
        ],
        launches: [],
      };
    };

    const firstTrigger = eventFile(eventsDir, "first.event", runnerEventFixture({
      event: "done",
      source: "writer",
      runId: "run-123",
    }));
    const firstPlan = planFor("completion-occurrence-a", firstTrigger);
    let rejectLaterOperation = true;
    const context = {
      runJsonPath,
      stateDir: dir,
      hooksDir,
      eventsDir,
      beforeOperation: (operation: { type: string }) => {
        if (rejectLaterOperation && operation.type === "session-policy") {
          throw new Error("injected post-hook failure");
        }
      },
    };

    expect(() => applyTypedExecutorPlan(firstPlan, context)).toThrow("injected post-hook failure");
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(existsSync(firstTrigger)).toBe(true);

    rejectLaterOperation = false;
    applyTypedExecutorPlan(firstPlan, context);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(existsSync(firstTrigger)).toBe(false);

    const secondTrigger = eventFile(eventsDir, "second.event", runnerEventFixture({
      event: "done",
      source: "writer",
      runId: "run-123",
      timestamp: "2026-07-15T12:00:01.000Z",
    }));
    applyTypedExecutorPlan(planFor("completion-occurrence-b", secondTrigger), context);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(existsSync(secondTrigger)).toBe(false);

    const dispatch = readFileSync(join(hooksDir, "dispatch.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { status: string; occurrenceId: string; idempotencyKey: string });
    expect(dispatch.filter((record) => record.status === "dispatched")).toHaveLength(2);
    expect(new Set(dispatch.map((record) => record.idempotencyKey)).size).toBe(2);
    expect(dispatch.filter((record) => record.occurrenceId === "completion-occurrence-a")).toHaveLength(2);
    expect(dispatch.filter((record) => record.occurrenceId === "completion-occurrence-b")).toHaveLength(2);
  });

  it("keeps a durable emission receipt after archive consumption so replay cannot emit the same occurrence again", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const eventsDir = join(dir, "events");
    mkdirSync(eventsDir);
    const planFor = (occurrenceId: string) => ({
      action: "terminal" as const,
      occurrenceId,
      effects: [{
        type: "terminal" as const,
        plan: {
          reason: "no-downstream" as const,
          steps: [{ type: "event" as const, event: "chain-complete" as const, source: "chain", data: "terminal" }],
        },
      }],
      launches: [],
    });

    applyTypedExecutorPlan(planFor("completion-occurrence-a"), { runJsonPath, stateDir: dir, eventsDir });
    const [firstEvent] = readdirSync(eventsDir).filter((name) => name.endsWith(".event"));
    const firstPath = join(eventsDir, firstEvent);
    const first = { ...parseRunnerEvent(readFileSync(firstPath, "utf8")), path: firstPath };
    applyTypedExecutorPlan({
      action: "route",
      occurrenceId: "consumer-occurrence",
      effects: [{ type: "event-side-effects", plan: planCompletionEventSideEffects(first, [first], ["chain"]) }],
      launches: [],
    }, { runJsonPath, stateDir: dir, eventsDir });
    expect(existsSync(firstPath)).toBe(false);

    applyTypedExecutorPlan(planFor("completion-occurrence-a"), { runJsonPath, stateDir: dir, eventsDir });
    expect(readdirSync(eventsDir).filter((name) => name.endsWith(".event"))).toHaveLength(0);

    applyTypedExecutorPlan(planFor("completion-occurrence-b"), { runJsonPath, stateDir: dir, eventsDir });
    expect(readdirSync(eventsDir).filter((name) => name.endsWith(".event"))).toHaveLength(1);
    expect(readFileSync(join(dir, "completion-event-emissions.jsonl"), "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("dedupes schedule, session-policy, and rollback audits per occurrence", () => {
    const dir = tempDir();
    const runJsonPath = seedRun(dir);
    const planFor = (occurrenceId: string) => ({
      action: "exhausted" as const,
      occurrenceId,
      effects: [
        {
          type: "terminal" as const,
          plan: {
            reason: "no-downstream" as const,
            steps: [
              { type: "schedule-mark" as const, status: "success" as const, chainPath: join(dir, "chains", "build", "chain.json") },
              { type: "session-policy" as const, policy: "archive" as const },
            ],
          },
        },
        {
          type: "retry" as const,
          plan: {
            action: "exhausted" as const,
            maxRetries: 1,
            currentAttempt: 1,
            circuitBreaker: { threshold: 5, timeout: 300 },
            onError: "rollback",
            steps: [{ type: "rollback" as const, action: "plan-only" as const, agentId: "writer", startSha: "abc123" }],
          },
        },
      ],
      launches: [],
    });

    applyTypedExecutorPlan(planFor("completion-occurrence-a"), { runJsonPath, stateDir: dir });
    const scheduleStatePath = join(dir, "schedules", "state.json");
    const newerScheduleState = JSON.parse(readFileSync(scheduleStatePath, "utf8")) as Record<string, number>;
    newerScheduleState["build_chain.json"] += 60;
    writeFileSync(scheduleStatePath, `${JSON.stringify(newerScheduleState, null, 2)}\n`);
    applyTypedExecutorPlan(planFor("completion-occurrence-a"), { runJsonPath, stateDir: dir });
    expect(JSON.parse(readFileSync(scheduleStatePath, "utf8"))["build_chain.json"]).toBe(newerScheduleState["build_chain.json"]);
    applyTypedExecutorPlan(planFor("completion-occurrence-b"), { runJsonPath, stateDir: dir });

    const scheduleHistory = jsonlRecords(join(dir, "schedules", "build_chain.json.history"));
    const sessionPolicy = jsonlRecords(join(dir, "session-policy.jsonl"));
    const rollbackPlan = jsonlRecords(join(dir, "rollback-plan.jsonl"));
    for (const records of [scheduleHistory, sessionPolicy, rollbackPlan]) {
      expect(records).toHaveLength(2);
      expect(new Set(records.map((record) => record.idempotencyKey)).size).toBe(2);
      expect(records.map((record) => record.occurrenceId)).toEqual([
        "completion-occurrence-a",
        "completion-occurrence-b",
      ]);
    }
  });

  it("kills the monitor session before the agent session via the shell transport", async () => {
    const { killAgentSessions } = await import("@/lib/runner-v2/adapters");
    (spawnSync as jest.Mock).mockClear();
    (spawnSync as jest.Mock).mockImplementation((_cmd: string, args: string[]) => (
      args[0] === "alive"
        ? { status: 1, stdout: "", stderr: "not found" }
        : { status: 0, stdout: "removed", stderr: "" }
    ));

    const cleanup = killAgentSessions("workspace-writer-run-9", {
      env: {
        MENTIKO_GLOBAL_ROOT: "/tmp/runner-v2-cleanup-root",
        NAMESPACE_ID: "tenant-a",
        ORG_ID: "team-a",
        PTY_DAEMON: "wrong-inherited-daemon",
      },
    });

    expect(cleanup).toEqual({
      daemonName: expect.stringMatching(/^mentiko-.*-tenant-a-team-a$/),
      removed: ["monitor-workspace-writer-run-9", "workspace-writer-run-9"],
      failed: [],
    });
    const killCalls = (spawnSync as jest.Mock).mock.calls;
    expect(killCalls).toHaveLength(4);
    expect(killCalls[0][0]).toMatch(/bin\/p$/);
    expect(killCalls[0][1]).toEqual(["remove", "monitor-workspace-writer-run-9"]);
    expect(killCalls[1][1]).toEqual(["alive", "monitor-workspace-writer-run-9"]);
    expect(killCalls[2][1]).toEqual(["remove", "workspace-writer-run-9"]);
    expect(killCalls[3][1]).toEqual(["alive", "workspace-writer-run-9"]);
    expect(killCalls.every((call) => call[2].env.PTY_DAEMON === cleanup.daemonName)).toBe(true);
    expect(killCalls.every((call) => call[2].env.PTY_DAEMON !== "wrong-inherited-daemon")).toBe(true);
  });

  it("reports no removals when the transport kill fails", async () => {
    const { killAgentSessions } = await import("@/lib/runner-v2/adapters");
    (spawnSync as jest.Mock).mockClear();
    (spawnSync as jest.Mock).mockImplementation((_cmd: string, args: string[]) => (
      args[0] === "alive"
        ? { status: 0, stdout: "alive", stderr: "" }
        : { status: 1, stdout: "", stderr: "remove failed" }
    ));

    const stateDir = tempDir();
    expect(killAgentSessions("workspace-writer-run-9", { stateDir, runId: "run-9" })).toEqual(expect.objectContaining({
      removed: [],
      failed: ["monitor-workspace-writer-run-9", "workspace-writer-run-9"],
    }));
    expect(readFileSync(join(stateDir, "pty-cleanup.jsonl"), "utf8")).toContain("pty-cleanup-failed");
    expect(readFileSync(join(stateDir, "pty-cleanup.jsonl"), "utf8")).toContain('"retryable":true');

    (spawnSync as jest.Mock).mockReturnValue({ status: 0, stdout: "import ok", stderr: "" });
  });
});
