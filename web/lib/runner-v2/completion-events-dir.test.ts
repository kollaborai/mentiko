import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runRunnerV2CompletionEntrypoint } from "@/lib/runner-v2/completion-entrypoint";
import { createRunRecord, updateRunJson } from "@/lib/runner-v2/run-state";
import { runnerEventFixture } from "@/lib/runner-v2/test-support/runner-event-fixture";

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "runner-v2-completion-events-dir-"));
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

describe("runner-v2 completion entrypoint: configured event root", () => {
  it("fails closed when an event exists only outside EVENTS_DIR", () => {
    const root = tempRoot();
    const runDir = join(root, "runs", "run-123");
    const projectEventsDir = join(root, "events");
    const configuredEventsDir = join(root, "configured-events");
    const stateDir = join(root, "state");
    mkdirSync(runDir, { recursive: true });
    mkdirSync(projectEventsDir, { recursive: true });
    mkdirSync(configuredEventsDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });

    const chainPath = join(root, "chain.json");
    writeJson(chainPath, {
      id: "chain",
      name: "Build Chain",
      config: { project_root: root },
      agents: [
        { id: "writer", name: "Writer", emits: "draft-ready" },
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

    // This artifact is deliberately outside the configured root and must not
    // influence completion.
    writeFileSync(join(projectEventsDir, "run-123-writer-draft-ready.event"), runnerEventFixture({
      event: "draft-ready",
      source: "writer-run-123",
      runId: "run-123",
      data: "ready",
    }));

    const result = runRunnerV2CompletionEntrypoint({
      sessionName: "writer-run-123",
      chainPath,
      env: {
        MENTIKO_RUN_ID: "run-123",
        MENTIKO_RUN_DIR: runDir,
        EVENTS_DIR: configuredEventsDir,
        STATE_DIR: stateDir,
        MENTIKO_RUNNER_V2: "1",
        MENTIKO_RUNNER_V2_COMPLETION: "1",
      },
      dryRun: true,
      now: new Date("2026-06-26T00:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "handled",
      agentId: "writer",
      decision: "exhausted",
      eventsDir: configuredEventsDir,
    });
  });
});
