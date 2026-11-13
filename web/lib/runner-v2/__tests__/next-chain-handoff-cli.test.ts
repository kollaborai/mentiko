/** @jest-environment node */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

jest.mock("@/lib/pty/pty-client", () => ({
  pty: {
    remove: jest.fn(),
    list: jest.fn(),
    spawn: jest.fn(),
    sendKeys: jest.fn(),
    capture: jest.fn(),
  },
}));

import { parseNextChainLaunchArgs } from "@/lib/runner-v2/next-chain-launch";
import { runTypedDirect } from "@/lib/runner-v2/direct-run";
import {
  cleanupCompletionLaunchContext,
  consumeCompletionLaunchContext,
  createCompletionLaunchContext,
} from "@/lib/runner-v2/completion-launch-context";
import { persistRoutedLaunchJob } from "@/lib/runner-v2/launch-job";
import { runRoutedLaunchJob } from "@/lib/runner-v2/launch-job-runner";

const ptyMock = jest.requireMock("@/lib/pty/pty-client").pty as {
  remove: jest.Mock;
  list: jest.Mock;
  spawn: jest.Mock;
  sendKeys: jest.Mock;
  capture: jest.Mock;
};

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "runner-v2-next-chain-cli-"));
}

const cliSources: Array<[string, { reviewerCli?: string; chainCli?: string; environmentCli?: string }]> = [
  ["MENTIKO_CLI", { environmentCli: "codex" }],
  ["agents[].cli", { reviewerCli: "codex" }],
  ["config.cli", { chainCli: "codex" }],
];

describe("next-chain handoff CLI selection", () => {
  beforeEach(() => {
    ptyMock.remove.mockReset().mockResolvedValue(undefined);
    ptyMock.list.mockReset().mockResolvedValue([]);
    ptyMock.spawn.mockReset().mockImplementation(async (name: string) => ({ name, pid: 123 }));
    ptyMock.sendKeys.mockReset().mockResolvedValue(undefined);
    ptyMock.capture.mockReset().mockResolvedValue("codex ready >\n❯ ");
  });

  it.each(cliSources)("uses codex from %s for the second agent after next-chain handoff when coordinator MENTIKO_CLI is unset", async (_source, selection) => {
    const root = tempDir();
    const workspace = join(root, "workspace");
    const runsDir = join(root, "runs");
    const profilesDir = join(root, "profiles");
    mkdirSync(workspace, { recursive: true });
    mkdirSync(profilesDir, { recursive: true });

    const chainPath = join(root, "two-agent-chain.json");
    writeFileSync(chainPath, `${JSON.stringify({
      name: "Two Agent Handoff",
      description: "Exercise the second agent after a next-chain handoff.",
      config: {
        project_root: workspace,
        monitor: false,
        ...(selection.chainCli ? { cli: selection.chainCli } : {}),
      },
      agents: [
        { id: "writer", name: "Writer", triggers: ["manual-start"], emits: "draft-ready" },
        {
          id: "reviewer",
          name: "Reviewer",
          triggers: ["draft-ready"],
          emits: "reviewed",
          ...(selection.reviewerCli ? { cli: selection.reviewerCli } : {}),
        },
      ],
    }, null, 2)}\n`);

    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH || "/usr/bin:/bin",
      HOME: root,
      NODE_ENV: "test",
      MENTIKO_ORG_ROOT: root,
      AGENT_PROFILES_DIR: profilesDir,
      EVENTS_DIR: join(root, "events"),
      STATE_DIR: join(root, "state"),
      MENTIKO_CAP_DISABLED: "1",
      ...(selection.environmentCli ? { MENTIKO_CLI: selection.environmentCli } : {}),
    };

    const nextChain = parseNextChainLaunchArgs([
      chainPath,
      "--parent-run-id", "run-parent",
      "--runs-dir", runsDir,
    ]);
    const child = await runTypedDirect({
      ...nextChain,
      runId: "run-next-chain-child",
      workspacePath: workspace,
      debug: false,
      env,
    });
    if (child.dryRun) throw new Error("next-chain run unexpectedly dry-ran");

    const runJsonPath = join(child.runDir, "run.json");
    expect(JSON.parse(readFileSync(runJsonPath, "utf8"))).toMatchObject({
      parent_run_id: "run-parent",
      agents: [
        { id: "writer", status: "running" },
      ],
    });

    const writerStart = readFileSync(join(child.runDir, "artifacts", "writer-start.sh"), "utf8");
    expect(writerStart).toContain(`exec '${selection.reviewerCli ? "claude" : "codex"}'`);
    const monitorCall = ptyMock.spawn.mock.calls.find(([name]) => String(name).startsWith("monitor-"));
    const monitorEnv = (monitorCall?.[3] as { env?: NodeJS.ProcessEnv } | undefined)?.env;
    expect(monitorEnv?.MENTIKO_CLI).toBe(selection.environmentCli);

    if (!monitorEnv) throw new Error("writer monitor did not receive its run context");
    const completionContext = createCompletionLaunchContext(monitorEnv);
    const completionEnv: NodeJS.ProcessEnv = { NODE_ENV: "test" };
    try {
      consumeCompletionLaunchContext(completionContext.path, completionEnv);
    } finally {
      cleanupCompletionLaunchContext(completionContext.path);
    }

    const handoff = persistRoutedLaunchJob({
      runJsonPath,
      occurrenceId: `${child.runId}:writer:draft-ready`,
      runId: child.runId,
      runDir: child.runDir,
      chainPath: join(child.runDir, "chain.json"),
      targetAgentIds: ["reviewer"],
      environment: completionEnv,
    });
    const coordinatorEnv: NodeJS.ProcessEnv = { ...env };
    delete coordinatorEnv.MENTIKO_CLI;
    const routed = await runRoutedLaunchJob({
      runJsonPath,
      jobId: handoff.id,
      ownerId: "test-next-chain-handoff",
      dependencies: { processEnv: coordinatorEnv },
    });

    expect(routed).toMatchObject({ status: "completed", jobId: handoff.id });
    expect(handoff.environment.MENTIKO_CLI).toBe(selection.environmentCli);
    expect(ptyMock.spawn).toHaveBeenCalledWith(
      expect.stringContaining("reviewer-run-next-chain-child"),
      expect.any(String),
      [],
      expect.any(Object),
    );
    expect(readFileSync(join(child.runDir, "artifacts", "reviewer-start.sh"), "utf8"))
      .toContain("exec 'codex'");
  });
});
