import { validateSchedule } from "../validators";

describe("validateSchedule", () => {
  it("accepts target-based generated task schedules without a chainId", () => {
    const result = validateSchedule({
      id: "hourly-bug-finder",
      target: {
        type: "generate_tasks",
        prompt: "Review the codebase and create tasks for bugs",
        workspacePath: "/Users/malmazan/dev/mentiko",
        autoRun: true,
      },
      cron: "0 * * * *",
      timezone: "UTC",
      enabled: true,
    });

    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("accepts file-trigger schedules without a cron expression", () => {
    const result = validateSchedule({
      id: "incoming-csv",
      target: {
        type: "raw_exec",
        executable: "python3",
        args: ["scripts/process.py", "{{file.path}}"],
        workingDirectory: "/Users/malmazan/dev/mentiko",
      },
      trigger: {
        type: "file",
        directory: "/drop/incoming",
        glob: "*.csv",
        events: ["created"],
      },
      enabled: true,
    });

    expect(result).toEqual({ valid: true, errors: [] });
  });
});
