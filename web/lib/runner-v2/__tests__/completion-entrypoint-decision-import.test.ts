import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";
import { runRunnerV2CompletionEntrypoint } from "@/lib/runner-v2/completion-entrypoint";
import { createRunRecord, readRunJson, updateRunJson } from "@/lib/runner-v2/run-state";

jest.mock("child_process", () => ({
  ...jest.requireActual("child_process"),
  spawnSync: jest.fn(),
}));

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

// Regression for the devv decision jam: a decision "guided options" run generated
// valid options, but the agent's in-PTY `mentiko decision import` 401'd (the PTY env
// excludes the derived token by design), so it self-reported summary status "blocked".
// The quality gate terminalized the run "blocked" before the server-side import could
// run, discarding a valid decision-result.json — and the run's metadata was empty, so
// the identity-gated import path also early-returned. Completion must own delivery: the
// decision-terminal path completes the run from the artifact and fires the server-side
// import (identity recovered from run.goal), regardless of the agent's CLI import.
describe("runner-v2 decision import: server owns delivery when the agent CLI import fails", () => {
  const prevSecret = process.env.BETTER_AUTH_SECRET;
  const prevFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = "test-decision-secret";
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}), text: async () => "" });
    global.fetch = fetchMock as unknown as typeof fetch;
    (spawnSync as jest.Mock).mockReset().mockReturnValue({ status: 1, stdout: "", stderr: "" });
  });

  afterEach(() => {
    global.fetch = prevFetch;
    if (prevSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = prevSecret;
  });

  it("completes from decision-result.json despite a blocked summary and empty run metadata (identity from goal)", async () => {
    const root = mkdtempSync(join(tmpdir(), "runner-v2-decision-import-"));
    const runDir = join(root, "runs", "run-dec-1");
    const artifactsDir = join(runDir, "artifacts");
    const eventsDir = join(root, "events");
    const stateDir = join(root, "state");
    mkdirSync(artifactsDir, { recursive: true });
    mkdirSync(eventsDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });

    const chainPath = join(root, "chain.json");
    writeJson(chainPath, {
      id: "decision-guided-options",
      name: "Decision Guided Options",
      metadata: { coreDecisionChain: true, decisionPhase: "options" },
      config: { max_rounds: 1, on_complete: "stop" },
      agents: [{
        id: "decision-option-strategist",
        name: "Decision Option Strategist",
        emits: "decision-guided-options-complete",
      }],
    });

    const runJsonPath = join(runDir, "run.json");
    const run = createRunRecord({ chainName: "Decision Guided Options", goal: "" });
    updateRunJson(runJsonPath, () => ({
      ...run,
      id: "run-dec-1",
      status: "running",
      // RC2: run metadata is EMPTY -- a lost-metadata relaunch. Identity must be
      // recovered from run.goal (DECISION_ID/DECISION_PHASE lines).
      metadata: {},
      goal: [
        "DECISION_ID: 11111111-1111-1111-1111-111111111111",
        "DECISION_PHASE: options",
        "WORKSPACE_PATH: /tmp/ws",
        "",
        "Generate options.",
      ].join("\n"),
      agents: [{
        id: "decision-option-strategist",
        name: "Decision Option Strategist",
        session: "decision-option-strategist-run-dec-1",
        status: "running",
      }],
      sessions: ["decision-option-strategist-run-dec-1"],
    }));

    // The real deliverable the agent produced before its CLI import 401'd.
    writeJson(join(artifactsDir, "decision-result.json"), {
      options: [{ id: "a", title: "Option A" }, { id: "b", title: "Option B" }],
      recommendation: { optionId: "b" },
    });
    // RC1: the agent self-reports "blocked" because `mentiko decision import` failed.
    writeJson(join(artifactsDir, "decision-option-strategist-summary.json"), {
      status: "blocked",
      executiveSummary: "options generated; import returned 401",
    });

    runRunnerV2CompletionEntrypoint({
      sessionName: "decision-option-strategist-run-dec-1",
      chainPath,
      env: {
        MENTIKO_RUN_ID: "run-dec-1",
        MENTIKO_RUN_DIR: runDir,
        EVENTS_DIR: eventsDir,
        STATE_DIR: stateDir,
        NAMESPACE_ID: "default",
        ORG_ID: "default",
      },
      now: new Date("2026-08-18T00:00:00.000Z"),
    });

    // RC1: the blocked agent summary does NOT terminalize the run. Without the
    // decisionCompletionPlan quality-gate bypass, maybeHandleQualityGateFailure
    // would fire on the "blocked" summary and write terminal status "blocked"
    // before the completion pipeline ever runs. Reaching "completed" proves the
    // gate was skipped and the run completed from its real deliverable on disk.
    expect(readRunJson(runJsonPath)).toMatchObject({
      status: "completed",
      agents: [{ id: "decision-option-strategist", status: "complete" }],
    });
    // RC2 + the whole point: server-side import fired against the decision id
    // recovered from run.goal (metadata was empty) -- delivery does not depend on
    // the agent's in-PTY `mentiko decision import`, which 401'd.
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/decisions/11111111-1111-1111-1111-111111111111/import"),
      expect.objectContaining({ method: "POST" }),
    );

    // Flush the fire-and-forget import nudge so it does not resolve after teardown.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
