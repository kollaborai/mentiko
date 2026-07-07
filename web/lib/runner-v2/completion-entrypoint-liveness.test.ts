import { spawnSync } from "child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runRunnerV2CompletionEntrypoint } from "@/lib/runner-v2/completion-entrypoint";
import { createRunRecord, readRunJson, updateRunJson } from "@/lib/runner-v2/run-state";

jest.mock("child_process", () => ({
  ...jest.requireActual("child_process"),
  spawnSync: jest.fn(),
}));

const mockSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "runner-v2-completion-entrypoint-liveness-"));
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function seedRun(root: string) {
  const runDir = join(root, "runs", "run-123");
  const eventsDir = join(root, "events");
  const stateDir = join(root, "state");
  mkdirSync(runDir, { recursive: true });
  mkdirSync(eventsDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });

  const chainPath = join(root, "chain.json");
  writeJson(chainPath, {
    id: "chain",
    name: "Build Chain",
    config: { project_root: root },
    agents: [
      { id: "writer", name: "Writer", emits: "draft-ready", retry: { max_retries: 1 } },
      { id: "reviewer", name: "Reviewer", triggers: ["draft-ready"] },
    ],
  });

  const runJsonPath = join(runDir, "run.json");
  const run = createRunRecord({ chainName: "Build Chain", goal: "ship" });
  updateRunJson(runJsonPath, () => ({
    ...run,
    id: "run-123",
    status: "running",
    agents: [{ id: "writer", name: "Writer", session: "writer-run-123", status: "running" }],
    sessions: ["writer-run-123"],
  }));

  return { runDir, eventsDir, stateDir, chainPath, runJsonPath };
}

function mockPtySessionAliveWithChild() {
  mockSpawnSync.mockImplementation((_cmd, args) => {
    const argv = Array.isArray(args) ? args.map(String) : [];
    if (argv[0] === "alive") {
      return { status: 0, stdout: "alive\n", stderr: "" } as ReturnType<typeof spawnSync>;
    }
    if (argv[0] === "info") {
      return {
        status: 0,
        stdout: `${JSON.stringify({ alive: true, childPid: process.pid })}\n`,
        stderr: "",
      } as ReturnType<typeof spawnSync>;
    }
    if (argv[0] === "capture") {
      return { status: 0, stdout: "writer is still producing output\n", stderr: "" } as ReturnType<typeof spawnSync>;
    }
    return { status: 1, stdout: "", stderr: "unexpected command" } as ReturnType<typeof spawnSync>;
  });
}

describe("runner-v2 completion entrypoint liveness", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
  });

  it("does not exhaust a missing completion event while the original PTY session and child are alive", () => {
    const root = tempRoot();
    const { runDir, eventsDir, stateDir, chainPath, runJsonPath } = seedRun(root);
    mockPtySessionAliveWithChild();

    const result = runRunnerV2CompletionEntrypoint({
      sessionName: "writer-run-123",
      chainPath,
      env: {
        MENTIKO_RUN_ID: "run-123",
        MENTIKO_RUN_DIR: runDir,
        EVENTS_DIR: eventsDir,
        STATE_DIR: stateDir,
        MENTIKO_CODE_ROOT: root,
        MENTIKO_RETRY_ATTEMPT: "1",
        MENTIKO_RUNNER_V2: "1",
        MENTIKO_RUNNER_V2_COMPLETION: "1",
      },
      dryRun: true,
      now: new Date("2026-06-26T00:00:00.000Z"),
    });

    expect(result.decision).toBe("await-liveness");
    expect(readRunJson(runJsonPath)).toMatchObject({
      status: "running",
      agents: [{ id: "writer", status: "running" }],
    });
  });
});
