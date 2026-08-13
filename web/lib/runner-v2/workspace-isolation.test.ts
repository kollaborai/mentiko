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
  readGitNodeIntegrationResult,
  removeIntegratedGitNodeWorkspace,
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

  it("replays node finalization after crashes on either side of the attempt-ref CAS", () => {
    const fixture = repository();
    const { runWorkspace } = initialize({ ...fixture, runId: "run-result-crash-replay" });
    const beforeRef = allocateGitNodeWorkspace({
      runWorkspace,
      agentId: "crash-before-ref",
      attemptId: "attempt-crash-before-ref",
    });
    writeFileSync(join(beforeRef.workspacePath, "left.ts"), "export const left = 'before-ref';\n");

    expect(() => finalizeGitNodeWorkspace({
      runWorkspace,
      node: beforeRef,
      now: new Date("2026-08-09T20:00:10.000Z"),
      afterResultReceiptPersisted: () => {
        throw new Error("crash-after-result-receipt");
      },
    })).toThrow("crash-after-result-receipt");
    expect(git(fixture.root, "show-ref", "--hash", beforeRef.attemptRef)).toBe(beforeRef.baseCommit);
    const recoveredBeforeRef = finalizeGitNodeWorkspace({ runWorkspace, node: beforeRef });
    expect(git(fixture.root, "show-ref", "--hash", beforeRef.attemptRef)).toBe(
      recoveredBeforeRef.resultCommit,
    );

    const afterRef = allocateGitNodeWorkspace({
      runWorkspace,
      agentId: "crash-after-ref",
      attemptId: "attempt-crash-after-ref",
    });
    writeFileSync(join(afterRef.workspacePath, "right.ts"), "export const right = 'after-ref';\n");
    expect(() => finalizeGitNodeWorkspace({
      runWorkspace,
      node: afterRef,
      now: new Date("2026-08-09T20:00:11.000Z"),
      afterAttemptRefAdvanced: () => {
        throw new Error("crash-after-attempt-ref");
      },
    })).toThrow("crash-after-attempt-ref");
    const advanced = git(fixture.root, "show-ref", "--hash", afterRef.attemptRef);
    const recoveredAfterRef = finalizeGitNodeWorkspace({ runWorkspace, node: afterRef });
    expect(recoveredAfterRef.resultCommit).toBe(advanced);
    expect(recoveredAfterRef.artifactPath).toContain(
      join(".internal", "workspace-isolation", "receipts", "results"),
    );
  });

  it("replays integration after a crash between its private receipt and ref CAS", () => {
    const fixture = repository();
    const { runWorkspace } = initialize({ ...fixture, runId: "run-integration-crash-replay" });
    const node = allocateGitNodeWorkspace({
      runWorkspace,
      agentId: "integration-crash",
      attemptId: "attempt-integration-crash",
    });
    writeFileSync(join(node.workspacePath, "left.ts"), "export const left = 'integrated';\n");
    const result = finalizeGitNodeWorkspace({ runWorkspace, node });
    const before = currentGitRunIntegrationCommit(runWorkspace);

    expect(() => integrateGitNodeWorkspaceResult({
      runWorkspace,
      result,
      afterIntegrationReceiptPersisted: () => {
        throw new Error("crash-after-integration-receipt");
      },
    })).toThrow("crash-after-integration-receipt");
    expect(currentGitRunIntegrationCommit(runWorkspace)).toBe(before);

    const recovered = integrateGitNodeWorkspaceResult({ runWorkspace, result });
    expect(recovered.status).toBe("integrated");
    expect(currentGitRunIntegrationCommit(runWorkspace)).toBe(recovered.integrationCommit);
    expect(recovered.artifactPath).toContain(
      join(".internal", "workspace-isolation", "receipts", "integrations"),
    );
  });

  it("reconciles an older pending integration receipt before merging a sibling", () => {
    const fixture = repository();
    const { runWorkspace } = initialize({ ...fixture, runId: "run-integration-sibling-replay" });
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
    writeFileSync(join(first.workspacePath, "left.ts"), "export const left = 'first';\n");
    writeFileSync(join(second.workspacePath, "right.ts"), "export const right = 'second';\n");
    const firstResult = finalizeGitNodeWorkspace({ runWorkspace, node: first });
    const secondResult = finalizeGitNodeWorkspace({ runWorkspace, node: second });
    const baseline = currentGitRunIntegrationCommit(runWorkspace);

    expect(() => integrateGitNodeWorkspaceResult({
      runWorkspace,
      result: firstResult,
      afterIntegrationReceiptPersisted: () => {
        throw new Error("crash-before-first-ref-cas");
      },
    })).toThrow("crash-before-first-ref-cas");
    expect(currentGitRunIntegrationCommit(runWorkspace)).toBe(baseline);

    const secondIntegration = integrateGitNodeWorkspaceResult({
      runWorkspace,
      result: secondResult,
    });
    const finalCommit = currentGitRunIntegrationCommit(runWorkspace);
    expect(secondIntegration.status).toBe("integrated");
    expect(secondIntegration.previousIntegrationCommit).not.toBe(baseline);
    expect(finalCommit).toBe(secondIntegration.integrationCommit);
    expect(git(fixture.root, "show", `${finalCommit}:left.ts`)).toContain("first");
    expect(git(fixture.root, "show", `${finalCommit}:right.ts`)).toContain("second");

    const firstReplay = integrateGitNodeWorkspaceResult({ runWorkspace, result: firstResult });
    expect(firstReplay.integrationCommit).toBe(secondIntegration.previousIntegrationCommit);
    expect(currentGitRunIntegrationCommit(runWorkspace)).toBe(finalCommit);
  });

  it("does not trust a no-change receipt when the node worktree has dirty output", () => {
    const fixture = repository();
    const { runWorkspace } = initialize({ ...fixture, runId: "run-no-change-receipt" });
    const node = allocateGitNodeWorkspace({
      runWorkspace,
      agentId: "late-writer",
      attemptId: "attempt-late-writer",
    });
    const result = finalizeGitNodeWorkspace({ runWorkspace, node });
    expect(integrateGitNodeWorkspaceResult({ runWorkspace, result }).status).toBe("no-changes");

    writeFileSync(join(node.workspacePath, "left.ts"), "export const left = 'late-output';\n");
    expect(() => readGitNodeIntegrationResult({
      runWorkspace,
      agentId: node.agentId,
      attemptId: node.attemptId,
    })).toThrow(/node worktree differs from its result receipt/);
  });

  it("removes an integrated node worktree while preserving idempotent replay evidence", () => {
    const fixture = repository();
    const { runWorkspace } = initialize({ ...fixture, runId: "run-cleanup" });
    const node = allocateGitNodeWorkspace({
      runWorkspace,
      agentId: "cleanup",
      attemptId: "attempt-cleanup",
    });
    writeFileSync(join(node.workspacePath, "left.ts"), "export const left = 'cleaned';\n");
    const result = finalizeGitNodeWorkspace({ runWorkspace, node });
    const integration = integrateGitNodeWorkspaceResult({ runWorkspace, result });

    expect(removeIntegratedGitNodeWorkspace({
      runWorkspace,
      agentId: node.agentId,
      attemptId: node.attemptId,
    })).toBe("removed");
    expect(existsSync(node.worktreeRoot)).toBe(false);
    expect(() => git(fixture.root, "show-ref", "--verify", node.attemptRef)).toThrow();
    expect(readGitNodeIntegrationResult({
      runWorkspace,
      agentId: node.agentId,
      attemptId: node.attemptId,
    })).toEqual(integration);
    expect(integrateGitNodeWorkspaceResult({ runWorkspace, result })).toEqual(integration);
    expect(removeIntegratedGitNodeWorkspace({
      runWorkspace,
      agentId: node.agentId,
      attemptId: node.attemptId,
    })).toBe("already-removed");
  });

  it("fails closed when immutable integration replay evidence is corrupted", () => {
    const fixture = repository();
    const { runWorkspace } = initialize({ ...fixture, runId: "run-corrupt-integration" });
    const node = allocateGitNodeWorkspace({
      runWorkspace,
      agentId: "corrupt",
      attemptId: "attempt-corrupt",
    });
    writeFileSync(join(node.workspacePath, "left.ts"), "export const left = 'changed';\n");
    const result = finalizeGitNodeWorkspace({ runWorkspace, node });
    const integration = integrateGitNodeWorkspaceResult({ runWorkspace, result });
    writeFileSync(integration.artifactPath, JSON.stringify({
      ...integration,
      status: "conflict",
      conflictPaths: [],
    }));

    expect(() => readGitNodeIntegrationResult({
      runWorkspace,
      agentId: node.agentId,
      attemptId: node.attemptId,
    })).toThrow(/node integration identity mismatch/);
  });

  it("keeps a capacity-delayed parallel node on its routing-time edge commit", () => {
    const fixture = repository();
    const { runWorkspace } = initialize({ ...fixture, runId: "run-delayed-parallel" });
    const edgeCommit = currentGitRunIntegrationCommit(runWorkspace);
    const first = allocateGitNodeWorkspace({
      runWorkspace,
      agentId: "first",
      attemptId: "attempt-delayed-first",
      baseCommit: edgeCommit,
    });
    writeFileSync(join(first.workspacePath, "left.ts"), "export const left = 'first-result';\n");
    const firstResult = finalizeGitNodeWorkspace({ runWorkspace, node: first });
    integrateGitNodeWorkspaceResult({ runWorkspace, result: firstResult });
    expect(currentGitRunIntegrationCommit(runWorkspace)).not.toBe(edgeCommit);

    const delayed = allocateGitNodeWorkspace({
      runWorkspace,
      agentId: "delayed",
      attemptId: "attempt-delayed-second",
      baseCommit: edgeCommit,
    });

    expect(delayed.baseCommit).toBe(edgeCommit);
    expect(readFileSync(join(delayed.workspacePath, "left.ts"), "utf8")).toContain("'base'");
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
    expect(removeIntegratedGitNodeWorkspace({
      runWorkspace,
      agentId: second.agentId,
      attemptId: second.attemptId,
    })).toBe("preserved-conflict");
    expect(existsSync(second.worktreeRoot)).toBe(true);
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

  it("rechecks the source immediately before apply and leaves race-time edits untouched", () => {
    const fixture = repository();
    const { baseline, runWorkspace } = initialize({ ...fixture, runId: "run-source-race" });
    const node = allocateGitNodeWorkspace({
      runWorkspace,
      agentId: "publisher",
      attemptId: "attempt-source-race",
    });
    writeFileSync(join(node.workspacePath, "left.ts"), "export const left = 'agent-result';\n");
    const result = finalizeGitNodeWorkspace({ runWorkspace, node });
    integrateGitNodeWorkspaceResult({ runWorkspace, result });

    const publication = publishGitRunWorkspaceResult({
      runWorkspace,
      baseline,
      beforeApplyCas: () => {
        writeFileSync(join(fixture.root, "right.ts"), "export const right = 'race-edit';\n");
      },
    });

    expect(publication.status).toBe("source-changed");
    expect(readFileSync(join(fixture.root, "left.ts"), "utf8")).toContain("'base'");
    expect(readFileSync(join(fixture.root, "right.ts"), "utf8")).toContain("race-edit");
  });

  it("reverts the Mentiko patch when an unrelated source edit lands after apply", () => {
    const fixture = repository();
    const { baseline, runWorkspace } = initialize({ ...fixture, runId: "run-post-apply-race" });
    const node = allocateGitNodeWorkspace({
      runWorkspace,
      agentId: "publisher",
      attemptId: "attempt-post-apply-race",
    });
    writeFileSync(join(node.workspacePath, "left.ts"), "export const left = 'agent-result';\n");
    const result = finalizeGitNodeWorkspace({ runWorkspace, node });
    integrateGitNodeWorkspaceResult({ runWorkspace, result });

    const publication = publishGitRunWorkspaceResult({
      runWorkspace,
      baseline,
      afterApplyBeforeVerify: () => {
        writeFileSync(join(fixture.root, "right.ts"), "export const right = 'user-race';\n");
      },
    });

    expect(publication).toMatchObject({
      status: "source-changed",
      rollback: { status: "reverted" },
    });
    expect(publication.sourceChanges.files.map((file) => file.path)).toEqual(["right.ts"]);
    expect(readFileSync(join(fixture.root, "left.ts"), "utf8")).toContain("'base'");
    expect(readFileSync(join(fixture.root, "right.ts"), "utf8")).toContain("user-race");
    expect(publishGitRunWorkspaceResult({ runWorkspace, baseline })).toEqual(publication);
  });

  it("blocks with immutable evidence when a same-patch race makes rollback unsafe", () => {
    const fixture = repository();
    const { baseline, runWorkspace } = initialize({ ...fixture, runId: "run-post-apply-rollback-failure" });
    const node = allocateGitNodeWorkspace({
      runWorkspace,
      agentId: "publisher",
      attemptId: "attempt-post-apply-rollback-failure",
    });
    writeFileSync(join(node.workspacePath, "left.ts"), "export const left = 'agent-left';\n");
    writeFileSync(join(node.workspacePath, "right.ts"), "export const right = 'agent-right';\n");
    const result = finalizeGitNodeWorkspace({ runWorkspace, node });
    integrateGitNodeWorkspaceResult({ runWorkspace, result });

    const publication = publishGitRunWorkspaceResult({
      runWorkspace,
      baseline,
      afterApplyBeforeVerify: () => {
        writeFileSync(join(fixture.root, "left.ts"), "export const left = 'user-race';\n");
      },
    });

    expect(publication).toMatchObject({
      status: "source-changed",
      rollback: {
        status: "failed",
        error: expect.stringContaining("git apply failed"),
        revertedPaths: ["right.ts"],
        preservedPaths: ["left.ts"],
      },
    });
    expect(publication.artifactPath).toContain("publication-conflicts");
    expect(readFileSync(join(fixture.root, "left.ts"), "utf8")).toContain("user-race");
    expect(readFileSync(join(fixture.root, "right.ts"), "utf8")).toContain("'base'");
    expect(publishGitRunWorkspaceResult({ runWorkspace, baseline })).toEqual(publication);
  });

  it("treats index-only drift as a publication conflict", () => {
    const fixture = repository();
    const { baseline, runWorkspace } = initialize({ ...fixture, runId: "run-index-drift" });
    const node = allocateGitNodeWorkspace({
      runWorkspace,
      agentId: "publisher",
      attemptId: "attempt-index-drift",
    });
    writeFileSync(join(node.workspacePath, "left.ts"), "export const left = 'agent-result';\n");
    const result = finalizeGitNodeWorkspace({ runWorkspace, node });
    integrateGitNodeWorkspaceResult({ runWorkspace, result });

    writeFileSync(join(fixture.root, "right.ts"), "export const right = 'staged-only';\n");
    git(fixture.root, "add", "right.ts");
    writeFileSync(join(fixture.root, "right.ts"), "export const right = 'base';\n");
    const publication = publishGitRunWorkspaceResult({ runWorkspace, baseline });

    expect(publication.status).toBe("source-changed");
    expect(publication.sourceChanges.files).toEqual([]);
    expect(readFileSync(join(fixture.root, "left.ts"), "utf8")).toContain("'base'");
    expect(git(fixture.root, "diff", "--cached", "--", "right.ts")).toContain("staged-only");
  });

  it("can publish after a source-drift conflict is explicitly restored", () => {
    const fixture = repository();
    const { baseline, runWorkspace } = initialize({ ...fixture, runId: "run-source-retry" });
    const node = allocateGitNodeWorkspace({
      runWorkspace,
      agentId: "publisher",
      attemptId: "attempt-source-retry",
    });
    writeFileSync(join(node.workspacePath, "left.ts"), "export const left = 'agent-result';\n");
    const result = finalizeGitNodeWorkspace({ runWorkspace, node });
    integrateGitNodeWorkspaceResult({ runWorkspace, result });
    writeFileSync(join(fixture.root, "right.ts"), "export const right = 'temporary-user-edit';\n");

    const conflict = publishGitRunWorkspaceResult({ runWorkspace, baseline });
    expect(conflict.status).toBe("source-changed");
    expect(conflict.artifactPath).toContain("publication-conflicts");

    writeFileSync(join(fixture.root, "right.ts"), "export const right = 'base';\n");
    const recovered = publishGitRunWorkspaceResult({ runWorkspace, baseline });
    expect(recovered.status).toBe("published");
    expect(recovered.artifactPath).toContain(join("receipts", "publication.json"));
    expect(readFileSync(join(fixture.root, "left.ts"), "utf8")).toContain("agent-result");
  });
});
