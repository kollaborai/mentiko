import { existsSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runSyntheticRunnerV2Probe, runSyntheticRunnerV2ProbeWithDispatch } from "@/lib/runner-v2/probe";
import { readRunJson } from "@/lib/runner-v2/run-state";
import { spawn } from "child_process";

jest.mock("child_process", () => ({
  ...jest.requireActual("child_process"),
  spawn: jest.fn(() => ({ pid: 4242, unref: jest.fn() })),
}));

jest.mock("@/lib/config", () => ({
  __esModule: true,
  default: {
    codeRoot: "/repo",
  },
}));

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
          command: expect.stringContaining("--start 'reviewer'"),
          env: { MENTIKO_RUN_ID: "run-probe", MENTIKO_RUNNER_V2: "1" },
        }],
      },
      adapter: {
        effectsApplied: ["event-side-effects"],
        launchesStarted: [{ command: expect.stringContaining("--start 'reviewer'"), pid: undefined }],
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
    const result = runSyntheticRunnerV2Probe({
      runDir: dir,
      env: { MENTIKO_RUNNER_V2: "1" },
      dryRun: false,
    });

    expect(result).toMatchObject({
      status: "ok",
      mode: "live",
      adapter: {
        launchesStarted: [{ command: expect.stringContaining("--start 'reviewer'"), pid: 4242 }],
      },
    });
    expect(readFileSync(join(dir, "events", "run-probe-writer-draft-ready.event"), "utf8")).toContain("processed: true");
    expect(spawn).toHaveBeenCalledWith(
      "/bin/bash",
      ["-lc", expect.stringContaining("--start 'reviewer'")],
      expect.objectContaining({
        detached: true,
      }),
    );
  });

  it("can run the live probe external-effects dispatcher when explicitly requested", async () => {
    const dir = runDir();
    const result = await runSyntheticRunnerV2ProbeWithDispatch({
      runDir: dir,
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
