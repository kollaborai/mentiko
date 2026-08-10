/** @jest-environment node */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunRecord, updateRunJson } from "@/lib/runner-v2/run-state";
import {
  cleanupGitNodeWorkspaceDurably,
  reconcileGitNodeWorkspaceCleanups,
  type GitNodeWorkspaceCleanupReceipt,
} from "@/lib/runner-v2/workspace-cleanup";
import {
  allocateGitNodeWorkspace,
  finalizeGitNodeWorkspace,
  initializeGitRunWorkspaceIsolation,
  integrateGitNodeWorkspaceResult,
} from "@/lib/runner-v2/workspace-isolation";
import { captureGitWorkspaceSnapshot } from "@/lib/runner-v2/workspace-snapshot";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function fixture(runId: string) {
  const root = mkdtempSync(join(tmpdir(), "mentiko-cleanup-repo-"));
  const runDir = mkdtempSync(join(tmpdir(), "mentiko-cleanup-run-"));
  const scratch = mkdtempSync(join(tmpdir(), "mentiko-cleanup-snapshot-"));
  const runJsonPath = join(runDir, "run.json");
  git(root, "init", "-q");
  git(root, "config", "user.name", "Cleanup Test");
  git(root, "config", "user.email", "cleanup@example.com");
  writeFileSync(join(root, "source.ts"), "export const source = 'base';\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "initial");
  updateRunJson(runJsonPath, () => createRunRecord({
    runId,
    chainName: "cleanup-chain",
    goal: "reclaim worktree",
  }));
  const baseline = captureGitWorkspaceSnapshot({
    workspacePath: root,
    scratchDir: scratch,
    label: `${runId}-baseline`,
    capturedAt: "2026-08-09T20:00:00.000Z",
  });
  const runWorkspace = initializeGitRunWorkspaceIsolation({
    runId,
    runDir,
    baseline,
    now: new Date("2026-08-09T20:00:01.000Z"),
  });
  return { root, runDir, runJsonPath, runWorkspace };
}

function cleanupRecords(isolationRoot: string) {
  const pendingDir = join(isolationRoot, "cleanup", "pending");
  const completedDir = join(isolationRoot, "cleanup", "completed");
  return {
    pendingDir,
    completedDir,
    pending: existsSync(pendingDir) ? readdirSync(pendingDir).sort() : [],
    completed: existsSync(completedDir) ? readdirSync(completedDir).sort() : [],
  };
}

describe("durable Git node worktree cleanup", () => {
  it("recovers a crash after integrated worktree removal and replays idempotently", () => {
    const paths = fixture("run-integrated-cleanup");
    const node = allocateGitNodeWorkspace({
      runWorkspace: paths.runWorkspace,
      agentId: "writer",
      attemptId: "attempt-integrated-cleanup",
    });
    writeFileSync(join(node.workspacePath, "source.ts"), "export const source = 'changed';\n");
    const result = finalizeGitNodeWorkspace({ runWorkspace: paths.runWorkspace, node });
    integrateGitNodeWorkspaceResult({ runWorkspace: paths.runWorkspace, result });

    expect(() => cleanupGitNodeWorkspaceDurably({
      runWorkspace: paths.runWorkspace,
      agentId: node.agentId,
      attemptId: node.attemptId,
      mode: "integrated",
      now: new Date("2026-08-09T20:00:02.000Z"),
      afterCleanup: () => {
        throw new Error("crash-after-worktree-removal");
      },
    })).toThrow("crash-after-worktree-removal");
    expect(existsSync(node.worktreeRoot)).toBe(false);
    expect(cleanupRecords(paths.runWorkspace.isolationRoot)).toMatchObject({
      pending: [expect.stringMatching(/\.json$/)],
      completed: [],
    });

    expect(reconcileGitNodeWorkspaceCleanups({
      scopeRoot: paths.runDir,
      explicitRunJsonPath: paths.runJsonPath,
    })).toEqual({ examined: 1, completed: 1, preserved: 0, errors: [] });
    const records = cleanupRecords(paths.runWorkspace.isolationRoot);
    expect(records.pending).toEqual([]);
    expect(records.completed).toHaveLength(1);
    const receipt = JSON.parse(
      readFileSync(join(records.completedDir, records.completed[0]), "utf8"),
    ) as GitNodeWorkspaceCleanupReceipt;
    expect(receipt).toMatchObject({
      kind: "git-node-workspace-cleanup-receipt",
      mode: "integrated",
      outcome: "already-removed",
      attemptId: node.attemptId,
    });

    expect(cleanupGitNodeWorkspaceDurably({
      runWorkspace: paths.runWorkspace,
      agentId: node.agentId,
      attemptId: node.attemptId,
      mode: "integrated",
      now: new Date("2026-08-09T20:00:03.000Z"),
    })).toEqual(receipt);
    expect(cleanupRecords(paths.runWorkspace.isolationRoot).pending).toEqual([]);
  });

  it("recovers pristine startup cleanup and does not let a corrupt sibling job block it", () => {
    const paths = fixture("run-pristine-cleanup");
    const node = allocateGitNodeWorkspace({
      runWorkspace: paths.runWorkspace,
      agentId: "starter",
      attemptId: "attempt-pristine-cleanup",
    });
    expect(() => cleanupGitNodeWorkspaceDurably({
      runWorkspace: paths.runWorkspace,
      agentId: node.agentId,
      attemptId: node.attemptId,
      mode: "pristine-startup",
      afterCleanup: () => {
        throw new Error("crash-after-pristine-removal");
      },
    })).toThrow("crash-after-pristine-removal");
    const records = cleanupRecords(paths.runWorkspace.isolationRoot);
    mkdirSync(records.pendingDir, { recursive: true });
    const corruptPath = join(records.pendingDir, "000-corrupt.json");
    writeFileSync(corruptPath, "{not-json\n");

    const recovery = reconcileGitNodeWorkspaceCleanups({
      scopeRoot: paths.runDir,
      explicitRunJsonPath: paths.runJsonPath,
    });
    expect(recovery).toMatchObject({ examined: 2, completed: 1, preserved: 0 });
    expect(recovery.errors).toHaveLength(1);
    expect(recovery.errors[0]).toContain(corruptPath);
    expect(existsSync(node.worktreeRoot)).toBe(false);
    expect(cleanupRecords(paths.runWorkspace.isolationRoot).pending).toEqual(["000-corrupt.json"]);
  });
});
