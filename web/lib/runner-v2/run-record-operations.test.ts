/** @jest-environment node */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunRecordFile, readRunRecordAt, type RunRecord } from "@/lib/runs/run-record";
import {
  completePeerRun,
  markRunAgentBlocked,
  markRunAgentFailed,
  startPeerRun,
  updateRunActivityManifest,
  writeRunSummaryArtifact,
} from "@/lib/runner-v2/run-record-operations";

function fixture(patch: Partial<RunRecord> = {}): { runsDir: string; runJsonPath: string } {
  const runsDir = mkdtempSync(join(tmpdir(), "mentiko-run-record-operations-"));
  const run: RunRecord = {
    id: "run-1",
    chain: "typed-chain",
    goal: "prove typed ownership",
    started: "2026-07-15T00:00:00.000Z",
    status: "running",
    sessions: [],
    agents: [],
    ...patch,
  };
  return { runsDir, runJsonPath: createRunRecordFile(runsDir, run).runJsonPath };
}

describe("typed Run Record operations", () => {
  it("atomically owns blocked and failed metadata while preserving extensions", () => {
    const { runsDir, runJsonPath } = fixture({ artifacts: ["opaque-extension"] });
    markRunAgentBlocked(runJsonPath, "writer", "authentication required", new Date("2026-07-15T00:01:00Z"));
    markRunAgentFailed(runJsonPath, "reviewer", "startup exited", new Date("2026-07-15T00:02:00Z"));

    const run = readRunRecordAt(runsDir, "run-1");
    expect(run).toMatchObject({
      status: "failed",
      status_message: "startup exited",
      blockedReason: "authentication required",
      artifacts: ["opaque-extension"],
      agents: [
        { id: "writer", status: "blocked", lastMessage: "authentication required" },
        { id: "reviewer", status: "failed", lastMessage: "startup exited" },
      ],
    });
  });

  it("records a terminal timestamp for a blocked run without completing the blocked agent", () => {
    const { runsDir, runJsonPath } = fixture({
      agents: [{ id: "verifier", name: "Verifier", session: "verifier-1", status: "running" }],
    });

    markRunAgentBlocked(
      runJsonPath,
      "verifier",
      "startup_recovery:unknown: CLI readiness unresolved after 90s",
      new Date("2026-07-15T00:01:00Z"),
    );

    const run = readRunRecordAt(runsDir, "run-1");
    expect(run).toMatchObject({
      status: "blocked",
      completed: "2026-07-15T00:01:00.000Z",
      blockedReason: "startup_recovery:unknown: CLI readiness unresolved after 90s",
      agents: [{
        id: "verifier",
        status: "blocked",
        lastMessage: "startup_recovery:unknown: CLI readiness unresolved after 90s",
      }],
    });
    expect(run.agents[0].completed).toBeUndefined();
  });

  it("owns peer lifecycle updates as named operations", () => {
    const { runsDir, runJsonPath } = fixture({
      status: "pending",
      agents: [
        { id: "agent1", name: "Peer one", session: "", status: "pending" },
        { id: "agent2", name: "Peer two", session: "", status: "pending" },
      ],
    });
    startPeerRun(runJsonPath, "peer-one", "peer-two");
    completePeerRun(runJsonPath, 4, new Date("2026-07-15T00:04:00Z"));
    expect(readRunRecordAt(runsDir, "run-1")).toMatchObject({
      status: "completed",
      sessions: ["peer-one", "peer-two"],
      rounds: 4,
      agents: [
        { id: "agent1", session: "peer-one", status: "complete" },
        { id: "agent2", session: "peer-two", status: "complete" },
      ],
    });
  });

  it("preserves unrelated legacy artifacts and replaces only owned activity entries", () => {
    const legacy = { type: "legacy", path: "/tmp/legacy-without-timestamp" };
    const { runsDir, runJsonPath } = fixture({ artifacts: [legacy, "opaque-extension"] });
    updateRunActivityManifest(runJsonPath, "writer", 12, 2, new Date("2026-07-15T00:05:00Z"));
    updateRunActivityManifest(runJsonPath, "writer", 14, 0, new Date("2026-07-15T00:06:00Z"));
    const artifacts = readRunRecordAt(runsDir, "run-1").artifacts as unknown[];
    expect(artifacts).toContainEqual(legacy);
    expect(artifacts).toContain("opaque-extension");
    expect(artifacts).toContainEqual(expect.objectContaining({ agentId: "writer", type: "diff", diffLines: 14 }));
    expect(artifacts.filter((item) => typeof item === "object" && item !== null
      && (item as { agentId?: string; type?: string }).agentId === "writer"
      && (item as { type?: string }).type === "diff")).toHaveLength(1);
  });

  it("creates a missing artifacts directory and adopts a typed run summary without dropping extensions", () => {
    const legacy = { type: "legacy", path: "/tmp/legacy-without-timestamp" };
    const { runsDir, runJsonPath } = fixture({
      status: "completed",
      completed: "2026-07-15T00:10:00Z",
      artifacts: [legacy, "opaque-extension"],
      agents: [{ id: "writer", name: "Writer", session: "writer-1", status: "complete" }],
    });
    const artifactsDir = join(runsDir, "run-1", "artifacts");
    expect(existsSync(artifactsDir)).toBe(false);
    mkdirSync(artifactsDir);
    writeFileSync(join(artifactsDir, "writer-summary.json"), JSON.stringify({
      status: "pass",
      executiveSummary: "Typed migration passed.",
      findings: ["one"],
    }));
    // Prove the operation itself recreates a missing directory rather than
    // relying on the test fixture or shell launcher to have made it.
    const summaryFile = join(artifactsDir, "writer-summary.json");
    const summaryContents = readFileSync(summaryFile);
    rmSync(artifactsDir, { recursive: true });
    writeRunSummaryArtifact(runJsonPath, new Date("2026-07-15T00:11:00Z"));
    expect(existsSync(join(artifactsDir, "run-summary.json"))).toBe(true);

    // Add a real summary and adopt again to cover verdict aggregation.
    writeFileSync(summaryFile, summaryContents);
    const adopted = writeRunSummaryArtifact(runJsonPath, new Date("2026-07-15T00:12:00Z"));
    expect(adopted.summary).toMatchObject({ outcome: "complete", summary: "Typed migration passed." });
    const artifacts = readRunRecordAt(runsDir, "run-1").artifacts as unknown[];
    expect(artifacts).toContainEqual(legacy);
    expect(artifacts).toContain("opaque-extension");
    expect(artifacts.filter((item) => typeof item === "object" && item !== null
      && (item as { type?: string }).type === "run-summary")).toHaveLength(1);
  });
});
