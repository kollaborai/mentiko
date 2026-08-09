/**
 * @jest-environment node
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureGitWorkspaceSnapshot,
  compareGitWorkspaceSnapshots,
} from "./workspace-snapshot";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function repository(): { root: string; scratch: string } {
  const root = mkdtempSync(join(tmpdir(), "mentiko-workspace-snapshot-repo-"));
  const scratch = mkdtempSync(join(tmpdir(), "mentiko-workspace-snapshot-state-"));
  git(root, "init", "-q");
  git(root, "config", "user.name", "Snapshot Test");
  git(root, "config", "user.email", "snapshot@example.com");
  writeFileSync(join(root, "component.ts"), "export const value = 'original';\n");
  writeFileSync(join(root, "delete-me.ts"), "export const remove = true;\n");
  git(root, "add", "component.ts", "delete-me.ts");
  git(root, "commit", "-qm", "initial");
  return { root, scratch };
}

describe("workspace snapshot evidence", () => {
  it("captures staged, unstaged, and untracked baseline state without mutating the user's checkout", () => {
    const { root, scratch } = repository();
    writeFileSync(join(root, "component.ts"), "export const value = 'staged';\n");
    git(root, "add", "component.ts");
    writeFileSync(join(root, "component.ts"), "export const value = 'preexisting-dirty';\n");
    writeFileSync(join(root, "preexisting-note.txt"), "keep me out of this task\n");

    const headBefore = git(root, "rev-parse", "HEAD");
    const statusBefore = git(root, "status", "--porcelain=v1", "-z");
    const stagedBefore = git(root, "diff", "--cached", "--binary");
    const unstagedBefore = git(root, "diff", "--binary");

    const baseline = captureGitWorkspaceSnapshot({
      workspacePath: root,
      scratchDir: scratch,
      label: "run-dirty-baseline",
      capturedAt: "2026-08-09T20:00:00.000Z",
    });

    expect(baseline.dirtyFromHead).toBe(true);
    expect(baseline.sourceHead).toBe(headBefore);
    expect(git(root, "show", `${baseline.snapshotCommit}:component.ts`)).toContain("preexisting-dirty");
    expect(git(root, "show", `${baseline.snapshotCommit}:preexisting-note.txt`)).toContain("keep me out");
    expect(git(root, "rev-parse", "HEAD")).toBe(headBefore);
    expect(git(root, "status", "--porcelain=v1", "-z")).toBe(statusBefore);
    expect(git(root, "diff", "--cached", "--binary")).toBe(stagedBefore);
    expect(git(root, "diff", "--binary")).toBe(unstagedBefore);
  });

  it("reports only the task delta after a dirty baseline", () => {
    const { root, scratch } = repository();
    writeFileSync(join(root, "component.ts"), "export const value = 'preexisting-fix';\n");
    writeFileSync(join(root, "preexisting-note.txt"), "already here\n");
    const baseline = captureGitWorkspaceSnapshot({
      workspacePath: root,
      scratchDir: scratch,
      label: "run-before-task",
      capturedAt: "2026-08-09T20:00:00.000Z",
    });

    writeFileSync(join(root, "component.test.ts"), "test('new coverage', () => expect(true).toBe(true));\n");
    const observed = captureGitWorkspaceSnapshot({
      workspacePath: root,
      scratchDir: scratch,
      label: "run-before-verifier",
      capturedAt: "2026-08-09T20:01:00.000Z",
    });
    const changes = compareGitWorkspaceSnapshots(baseline, observed);

    expect(changes.files).toEqual([{
      path: "component.test.ts",
      status: "added",
      additions: 1,
      deletions: 0,
    }]);
    expect(changes.summary).toEqual({
      filesChanged: 1,
      additions: 1,
      deletions: 0,
      binaryFiles: 0,
    });
    expect(changes.patchSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("tracks additions, modifications, deletions, binary files, and paths with spaces", () => {
    const { root, scratch } = repository();
    const baseline = captureGitWorkspaceSnapshot({
      workspacePath: root,
      scratchDir: scratch,
      label: "run-clean",
    });

    writeFileSync(join(root, "component.ts"), "export const value = 'changed';\nexport const next = true;\n");
    git(root, "rm", "-q", "delete-me.ts");
    writeFileSync(join(root, "new test.ts"), "test('space path', () => {});\n");
    writeFileSync(join(root, "binary.bin"), Buffer.from([0, 1, 2, 3, 0, 4]));
    const observed = captureGitWorkspaceSnapshot({
      workspacePath: root,
      scratchDir: scratch,
      label: "run-observed",
    });
    const changes = compareGitWorkspaceSnapshots(baseline, observed);

    expect(changes.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "component.ts", status: "modified" }),
      expect.objectContaining({ path: "delete-me.ts", status: "deleted" }),
      expect.objectContaining({ path: "new test.ts", status: "added" }),
      expect.objectContaining({ path: "binary.bin", status: "added", additions: null, deletions: null }),
    ]));
    expect(changes.summary.filesChanged).toBe(4);
    expect(changes.summary.binaryFiles).toBe(1);
  });

  it("limits evidence to the registered workspace subdirectory", () => {
    const { root, scratch } = repository();
    const workspace = join(root, "packages", "app");
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, "app.ts"), "export const app = 1;\n");
    writeFileSync(join(root, "sibling.ts"), "export const sibling = 1;\n");
    git(root, "add", "packages/app/app.ts", "sibling.ts");
    git(root, "commit", "-qm", "add workspaces");
    const baseline = captureGitWorkspaceSnapshot({
      workspacePath: workspace,
      scratchDir: scratch,
      label: "run-subdir",
    });

    writeFileSync(join(workspace, "app.ts"), "export const app = 2;\n");
    writeFileSync(join(root, "sibling.ts"), "export const sibling = 2;\n");
    const observed = captureGitWorkspaceSnapshot({
      workspacePath: workspace,
      scratchDir: scratch,
      label: "run-subdir-observed",
    });
    const changes = compareGitWorkspaceSnapshots(baseline, observed);

    expect(baseline.relativeWorkspacePath).toBe("packages/app");
    expect(changes.files.map((file) => file.path)).toEqual(["packages/app/app.ts"]);
    expect(git(root, "show", `${observed.snapshotCommit}:sibling.ts`)).toContain("sibling = 1");
    expect(readFileSync(join(root, "sibling.ts"), "utf8")).toContain("sibling = 2");
  });
});
