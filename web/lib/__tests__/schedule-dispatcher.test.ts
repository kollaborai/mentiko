import { dispatchScheduleTarget } from "../schedule-dispatcher";

describe("schedule-dispatcher", () => {
  const payload = {
    triggeredAt: "2026-05-05T18:00:00.000Z",
    file: {
      path: "/drop/incoming/orders.csv",
      name: "orders.csv",
      directory: "/drop/incoming",
      extension: ".csv",
    },
  };

  it("dispatches raw executable targets with rendered argv values", async () => {
    const runRawExec = jest.fn().mockResolvedValue({
      success: true,
      exitCode: 0,
    });

    const result = await dispatchScheduleTarget({
      target: {
        type: "raw_exec",
        executable: "python3",
        args: ["scripts/process.py", "{{file.path}}"],
        workingDirectory: "/Users/malmazan/dev/mentiko",
      },
      payload,
      adapters: { runRawExec },
    });

    expect(result).toEqual({ success: true, kind: "raw_exec", exitCode: 0 });
    expect(runRawExec).toHaveBeenCalledWith({
      executable: "python3",
      args: ["scripts/process.py", "/drop/incoming/orders.csv"],
      workingDirectory: "/Users/malmazan/dev/mentiko",
      env: undefined,
      timeoutMs: undefined,
      successExitCodes: undefined,
    });
  });

  it("dispatches generated task targets with rendered prompts and auto-run", async () => {
    const generateTasks = jest.fn().mockResolvedValue({
      success: true,
      parentId: "TASK-001",
    });

    const result = await dispatchScheduleTarget({
      target: {
        type: "generate_tasks",
        prompt: "Look at {{file.name}} and create repair tasks",
        workspacePath: "/Users/malmazan/dev/mentiko",
        autoRun: true,
      },
      payload,
      adapters: { generateTasks },
    });

    expect(result).toEqual({ success: true, kind: "generate_tasks", parentId: "TASK-001" });
    expect(generateTasks).toHaveBeenCalledWith({
      prompt: "Look at orders.csv and create repair tasks",
      workspacePath: "/Users/malmazan/dev/mentiko",
      autoRun: true,
    });
  });
});
