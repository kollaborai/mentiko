import { existsSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runSyntheticRunnerV2Probe, runSyntheticRunnerV2ProbeWithDispatch } from "@/lib/runner-v2/probe";
import { readRunJson, updateRunJson, type RunAgentRecord } from "@/lib/runner-v2/run-state";
import { spawn, spawnSync } from "child_process";

jest.mock("child_process", () => ({
  ...jest.requireActual("child_process"),
  spawn: jest.fn(() => ({ pid: 4242, unref: jest.fn() })),
  spawnSync: jest.fn(() => ({ status: 0, stdout: "", stderr: "" })),
}));

jest.mock("@/lib/config", () => {
  const config = {
    root: "/repo",
    codeRoot: "/repo",
    globalRoot: "/repo/.mentiko",
  };
  return {
    __esModule: true,
    default: config,
    config,
    orgPath: (namespaceId: string, orgId: string, ...segments: string[]) =>
      [config.globalRoot, "namespaces", namespaceId, ...(orgId === "default" ? [] : ["orgs", orgId]), ...segments].join("/"),
  };
});

jest.mock("@/lib/api/audit-exec", () => ({
  shellEscape: (value: string) => `'${value.replace(/'/g, "'\\''")}'`,
}));

jest.mock("@/lib/webhooks/webhook-utils", () => ({
  fireWebhooks: jest.fn(() => Promise.resolve()),
}));

jest.mock("@/lib/notifications/notification-server", () => ({
  createNotification: jest.fn(),
}));

function runDir() {
  return mkdtempSync(join(tmpdir(), "runner-v2-probe-"));
}

