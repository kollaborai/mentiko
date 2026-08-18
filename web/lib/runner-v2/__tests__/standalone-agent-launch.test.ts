import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type config from "@/lib/config";
import { parseRunnerAgentState } from "@/lib/runner-v2/agent-state";
import {
  launchStandaloneAgent,
  standaloneAgentInstruction,
  standaloneSessionName,
} from "@/lib/runner-v2/standalone-agent-launch";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "mentiko-standalone-launch-"));
}

function runtimeConfig(root: string): typeof config {
  return {
    globalRoot: join(root, "workspace"),
    codeRoot: join(root, "code"),
    namespaceRoot: join(root, "namespace"),
    orgRoot: join(root, "org"),
    projectRoot: join(root, "project"),
    runsDir: join(root, "runs"),
    eventsDir: join(root, "events"),
    stateDir: join(root, "state"),
    libDir: join(root, "lib"),
    namespaceId: "test-ns",
    orgId: "test-org",
    cliBin: "claude",
  } as unknown as typeof config;
}

describe("typed standalone agent launch", () => {
  it("owns spec launch identity, direct CLI PTY spawn, prompt injection, and state publication", async () => {
    const root = tempRoot();
    const specPath = join(root, "reviewer.yaml");
    writeFileSync(specPath, "name: Reviewer\nrole: verifies changes\nsession-prefix: reviewer\n");
    const spawned: Array<{ name: string; cmd: string; args: string[]; opts?: unknown }> = [];
    const writes: Array<{ name: string; text: string }> = [];
    const raw: Array<{ name: string; text: string }> = [];
    const config = runtimeConfig(root);

    const result = await launchStandaloneAgent({ specPath, cli: "codex" }, {
      config,
      now: () => new Date(2026, 6, 16, 9, 5),
      delay: async () => undefined,
      pty: {
        spawn: async (name, cmd = "zsh", args = [], opts) => {
          spawned.push({ name, cmd, args, opts });
          return { name, pid: 4242 };
        },
        sendKeys: async (name, text) => { writes.push({ name, text }); },
        sendRaw: async (name, text) => { raw.push({ name, text }); },
        remove: async () => undefined,
      },
      writeLog: () => undefined,
    });

    expect(result).toMatchObject({
      sessionName: "workspace-reviewer-20260716-0905",
      pid: 4242,
      agent: { name: "Reviewer", role: "verifies changes", sessionPrefix: "reviewer" },
    });
    expect(spawned).toEqual([expect.objectContaining({
      name: "workspace-reviewer-20260716-0905",
      cmd: "codex",
      args: [],
      opts: expect.objectContaining({ cwd: join(root, "workspace") }),
    })]);
    expect(writes).toEqual([expect.objectContaining({
      name: result.sessionName,
      text: expect.stringContaining(`Your agent spec is at: ${specPath}`),
    })]);
    expect(raw).toEqual([{ name: result.sessionName, text: "\r" }]);
    expect(parseRunnerAgentState(readFileSync(result.statePath, "utf8"))).toMatchObject({
      status: "running",
      session: result.sessionName,
      agent_id: "reviewer",
      pid: "4242",
      workspace: "local",
    });
  });

  it("starts the typed monitor with explicit runtime roots and rolls back when monitor startup fails", async () => {
    const root = tempRoot();
    const specPath = join(root, "reviewer.yaml");
    const config = runtimeConfig(root);
    writeFileSync(specPath, "name: Reviewer\nsession-prefix: reviewer\n");
    writeFileSync(join(root, "runner-v2-standalone-monitor.js"), "");
    config.libDir = root;
    const spawned: Array<{ name: string; cmd: string; args: string[]; opts?: { env?: Record<string, string> } }> = [];
    const removed: string[] = [];
    let spawnCount = 0;

    await expect(launchStandaloneAgent({ specPath, monitor: true }, {
      config,
      delay: async () => undefined,
      pty: {
        spawn: async (name, cmd = "zsh", args = [], opts) => {
          spawnCount += 1;
          spawned.push({ name, cmd, args, opts });
          if (spawnCount === 2) throw new Error("monitor daemon unavailable");
          return { name, pid: 4242 };
        },
        sendKeys: async () => undefined,
        sendRaw: async () => undefined,
        remove: async (name) => { removed.push(name); },
      },
      writeLog: () => undefined,
    })).rejects.toThrow("standalone monitor could not be started: monitor daemon unavailable");

    expect(spawned[1]).toMatchObject({
      cmd: process.execPath,
      args: expect.arrayContaining(["--session", spawned[0].name, "--spec", specPath]),
      opts: expect.objectContaining({
        env: expect.objectContaining({
          MENTIKO_GLOBAL_ROOT: config.globalRoot,
          MENTIKO_CODE_ROOT: config.codeRoot,
          RUNS_DIR: config.runsDir,
        }),
      }),
    });
    expect(removed).toEqual([spawned[0].name]);
    const [stateFile] = [join(config.stateDir, "reviewer_no_run.state")];
    expect(existsSync(stateFile)).toBe(true);
    expect(parseRunnerAgentState(readFileSync(stateFile, "utf8"))).toMatchObject({
      status: "blocked",
      blocked_reason: "monitor startup failed: monitor daemon unavailable",
    });
  });

  it("keeps session naming and the instruction body deterministic without shell interpolation", () => {
    expect(standaloneSessionName("/tmp/data", "reviewer", new Date(2026, 0, 2, 3, 4))).toBe("data-reviewer-20260102-0304");
    expect(standaloneAgentInstruction({
      agent: { name: "Reviewer", role: "review", sessionPrefix: "reviewer" },
      specPath: "/tmp/spec with spaces.yaml",
      workspacePath: "/tmp/workspace with spaces",
    })).toContain("You are working from: /tmp/workspace with spaces");
  });
});
