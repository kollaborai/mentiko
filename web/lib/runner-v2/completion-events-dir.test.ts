import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runRunnerV2CompletionEntrypoint } from "@/lib/runner-v2/completion-entrypoint";
import { createRunRecord, updateRunJson } from "@/lib/runner-v2/run-state";

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "runner-v2-completion-events-dir-"));
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

describe("runner-v2 completion entrypoint: events-dir hardening", () => {
  // TASK-093 root cause: the valid completion event landed only in the
  // project/namespace events dir (dirname(chainPath)/events), while env
  // EVENTS_DIR pointed at a dir that did not contain it and runDir/events did
  // not exist. The matcher must always read the project events dir, not depend
  // solely on EVENTS_DIR being correct.
  it("matches an event present only in the project events dir when env EVENTS_DIR points elsewhere", () => {
    const root = tempRoot();
    const runDir = join(root, "runs", "run-123");
    const projectEventsDir = join(root, "events"); // dirname(chainPath)/events
    const orgEventsDir = join(root, "org-events"); // env EVENTS_DIR — empty
    const stateDir = join(root, "state");
    mkdirSync(runDir, { recursive: true });
    mkdirSync(projectEventsDir, { recursive: true });
    mkdirSync(orgEventsDir, { recursive: true });
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

    // event only in the project events dir
    writeFileSync(join(projectEventsDir, "run-123-writer-draft-ready.event"), [
      "event: draft-ready",
      "source: writer-run-123",
      "run_id: run-123",
      "processed: false",
      "data: ready",
      "",
    ].join("\n"));

    const result = runRunnerV2CompletionEntrypoint({
      sessionName: "writer-run-123",
      chainPath,
      env: {
        MENTIKO_RUN_ID: "run-123",
        MENTIKO_RUN_DIR: runDir,
        EVENTS_DIR: orgEventsDir, // points at the empty org dir, NOT the project dir
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
      decision: "route",
    });
  });
});