// startLaunch (lib/runner-v2/adapters.ts:275-337) durably accepts a routed
// launch by running the transport (spawnSync) synchronously and then
// re-reading run.json for a matching runnerV2 attempt -- exit 0 alone is not
// enough (nonzero_exit), and no attempt at all is `missing_durable_state`.
// Mirror adapters.test.ts's mockAcceptedLaunch: have the mocked spawnSync
// transport itself write the accepted agent + attempt as a side effect,
// exactly like the real launcher script would via its own PTY bootstrap.
function acceptReviewerLaunch(runJsonPath: string) {
  (spawnSync as jest.Mock).mockImplementationOnce(() => {
    const session = "reviewer-run-probe";
    updateRunJson(runJsonPath, (current) => {
      if (!current) throw new Error("missing run fixture");
      const agents = current.agents || [];
      const hasAgent = agents.some((agent) => agent.id === "reviewer");
      const acceptedAgent = { id: "reviewer", name: "reviewer", status: "running", session } satisfies RunAgentRecord;
      const runnerV2 = current.runnerV2 && typeof current.runnerV2 === "object"
        ? current.runnerV2 as Record<string, unknown>
        : {};
      const attempts = Array.isArray(runnerV2.attempts) ? runnerV2.attempts : [];
      return {
        ...current,
        agents: hasAgent
          ? agents.map((agent) => agent.id === "reviewer" ? { ...agent, ...acceptedAgent } : agent)
          : [...agents, acceptedAgent],
        sessions: Array.from(new Set([...(current.sessions || []), session])),
        runnerV2: {
          ...runnerV2,
          attempts: [
            ...attempts,
            {
              id: `run-probe:reviewer:${attempts.length + 1}`,
              runId: "run-probe",
              agentId: "reviewer",
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

describe("runner-v2 synthetic probe", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("skips when MENTIKO_RUNNER_V2 is off", () => {
    expect(runSyntheticRunnerV2Probe({
      runDir: runDir(),
      env: {},
    })).toEqual({
      status: "skipped",
      reason: "flag-off",
    });
  });

  it("runs the typed dry-run path when MENTIKO_RUNNER_V2 is enabled", () => {
    const dir = runDir();
    const result = runSyntheticRunnerV2Probe({
      runDir: dir,
      eventsDir: join(dir, "events"),
      env: { MENTIKO_RUNNER_V2: "1" },
    });

    expect(result).toMatchObject({
      status: "ok",
      mode: "dry-run",
      plan: {
        action: "route",
        effects: [{ type: "event-side-effects" }],
        launches: [{
          kind: "single",
          command: expect.stringMatching(/runner-v2-launch-agent.*'reviewer'/),
          env: { MENTIKO_RUN_ID: "run-probe", MENTIKO_RUNNER_V2: "1" },
        }],
      },
      adapter: {
        effectsApplied: ["event-side-effects"],
        launchesStarted: [{ command: expect.stringMatching(/runner-v2-launch-agent.*'reviewer'/), pid: undefined }],
      },
    });
    if (result.status !== "ok") {
      throw new Error("expected probe ok");
    }

    expect(existsSync(result.runJsonPath)).toBe(true);
    expect(readRunJson(result.runJsonPath)).toMatchObject({
      id: "run-probe",
      status: "running",
      agents: [{ id: "writer", status: "complete" }],
    });
    expect(readFileSync(join(dir, "events", "run-probe-writer-draft-ready.event"), "utf8")).toContain("processed: false");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("runs the typed live probe path only when explicitly requested", () => {
    const dir = runDir();
    acceptReviewerLaunch(join(dir, "run.json"));

    const result = runSyntheticRunnerV2Probe({
      runDir: dir,
      eventsDir: join(dir, "events"),
      env: { MENTIKO_RUNNER_V2: "1" },
      dryRun: false,
    });

    expect(result).toMatchObject({
      status: "ok",
      mode: "live",
      adapter: {
        launchesStarted: [{ command: expect.stringMatching(/runner-v2-launch-agent.*'reviewer'/), pid: 4242 }],
      },
    });
    // A live (non-dry-run) consumption archives the source event and unlinks
    // it (event-lifecycle.ts processAndArchiveUnlocked -> unlinkArchivedSource),
    // it does not leave "processed: true" written in place at the original
    // path -- see the same archive-then-remove contract asserted throughout
    // adapters.test.ts (e.g. its "triggeredPath" existsSync(false) checks).
    expect(existsSync(join(dir, "events", "run-probe-writer-draft-ready.event"))).toBe(false);
    expect(readFileSync(join(dir, "events", "archive", "run-probe-writer-draft-ready.event"), "utf8")).toContain("processed: true");
    // The routed launch is durably accepted synchronously via spawnSync
    // (adapters.ts:304) -- this is a preflight transport check, not a
    // fire-and-forget detached process, so the async `spawn` mock must stay
    // untouched for this path. `launch.cli` is populated, so adapters.ts
    // takes the structured-invocation branch (executable=process.execPath,
    // args=[launcher script, chainPath, agentId]) rather than "/bin/bash -lc".
    expect(spawnSync).toHaveBeenCalledWith(
      process.execPath,
      [
        expect.stringContaining("runner-v2-launch-agent.cjs"),
        join(dir, "chain.json"),
        "reviewer",
      ],
      expect.objectContaining({
        env: expect.objectContaining({ MENTIKO_RUN_ID: "run-probe", MENTIKO_RUNNER_V2: "1" }),
      }),
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it("can run the live probe external-effects dispatcher when explicitly requested", async () => {
    const dir = runDir();
    acceptReviewerLaunch(join(dir, "run.json"));
    const result = await runSyntheticRunnerV2ProbeWithDispatch({
      runDir: dir,
      eventsDir: join(dir, "events"),
      env: { MENTIKO_RUNNER_V2: "1" },
      dryRun: false,
      dispatchExternalEffects: true,
      namespaceId: "default",
      orgId: "default",
    });

    expect(result).toMatchObject({
      status: "ok",
      mode: "live",
      externalDispatch: {
        handled: expect.any(Number),
        dispatched: 3,
        failed: 0,
      },
    });
    expect(readFileSync(join(dir, "external-effects.jsonl"), "utf8")).toContain("\"status\":\"queued\"");
    expect(readFileSync(join(dir, "external-effects.dispatch.jsonl"), "utf8")).toContain("\"status\":\"dispatched\"");
  });
});
