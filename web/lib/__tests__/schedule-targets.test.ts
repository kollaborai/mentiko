import {
  canAdmitJobToGroup,
  requiresElevatedScheduleTargetPermission,
  normalizeScheduleTarget,
  renderScheduleTemplate,
  scheduleMatchesWorkspace,
  validateScheduleTarget,
} from "../schedule-targets";
import type { Schedule } from "../types";

describe("schedule-targets", () => {
  const legacySchedule = {
    id: "daily-review",
    name: "Daily Review",
    chainId: "review-chain",
    chainName: "Review Chain",
    cron: "0 9 * * *",
    timezone: "UTC",
    enabled: true,
    status: "enabled",
    retryCount: 0,
    runCount: 0,
    lastRun: null,
    nextRun: null,
  } satisfies Schedule;

  it("normalizes legacy chain schedules to chain_run targets", () => {
    expect(normalizeScheduleTarget(legacySchedule)).toEqual({
      type: "chain_run",
      chainId: "review-chain",
      goal: undefined,
      workspaceId: undefined,
    });
  });

  it("accepts raw executable targets as argv arrays instead of shell strings", () => {
    const errors = validateScheduleTarget({
      type: "raw_exec",
      executable: "python3",
      args: ["scripts/process.py", "--input", "{{file.path}}"],
      workingDirectory: "/Users/malmazan/dev/mentiko",
      timeoutMs: 120_000,
      successExitCodes: [0, 2],
    });

    expect(errors).toEqual([]);
  });

  it("rejects raw executable targets that try to smuggle shell syntax", () => {
    const errors = validateScheduleTarget({
      type: "raw_exec",
      executable: "python3 scripts/process.py && rm -rf /",
      args: [],
      workingDirectory: "/Users/malmazan/dev/mentiko",
    });

    expect(errors).toContain("target.executable must be a single executable path or name, not a shell command");
  });

  it("rejects raw executable targets without a working directory", () => {
    const errors = validateScheduleTarget({
      type: "raw_exec",
      executable: "python3",
      args: [],
    });

    expect(errors).toContain("target.workingDirectory is required for raw_exec targets");
  });

  it("rejects raw exec env overrides for server secrets", () => {
    const errors = validateScheduleTarget({
      type: "raw_exec",
      executable: "python3",
      args: [],
      workingDirectory: "/Users/malmazan/dev/mentiko",
      env: {
        BETTER_AUTH_SECRET: "nope",
      },
    });

    expect(errors).toContain("target.env.BETTER_AUTH_SECRET cannot override sensitive environment variables");
  });

  it("marks executable schedule targets as elevated", () => {
    expect(requiresElevatedScheduleTargetPermission({
      type: "raw_exec",
      executable: "python3",
      args: [],
      workingDirectory: "/Users/malmazan/dev/mentiko",
    })).toBe(true);

    expect(requiresElevatedScheduleTargetPermission({
      type: "registered_app",
      appId: "importer",
    })).toBe(true);

    expect(requiresElevatedScheduleTargetPermission({
      type: "chain_run",
      chainId: "review-chain",
    })).toBe(false);
  });

  it("renders trigger payload values into prompts and raw exec args", () => {
    const rendered = renderScheduleTemplate(
      "Process {{file.name}} from {{file.directory}} at {{triggeredAt}}",
      {
        triggeredAt: "2026-05-05T18:00:00.000Z",
        file: {
          path: "/drop/incoming/orders.csv",
          name: "orders.csv",
          directory: "/drop/incoming",
          extension: ".csv",
        },
      },
    );

    expect(rendered).toBe("Process orders.csv from /drop/incoming at 2026-05-05T18:00:00.000Z");
  });

  it("admits only one running job when a group has maxConcurrent 1", () => {
    expect(canAdmitJobToGroup({ maxConcurrent: 1, running: 0, policy: "queue" })).toEqual({
      admitted: true,
      action: "start",
    });

    expect(canAdmitJobToGroup({ maxConcurrent: 1, running: 1, policy: "queue" })).toEqual({
      admitted: false,
      action: "queue",
    });
  });

  it("matches workspace-scoped generated schedules by id or registered path", () => {
    const generatedSchedule = {
      ...legacySchedule,
      id: "daily-task-generator",
      name: "Daily Task Generator",
      workspaceId: "/Users/malmazan/dev/mentiko",
      target: {
        type: "generate_tasks",
        prompt: "Find bugs",
        workspacePath: "/Users/malmazan/dev/mentiko",
        autoRun: true,
      },
    } satisfies Schedule;

    expect(scheduleMatchesWorkspace(generatedSchedule, "local", "/Users/malmazan/dev/mentiko")).toBe(true);
    expect(scheduleMatchesWorkspace(generatedSchedule, "other", "/tmp/other")).toBe(false);
    expect(scheduleMatchesWorkspace(legacySchedule, "local", "/Users/malmazan/dev/mentiko")).toBe(true);
  });
});
