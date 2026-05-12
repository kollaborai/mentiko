import {
  buildScheduleCreateRequest,
  getScheduleCreateTargetLabel,
  parseScheduleArgs,
} from "../schedule-create-payload";
import {
  buildGenerateScheduleDraft,
  getGenerateScheduleCron,
} from "../schedule-generate-draft";

const chains = [{ id: "review-chain", name: "Review Chain" }];
const workspaces = [{ id: "local", name: "Local", path: "/Users/malmazan/dev/mentiko" }];

describe("schedule-create-payload", () => {
  it("builds a generated task schedule with workspace context and auto-run", () => {
    const request = buildScheduleCreateRequest({
      chains,
      workspaces,
      draft: {
        name: "Hourly Bug Finder",
        description: "Create repair tasks from codebase review",
        targetType: "generate_tasks",
        workspaceId: "local",
        generatePrompt: "Find bugs and create tasks",
        autoRun: true,
        triggerType: "cron",
        cron: "0 * * * *",
        timezone: "UTC",
        retryCount: 1,
        enabled: false,
      },
    });

    expect(request).toEqual({
      name: "Hourly Bug Finder",
      description: "Create repair tasks from codebase review",
      cron: "0 * * * *",
      timezone: "UTC",
      trigger: { type: "cron", cron: "0 * * * *", timezone: "UTC" },
      target: {
        type: "generate_tasks",
        prompt: "Find bugs and create tasks",
        workspacePath: "/Users/malmazan/dev/mentiko",
        autoRun: true,
      },
      workspacePath: "/Users/malmazan/dev/mentiko",
      retryCount: 1,
      enabled: false,
    });
  });

  it("builds a raw executable file trigger that can template the landed file", () => {
    const request = buildScheduleCreateRequest({
      chains,
      workspaces,
      draft: {
        name: "Import Orders",
        targetType: "raw_exec",
        rawExecutable: "python3",
        rawWorkingDirectory: "/Users/malmazan/dev/mentiko",
        rawArgsText: "scripts/import_orders.py\n--input\n{{file.path}}",
        rawTimeoutMs: "120000",
        rawSuccessExitCodesText: "0,2",
        triggerType: "file",
        fileDirectory: "/Users/malmazan/drop",
        fileGlob: "*.csv",
        fileStableForMs: "5000",
        jobGroupId: "imports",
        cron: "0 9 * * *",
        timezone: "UTC",
        retryCount: 0,
        enabled: true,
      },
    });

    expect(request).toMatchObject({
      target: {
        type: "raw_exec",
        executable: "python3",
        args: ["scripts/import_orders.py", "--input", "{{file.path}}"],
        workingDirectory: "/Users/malmazan/dev/mentiko",
        timeoutMs: 120000,
        successExitCodes: [0, 2],
      },
      trigger: {
        type: "file",
        directory: "/Users/malmazan/drop",
        glob: "*.csv",
        events: ["created"],
        stableForMs: 5000,
        passFileAs: "template_context",
      },
      jobGroupId: "imports",
      enabled: true,
    });
  });

  it("keeps legacy chain fields while also sending a chain_run target", () => {
    const request = buildScheduleCreateRequest({
      chains,
      workspaces,
      draft: {
        name: "Daily Review",
        targetType: "chain_run",
        chainId: "review-chain",
        workspaceId: "local",
        goal: "Review the repo",
        triggerType: "cron",
        cron: "0 9 * * *",
        timezone: "UTC",
        retryCount: 0,
        enabled: true,
      },
    });

    expect(request).toMatchObject({
      chainId: "review-chain",
      chainName: "Review Chain",
      workspacePath: "local",
      goal: "Review the repo",
      target: {
        type: "chain_run",
        chainId: "review-chain",
        workspaceId: "local",
        goal: "Review the repo",
      },
    });
  });

  it("parses one argv entry per line and leaves shell splitting out of it", () => {
    expect(parseScheduleArgs("script.py\n--name\nhello world\n")).toEqual([
      "script.py",
      "--name",
      "hello world",
    ]);
  });

  it("labels target kinds for list and detail summaries", () => {
    expect(getScheduleCreateTargetLabel({ type: "generate_tasks", prompt: "x" })).toBe("Generate Tasks");
    expect(getScheduleCreateTargetLabel({ type: "raw_exec", executable: "python3" })).toBe("Raw Exec");
  });

  it("builds a generate-tasks schedule draft from a prompt and cadence", () => {
    const draft = buildGenerateScheduleDraft({
      prompt: "Look at the codebase and create tasks to fix bugs",
      cadence: "hourly",
      timezone: "UTC",
      workspaceId: "local",
      autoRun: true,
      jobGroupId: "repo-maintenance",
    });

    const request = buildScheduleCreateRequest({ chains, workspaces, draft });

    expect(draft).toMatchObject({
      name: "Hourly Task Generator",
      targetType: "generate_tasks",
      generatePrompt: "Look at the codebase and create tasks to fix bugs",
      autoRun: true,
      triggerType: "cron",
      cron: "0 * * * *",
      timezone: "UTC",
      workspaceId: "local",
      jobGroupId: "repo-maintenance",
      enabled: true,
    });
    expect(request).toMatchObject({
      name: "Hourly Task Generator",
      target: {
        type: "generate_tasks",
        prompt: "Look at the codebase and create tasks to fix bugs",
        workspacePath: "/Users/malmazan/dev/mentiko",
        autoRun: true,
      },
      trigger: { type: "cron", cron: "0 * * * *", timezone: "UTC" },
      workspacePath: "/Users/malmazan/dev/mentiko",
      jobGroupId: "repo-maintenance",
    });
  });

  it("falls back to the daily cadence when a custom cron is empty", () => {
    expect(getGenerateScheduleCron("custom", "")).toBe("0 9 * * *");
    expect(getGenerateScheduleCron("weekly")).toBe("0 9 * * 1");
  });
});
