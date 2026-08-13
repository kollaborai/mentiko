/**
 * @jest-environment node
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentAttempt } from "@/lib/runner-v2/agent-attempt";
import { createRunRecord, readRunJson, updateRunJson } from "@/lib/runner-v2/run-state";
import {
  captureAgentWorkspaceHandoff,
  ensureRunWorkspaceBaseline,
} from "@/lib/runner-v2/workspace-evidence";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), "mentiko-workspace-evidence-repo-"));
  git(root, "init", "-q");
  git(root, "config", "user.name", "Evidence Test");
  git(root, "config", "user.email", "evidence@example.com");
  writeFileSync(join(root, "component.ts"), "export const value = 'original';\n");
  git(root, "add", "component.ts");
  git(root, "commit", "-qm", "initial");
  return root;
}

function runFixture(workspacePath?: string): { runDir: string; runJsonPath: string } {
  const runDir = mkdtempSync(join(tmpdir(), "mentiko-workspace-evidence-run-"));
  const runJsonPath = join(runDir, "run.json");
  updateRunJson(runJsonPath, () => ({
    ...createRunRecord({
      runId: "run-evidence",
      chainName: "Evidence Chain",
      goal: "attribute changes",
      workspacePath,
    }),
    agents: [{ id: "verifier", name: "Verifier", session: "", status: "pending" }],
  }));
  return { runDir, runJsonPath };
}

describe("run workspace evidence", () => {
  it("persists one dirty baseline and attributes only changes made after it", () => {
    const workspace = repository();
    writeFileSync(join(workspace, "component.ts"), "export const value = 'preexisting';\n");
    writeFileSync(join(workspace, "preexisting-note.txt"), "already dirty\n");
    const { runDir, runJsonPath } = runFixture(workspace);

    const baseline = ensureRunWorkspaceBaseline({
      runJsonPath,
      runDir,
      runId: "run-evidence",
      workspacePath: workspace,
      now: new Date("2026-08-09T20:00:00.000Z"),
    });
    expect(baseline.tracking).toBe("git");
    if (baseline.tracking !== "git") throw new Error(baseline.reason);

    writeFileSync(join(workspace, "component.test.ts"), "test('new coverage', () => expect(true).toBe(true));\n");
    const attempt = createAgentAttempt({
      runJsonPath,
      runId: "run-evidence",
      agentId: "verifier",
      leaseId: "verifier-run-evidence",
      now: new Date("2026-08-09T20:01:00.000Z"),
    });
    const handoff = captureAgentWorkspaceHandoff({
      runJsonPath,
      runDir,
      runId: "run-evidence",
      agentId: "verifier",
      attemptId: attempt.id,
      workspaceExecution: baseline,
      now: new Date("2026-08-09T20:02:00.000Z"),
    });

    expect(handoff.tracking).toBe("git");
    if (handoff.tracking !== "git") throw new Error(handoff.reason);
    expect(handoff.changeSet.files).toEqual([{
      path: "component.test.ts",
      status: "added",
      additions: 1,
      deletions: 0,
    }]);
    expect(git(workspace, "show", `${baseline.baseline.snapshotCommit}:component.ts`)).toContain("preexisting");
    expect(git(workspace, "show", `${baseline.baseline.snapshotCommit}:preexisting-note.txt`)).toContain("already dirty");

    const persisted = readRunJson(runJsonPath).workspaceExecution;
    expect(persisted).toMatchObject({
      tracking: "git",
      baseline: { snapshotCommit: baseline.baseline.snapshotCommit, dirtyFromHead: true },
      handoffs: [{
        attemptId: attempt.id,
        agentId: "verifier",
        tracking: "git",
        artifactPath: handoff.artifactPath,
      }],
    });
    expect(JSON.parse(readFileSync(baseline.baselineArtifactPath, "utf8"))).toMatchObject({
      kind: "workspace-baseline",
      tracking: "git",
      baseline: { snapshotCommit: baseline.baseline.snapshotCommit },
    });
    expect(JSON.parse(readFileSync(handoff.artifactPath, "utf8"))).toMatchObject({
      kind: "workspace-handoff",
      attemptId: attempt.id,
      changeSet: { summary: { filesChanged: 1 } },
    });

    const repeatedBaseline = ensureRunWorkspaceBaseline({
      runJsonPath,
      runDir,
      runId: "run-evidence",
      workspacePath: workspace,
      now: new Date("2026-08-09T20:03:00.000Z"),
    });
    expect(repeatedBaseline.tracking).toBe("git");
    if (repeatedBaseline.tracking === "git") {
      expect(repeatedBaseline.baseline.snapshotCommit).toBe(baseline.baseline.snapshotCommit);
    }
  });

  it("keeps an attempt handoff immutable when capture is retried", () => {
    const workspace = repository();
    const { runDir, runJsonPath } = runFixture(workspace);
    const baseline = ensureRunWorkspaceBaseline({
      runJsonPath,
      runDir,
      runId: "run-evidence",
      workspacePath: workspace,
    });
    const attempt = createAgentAttempt({
      runJsonPath,
      runId: "run-evidence",
      agentId: "verifier",
      leaseId: "verifier-run-evidence",
    });
    writeFileSync(join(workspace, "first.ts"), "export const first = true;\n");
    const first = captureAgentWorkspaceHandoff({
      runJsonPath,
      runDir,
      runId: "run-evidence",
      agentId: "verifier",
      attemptId: attempt.id,
      workspaceExecution: baseline,
    });
    writeFileSync(join(workspace, "later.ts"), "export const later = true;\n");

    const repeated = captureAgentWorkspaceHandoff({
      runJsonPath,
      runDir,
      runId: "run-evidence",
      agentId: "verifier",
      attemptId: attempt.id,
      workspaceExecution: baseline,
    });

    expect(repeated).toEqual(first);
    if (repeated.tracking === "git") {
      expect(repeated.changeSet.files.map((file) => file.path)).toEqual(["first.ts"]);
    }
  });

  it("refuses to manufacture a baseline after durable execution evidence exists", () => {
    const workspace = repository();
    const { runDir, runJsonPath } = runFixture(workspace);
    updateRunJson(runJsonPath, (run) => ({
      ...run!,
      status: "running",
      sessions: ["writer-run-evidence"],
      agents: [{
        id: "writer",
        name: "Writer",
        session: "writer-run-evidence",
        status: "complete",
      }],
    }));

    const baseline = ensureRunWorkspaceBaseline({
      runJsonPath,
      runDir,
      runId: "run-evidence",
      workspacePath: workspace,
    });

    expect(baseline).toMatchObject({
      tracking: "unavailable",
      reason: expect.stringContaining("refusing a late workspace baseline"),
      concurrentWritesIsolated: false,
    });
  });

  it("records unavailable evidence for a non-Git workspace without blocking launch", () => {
    const workspace = mkdtempSync(join(tmpdir(), "mentiko-non-git-workspace-"));
    mkdirSync(join(workspace, "src"));
    const { runDir, runJsonPath } = runFixture(workspace);

    const baseline = ensureRunWorkspaceBaseline({
      runJsonPath,
      runDir,
      runId: "run-evidence",
      workspacePath: workspace,
    });

    expect(baseline).toMatchObject({
      tracking: "unavailable",
      sourceWorkspacePath: workspace,
      reason: expect.stringContaining("git rev-parse failed"),
    });
    expect(JSON.parse(readFileSync(baseline.baselineArtifactPath, "utf8"))).toMatchObject({
      kind: "workspace-baseline",
      tracking: "unavailable",
    });
  });
});
