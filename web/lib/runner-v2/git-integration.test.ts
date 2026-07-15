/** @jest-environment node */

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GitRepositoryError,
  readGitBranchComparison,
  readGitBranches,
  readGitCommitInfo,
  readGitConflicts,
  readGitDiff,
  readGitDiffSummary,
  readGitHistoryDetailed,
  readGitHistory,
  readGitStatus,
  readGitStashList,
} from "./git-integration";
import { runRunnerGitIntegrationCli } from "./git-integration-cli";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).toString();
}

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), "mentiko-git-integration-"));
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.name", "Agent Chain"]);
  git(root, ["config", "user.email", "agent@chain.local"]);
  writeFileSync(join(root, "chain.json"), "{\"name\":\"fixture\"}\n");
  git(root, ["add", "chain.json"]);
  git(root, ["commit", "-qm", "Initial import"]);
  return root;
}

describe("typed git integration projections", () => {
  it("parses staged, modified, deleted, and untracked status without shell JSON", () => {
    const root = repository();
    writeFileSync(join(root, "chain.json"), "{\"name\":\"changed\"}\n");
    writeFileSync(join(root, "staged.txt"), "staged\n");
    git(root, ["add", "staged.txt"]);
    writeFileSync(join(root, "modified.txt"), "modified\n");
    git(root, ["add", "modified.txt"]);
    writeFileSync(join(root, "modified.txt"), "modified again\n");
    writeFileSync(join(root, "untracked.txt"), "untracked\n");

    expect(readGitStatus(root)).toMatchObject({
      branch: "main",
      staged: expect.arrayContaining(["staged.txt", "modified.txt"]),
      modified: expect.arrayContaining(["chain.json", "modified.txt"]),
      untracked: ["untracked.txt"],
      has_changes: true,
    });
  });

  it("parses record-separated history and preserves quoted messages", () => {
    const root = repository();
    writeFileSync(join(root, "chain.json"), "{\"name\":\"changed\"}\n");
    git(root, ["add", "chain.json"]);
    git(root, ["commit", "-qm", "quoted \"message\" | safe"]);

    const records = readGitHistory(root, 2);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ message: 'quoted "message" | safe' });
    expect(records[0].hash).toMatch(/^[0-9a-f]{40}$/);
    expect(records[0].short).toHaveLength(7);

    const detailed = readGitHistoryDetailed(root, 1, "main");
    expect(detailed[0]).toMatchObject({ message: 'quoted "message" | safe', body: "" });
  });

  it("owns base64 diff records and exposes the same shape through the CLI", () => {
    const root = repository();
    const from = git(root, ["rev-parse", "HEAD"]).trim();
    writeFileSync(join(root, "chain.json"), "{\"name\":\"changed\"}\n");
    git(root, ["add", "chain.json"]);
    git(root, ["commit", "-qm", "change"]);
    const to = git(root, ["rev-parse", "HEAD"]).trim();

    const record = readGitDiff(root, from, to);
    expect(record).toMatchObject({ from, to, files: [{ status: "M", file: "chain.json" }] });
    expect(Buffer.from(record.files[0].diff, "base64").toString("utf8")).toContain("+{\"name\":\"changed\"}");

    const summary = readGitDiffSummary(root, from, to, true);
    expect(summary).toMatchObject({
      from,
      to,
      files: [{ status: "modified", file: "chain.json", additions: 1, deletions: 1 }],
      summary: { filesChanged: 1, additions: 1, deletions: 1 },
    });
    expect(summary.diff).toContain("+{\"name\":\"changed\"}");

    const lines: string[] = [];
    runRunnerGitIntegrationCli(["diff", "--chain-dir", root, "--from", from, "--to", to], (line) => lines.push(line));
    expect(JSON.parse(lines[0])).toEqual(record);
  });

  it("rejects a missing or symlinked repository instead of inventing records", () => {
    const missing = join(mkdtempSync(join(tmpdir(), "mentiko-git-missing-")), "chain");
    expect(() => readGitStatus(missing)).toThrow(GitRepositoryError);

    const root = mkdtempSync(join(tmpdir(), "mentiko-git-symlink-"));
    const target = mkdtempSync(join(tmpdir(), "mentiko-git-target-"));
    mkdirSync(join(target, ".git"));
    symlinkSync(join(target, ".git"), join(root, ".git"));
    expect(() => readGitHistory(root)).toThrow(GitRepositoryError);
  });

  it("rejects option-like diff revisions before invoking Git", () => {
    const root = repository();
    expect(() => readGitDiff(root, "--output=/tmp/escape", "HEAD")).toThrow("invalid from revision");
  });

  it("lists branches and flags the current branch without shell JSON", () => {
    const root = repository();
    git(root, ["checkout", "-q", "-b", "feature"]);
    writeFileSync(join(root, "chain.json"), "{\"name\":\"changed\"}\n");
    git(root, ["add", "chain.json"]);
    git(root, ["commit", "-qm", 'quoted "branch" msg']);

    const records = readGitBranches(root);
    const feature = records.find((record) => record.name === "feature");
    const main = records.find((record) => record.name === "main");
    expect(records.map((record) => record.name).sort()).toEqual(["feature", "main"]);
    expect(feature?.current).toBe(true);
    expect(feature?.message).toBe('quoted "branch" msg');
    expect(feature?.short).toHaveLength(7);
    expect(main?.current).toBe(false);
  });

  it("normalizes conflict detection to a stable conflicts record", () => {
    const clean = repository();
    expect(readGitConflicts(clean)).toEqual({ conflicts: [] });

    const root = repository();
    git(root, ["checkout", "-q", "-b", "feature"]);
    writeFileSync(join(root, "chain.json"), "{\"name\":\"feature\"}\n");
    git(root, ["add", "chain.json"]);
    git(root, ["commit", "-qm", "feature change"]);
    git(root, ["checkout", "-q", "main"]);
    writeFileSync(join(root, "chain.json"), "{\"name\":\"main\"}\n");
    git(root, ["add", "chain.json"]);
    git(root, ["commit", "-qm", "main change"]);
    try {
      git(root, ["merge", "--no-ff", "-q", "feature"]);
    } catch {
      // git merge exits non-zero on conflict; expected.
    }

    expect(readGitConflicts(root)).toEqual({ conflicts: ["chain.json"] });
  });

  it("parses commit metadata and changed files", () => {
    const root = repository();
    const head = git(root, ["rev-parse", "HEAD"]).trim();
    const record = readGitCommitInfo(root, "HEAD");
    expect(record.hash).toBe(head);
    expect(record.short).toHaveLength(7);
    expect(record.author).toBe("Agent Chain");
    expect(record.author_email).toBe("agent@chain.local");
    expect(record.message).toBe("Initial import");
    expect(record.files).toEqual([{ status: "A", file: "chain.json" }]);
  });

  it("counts ahead/behind between revisions and rejects option-like refs", () => {
    const root = repository();
    git(root, ["checkout", "-q", "-b", "feature"]);
    writeFileSync(join(root, "chain.json"), "{\"name\":\"changed\"}\n");
    git(root, ["add", "chain.json"]);
    git(root, ["commit", "-qm", "feature commit"]);
    git(root, ["checkout", "-q", "main"]);

    expect(readGitBranchComparison(root, "feature", "main")).toEqual({
      branch1: "feature",
      branch2: "main",
      ahead: 1,
      behind: 0,
    });
    expect(() => readGitBranchComparison(root, "--output=/tmp/escape", "main")).toThrow("invalid branch1");
  });

  it("lists stashed changes with stash id and message", () => {
    const root = repository();
    writeFileSync(join(root, "chain.json"), "{\"name\":\"wip\"}\n");
    git(root, ["stash", "push", "-q", "-m", "auto-stash before switch"]);

    const records = readGitStashList(root);
    expect(records).toHaveLength(1);
    expect(records[0].stash).toMatch(/^[0-9a-f]{40}$/);
    expect(records[0].message).toContain("auto-stash before switch");
  });

  it("exposes branches, conflicts, commit-info, compare, and stash through the CLI", () => {
    const root = repository();
    git(root, ["checkout", "-q", "-b", "feature"]);
    writeFileSync(join(root, "chain.json"), "{\"name\":\"changed\"}\n");
    git(root, ["add", "chain.json"]);
    git(root, ["commit", "-qm", "feature commit"]);

    const branchLines: string[] = [];
    runRunnerGitIntegrationCli(["branches", "--chain-dir", root], (line) => branchLines.push(line));
    const branches = JSON.parse(branchLines[0]);
    expect(branches.find((record: { name: string }) => record.name === "feature").current).toBe(true);

    const conflictLines: string[] = [];
    runRunnerGitIntegrationCli(["conflicts", "--chain-dir", root], (line) => conflictLines.push(line));
    expect(JSON.parse(conflictLines[0])).toEqual({ conflicts: [] });

    const head = git(root, ["rev-parse", "HEAD"]).trim();
    const commitLines: string[] = [];
    runRunnerGitIntegrationCli(["commit-info", "--chain-dir", root, "--commit", "HEAD"], (line) => commitLines.push(line));
    expect(JSON.parse(commitLines[0]).hash).toBe(head);

    const compareLines: string[] = [];
    runRunnerGitIntegrationCli(
      ["compare", "--chain-dir", root, "--branch1", "feature", "--branch2", "main"],
      (line) => compareLines.push(line),
    );
    expect(JSON.parse(compareLines[0])).toEqual({ branch1: "feature", branch2: "main", ahead: 1, behind: 0 });

    const stashLines: string[] = [];
    runRunnerGitIntegrationCli(["stash-list", "--chain-dir", root], (line) => stashLines.push(line));
    expect(JSON.parse(stashLines[0])).toEqual([]);
  });
});
