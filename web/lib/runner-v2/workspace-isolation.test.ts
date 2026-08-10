/**
 * @jest-environment node
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  allocateGitNodeWorkspace,
  currentGitRunIntegrationCommit,
  finalizeGitNodeWorkspace,
  initializeGitRunWorkspaceIsolation,
  integrateGitNodeWorkspaceResult,
  publishGitRunWorkspaceResult,
} from "./workspace-isolation";
import { captureGitWorkspaceSnapshot } from "./workspace-snapshot";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function repository(): { root: string; runDir: string; scratch: string } {
  const root = mkdtempSync(join(tmpdir(), "mentiko-worktree-repo-"));
  const runDir = mkdtempSync(join(tmpdir(), "mentiko-worktree-run-"));
  const scratch = mkdtempSync(join(tmpdir(), "mentiko-worktree-snapshot-"));
  git(root, "init", "-q");
  git(root, "config", "user.name", "Worktree Test");
  git(root, "config", "user.email", "worktree@example.com");
  writeFileSync(join(root, "shared.ts"), "export const shared = 'base';\n");
  writeFileSync(join(root, "left.ts"), "export const left = 'base';\n");
  writeFileSync(join(root, "right.ts"), "export const right = 'base';\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "initial");
  return { root, runDir, scratch };
}

function initialize(input: {
  root: string;
  runDir: string;
  scratch: string;
  workspacePath?: string;
  runId?: string;
}) {
  const baseline = captureGitWorkspaceSnapshot({
    workspacePath: input.workspacePath || input.root,
    scratchDir: input.scratch,
    label: `${input.runId || "run-worktrees"}-baseline`,
    capturedAt: "2026-08-09T20:00:00.000Z",
  });
  const runWorkspace = initializeGitRunWorkspaceIsolation({
    runId: input.runId || "run-worktrees",
    runDir: input.runDir,
    baseline,
    now: new Date("2026-08-09T20:00:01.000Z"),
  });
  return { baseline, runWorkspace };
}

describe("Git node worktree isolation", () => {
  it("gives parallel nodes distinct worktrees from the exact dirty run baseline", () => {
    const fixture = repository();
    writeFileSync(join(fixture.root, "shared.ts"), "export const shared = 'preexisting';\n");
    writeFileSync(join(fixture.root, "preexisting.txt"), "keep this baseline\n");
    const headBefore = git(fixture.root, "rev-parse", "HEAD");
    const statusBefore = git(fixture.root, "status", "--porcelain=v1", "-z");
    const { baseline, runWorkspace } = initialize(fixture);

    const first = allocateGitNodeWorkspace({
      runWorkspace,
      agentId: "first",
      attemptId: "attempt-first",
    });
    const second = allocateGitNodeWorkspace({
      runWorkspace,
      agentId: "second",
      attemptId: "attempt-second",
    });

    expect(first.worktreeRoot).not.toBe(second.worktreeRoot);
    expect(first.baseCommit).toBe(baseline.snapshotCommit);
    expect(second.baseCommit).toBe(baseline.snapshotCommit);
    expect(readFileSync(join(first.workspacePath, "shared.ts"), "utf8")).toContain("preexisting");
    expect(readFileSync(join(second.workspacePath, "preexisting.txt"), "utf8")).toContain("baseline");
    writeFileSync(join(first.workspacePath, "first-only.ts"), "export const first = true;\n");
    expect(existsSync(join(second.workspacePath, "first-only.ts"))).toBe(false);
    expect(existsSync(join(fixture.root, "first-only.ts"))).toBe(false);
    expect(git(fixture.root, "rev-parse", "HEAD")).toBe(headBefore);
    expect(git(fixture.root, "status", "--porcelain=v1", "-z")).toBe(statusBefore);

    expect(initializeGitRunWorkspaceIsolation({
      runId: "run-worktrees",
      runDir: fixture.runDir,
      baseline,
    })).toEqual(runWorkspace);
    expect(allocateGitNodeWorkspace({
      runWorkspace,
      agentId: "first",
      attemptId: "attempt-first",
    })).toEqual(first);
  });

  it("merges non-overlapping parallel node results and starts downstream from both", () => {
    const fixture = repository();
    const { runWorkspace } = initialize(fixture);
    const left = allocateGitNodeWorkspace({
      runWorkspace,
      agentId: "left",
      attemptId: "attempt-left",
    });
    const right = allocateGitNodeWorkspace({
      runWorkspace,
      agentId: "right",
      attemptId: "attempt-right",
    });
    expect(left.baseCommit).toBe(right.baseCommit);

    writeFileSync(join(left.workspacePath, "left.ts"), "export const left = 'accepted';\n");
    writeFileSync(join(right.workspacePath, "right.ts"), "export const right = 'accepted';\n");
    const leftResult = finalizeGitNodeWorkspace({ runWorkspace, node: left });
    const rightResult = finalizeGitNodeWorkspace({ runWorkspace, node: right });
    const leftIntegration = integrateGitNodeWorkspaceResult({ runWorkspace, result: leftResult });
    const rightIntegration = integrateGitNodeWorkspaceResult({ runWorkspace, result: rightResult });

    expect(leftIntegration.status).toBe("integrated");
    expect(rightIntegration.status).toBe("integrated");
    expect(rightIntegration.mergeCommit).toBeDefined();
    expect(currentGitRunIntegrationCommit(runWorkspace)).toBe(rightIntegration.integrationCommit);
    expect(git(fixture.root, "show", `${rightIntegration.integrationCommit}:left.ts`)).toContain("accepted");
    expect(git(fixture.root, "show", `${rightIntegration.integrationCommit}:right.ts`)).toContain("accepted");

    const downstream = allocateGitNodeWorkspace({
      runWorkspace,
      agentId: "downstream",
      attemptId: "attempt-downstream",
    });
    expect(downstream.baseCommit).toBe(rightIntegration.integrationCommit);
    expect(readFileSync(join(downstream.workspacePath, "left.ts"), "utf8")).toContain("accepted");
    expect(readFileSync(join(downstream.workspacePath, "right.ts"), "utf8")).toContain("accepted");
    expect(integrateGitNodeWorkspaceResult({ runWorkspace, result: rightResult })).toEqual(rightIntegration);
  });

  it("stops on overlapping edits and leaves the run integration ref unchanged", () => {
    const fixture = repository();
    const { runWorkspace } = initialize(fixture);
    const first = allocateGitNodeWorkspace({
      runWorkspace,
      agentId: "first",
      attemptId: "attempt-conflict-first",
    });
    const second = allocateGitNodeWorkspace({
      runWorkspace,
      agentId: "second",
      attemptId: "attempt-conflict-second",
    });
    writeFileSync(join(first.workspacePath, "shared.ts"), "export const shared = 'first';\n");
    writeFileSync(join(second.workspacePath, "shared.ts"), "export const shared = 'second';\n");
    const firstResult = finalizeGitNodeWorkspace({ runWorkspace, node: first });
    const secondResult = finalizeGitNodeWorkspace({ runWorkspace, node: second });
    integrateGitNodeWorkspaceResult({ runWorkspace, result: firstResult });
    const beforeConflict = currentGitRunIntegrationCommit(runWorkspace);

    const conflict = integrateGitNodeWorkspaceResult({ runWorkspace, result: secondResult });

    expect(conflict.status).toBe("conflict");
    expect(conflict.conflictPaths).toEqual(["shared.ts"]);
    expect(conflict.integrationCommit).toBe(beforeConflict);
    expect(currentGitRunIntegrationCommit(runWorkspace)).toBe(beforeConflict);
    expect(JSON.parse(readFileSync(conflict.artifactPath, "utf8"))).toMatchObject({
      status: "conflict",
      conflictPaths: ["shared.ts"],
    });
  });

  it("captures only the registered nested workspace even if an agent commits sibling edits", () => {
    const fixture = repository();
    const workspacePath = join(fixture.root, "packages", "app");
    mkdirSync(workspacePath, { recursive: true });
    writeFileSync(join(workspacePath, "app.ts"), "export const app = 'base';\n");
    writeFileSync(join(fixture.root, "sibling.ts"), "export const sibling = 'base';\n");
    git(fixture.root, "add", ".");
    git(fixture.root, "commit", "-qm", "nested workspace");
    const { runWorkspace } = initialize({ ...fixture, workspacePath, runId: "run-nested" });
    const node = allocateGitNodeWorkspace({
      runWorkspace,
      agentId: "nested",
      attemptId: "attempt-nested",
    });

    writeFileSync(join(node.workspacePath, "app.ts"), "export const app = 'changed';\n");
    writeFileSync(join(node.worktreeRoot, "sibling.ts"), "export const sibling = 'agent-commit';\n");
    git(node.worktreeRoot, "add", ".");
    git(node.worktreeRoot, "commit", "-qm", "agent committed everything");
    const result = finalizeGitNodeWorkspace({ runWorkspace, node });
    const integration = integrateGitNodeWorkspaceResult({ runWorkspace, result });

    expect(result.changeSet.files.map((file) => file.path)).toEqual(["packages/app/app.ts"]);
    expect(git(fixture.root, "show", `${integration.integrationCommit}:packages/app/app.ts`)).toContain("changed");
    expect(git(fixture.root, "show", `${integration.integrationCommit}:sibling.ts`)).toContain("'base'");
    expect(readFileSync(join(fixture.root, "sibling.ts"), "utf8")).toContain("'base'");
  });

  it("records an unchanged node without moving the integration ref", () => {
    const fixture = repository();
    const { runWorkspace } = initialize(fixture);
    const node = allocateGitNodeWorkspace({
      runWorkspace,
      agentId: "observer",
      attemptId: "attempt-observer",
    });
    const before = currentGitRunIntegrationCommit(runWorkspace);
    const result = finalizeGitNodeWorkspace({ runWorkspace, node });
    const integration = integrateGitNodeWorkspaceResult({ runWorkspace, result });

    expect(result.changeSet.files).toEqual([]);
    expect(integration.status).toBe("no-changes");
    expect(currentGitRunIntegrationCommit(runWorkspace)).toBe(before);
  });

  it("publishes the combined result only onto the unchanged dirty source workspace", () => {
    const fixture = repository();
    writeFileSync(join(fixture.root, "shared.ts"), "export const shared = 'staged';\n");
    git(fixture.root, "add", "shared.ts");
    writeFileSync(join(fixture.root, "shared.ts"), "export const shared = 'dirty-baseline';\n");
    const cachedBefore = git(fixture.root, "diff", "--cached", "--binary");
    const { baseline, runWorkspace } = initialize({ ...fixture, runId: "run-publish" });
    const node = allocateGitNodeWorkspace({
      runWorkspace,
      agentId: "publisher",
      attemptId: "attempt-publisher",
    });
    expect(readFileSync(join(node.workspacePath, "shared.ts"), "utf8")).toContain("dirty-baseline");
    writeFileSync(join(node.workspacePath, "left.ts"), "export const left = 'published';\n");
    const result = finalizeGitNodeWorkspace({ runWorkspace, node });
    integrateGitNodeWorkspaceResult({ runWorkspace, result });

    const publication = publishGitRunWorkspaceResult({
      runWorkspace,
      baseline,
      now: new Date("2026-08-09T20:02:00.000Z"),
    });

    expect(publication.status).toBe("published");
    expect(readFileSync(join(fixture.root, "left.ts"), "utf8")).toContain("published");
    expect(readFileSync(join(fixture.root, "shared.ts"), "utf8")).toContain("dirty-baseline");
    expect(git(fixture.root, "diff", "--cached", "--binary")).toBe(cachedBefore);
    expect(publishGitRunWorkspaceResult({ runWorkspace, baseline })).toEqual(publication);
  });

  it("leaves the source untouched and reports exact drift when publication CAS loses", () => {
    const fixture = repository();
    const { baseline, runWorkspace } = initialize({ ...fixture, runId: "run-source-drift" });
    const node = allocateGitNodeWorkspace({
      runWorkspace,
      agentId: "publisher",
      attemptId: "attempt-source-drift",
    });
    writeFileSync(join(node.workspacePath, "left.ts"), "export const left = 'agent-result';\n");
    const result = finalizeGitNodeWorkspace({ runWorkspace, node });
    integrateGitNodeWorkspaceResult({ runWorkspace, result });
    writeFileSync(join(fixture.root, "right.ts"), "export const right = 'user-edit';\n");
    const sourceBefore = git(fixture.root, "status", "--porcelain=v1", "-z");

    const publication = publishGitRunWorkspaceResult({ runWorkspace, baseline });

    expect(publication.status).toBe("source-changed");
    expect(publication.sourceChanges.files.map((file) => file.path)).toEqual(["right.ts"]);
    expect(git(fixture.root, "status", "--porcelain=v1", "-z")).toBe(sourceBefore);
    expect(readFileSync(join(fixture.root, "left.ts"), "utf8")).toContain("'base'");
    expect(readFileSync(join(fixture.root, "right.ts"), "utf8")).toContain("user-edit");
  });
});
