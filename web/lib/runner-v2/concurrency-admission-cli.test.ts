import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createRunRecordFile } from "@/lib/runs/run-record";
import { runConcurrencyAdmissionCli } from "@/lib/runner-v2/concurrency-admission-cli";
import { INVALID_AGENT_ADMISSION_REASON } from "@/lib/runner-v2/concurrency-admission";
import { createRunRecord, readRunJson } from "@/lib/runner-v2/run-state";

const root = join("/tmp", `mentiko-concurrency-admission-cli-${process.pid}`);
const runs = join(root, "runs");

beforeEach(() => {
  mkdirSync(runs, { recursive: true });
  const run = createRunRecord({ runId: "run-candidate", chainName: "chain", goal: "goal" });
  run.status = "running";
  run.agents = [{ id: "writer", name: "Writer", session: "writer-session", status: "running" }];
  createRunRecordFile(runs, run);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("runner concurrency admission CLI", () => {
  it("owns the invalid-admission reason instead of accepting it from the shell", () => {
    const output: string[] = [];
    runConcurrencyAdmissionCli([
      "block-agent",
      "--runs-dir", runs,
      "--run-id", "run-candidate",
      "--agent-id", "writer",
    ], (line) => output.push(line));

    expect(output).toEqual(["blocked"]);
    expect(readRunJson(join(runs, "run-candidate", "run.json"))).toMatchObject({
      status: "blocked",
      status_message: INVALID_AGENT_ADMISSION_REASON,
      blockedReason: INVALID_AGENT_ADMISSION_REASON,
      agents: [{ id: "writer", status: "blocked", lastMessage: INVALID_AGENT_ADMISSION_REASON }],
    });
  });

  it("rejects a caller-supplied admission reason", () => {
    expect(() => runConcurrencyAdmissionCli([
      "block-agent",
      "--runs-dir", runs,
      "--run-id", "run-candidate",
      "--agent-id", "writer",
      "--reason", "shell supplied",
    ])).toThrow("--reason is not valid for concurrency command.");
  });
});
