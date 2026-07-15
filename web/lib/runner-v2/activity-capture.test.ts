/** @jest-environment node */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunRecordFile, readRunRecordAt, type RunRecord } from "@/lib/runs/run-record";
import { captureAgentActivity } from "@/lib/runner-v2/activity-capture";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "mentiko-activity-capture-"));
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function createRun(runsDir: string, runId: string): void {
  const run: RunRecord = {
    id: runId,
    chain: "activity-chain",
    goal: "capture activity",
    started: "2026-07-15T00:00:00.000Z",
    status: "running",
    sessions: [],
    agents: [{ id: "writer", name: "Writer", session: "writer-session", status: "running" }],
  };
  createRunRecordFile(runsDir, run);
}

describe("typed agent activity capture", () => {
  it("captures git, transcript, output, and run provenance through typed atomic writes", () => {
    const root = tempDir();
    const projectRoot = join(root, "project");
    const runsDir = join(root, "runs");
    mkdirSync(projectRoot);
    mkdirSync(runsDir);
    git(projectRoot, "init", "-q");
    git(projectRoot, "config", "user.email", "activity@example.test");
    git(projectRoot, "config", "user.name", "Activity Test");
    writeFileSync(join(projectRoot, "notes.txt"), "before\n");
    git(projectRoot, "add", "notes.txt");
    git(projectRoot, "commit", "-qm", "before activity");
    writeFileSync(join(projectRoot, "notes.txt"), "after\n");
    git(projectRoot, "add", "notes.txt");
    git(projectRoot, "commit", "-qm", "activity change");

    const runId = "run-activity";
    createRun(runsDir, runId);
    const artifactsDir = join(runsDir, runId, "artifacts");
    mkdirSync(artifactsDir);
    const beforeSha = git(projectRoot, "rev-parse", "HEAD^");
    writeFileSync(join(artifactsDir, "writer-git-before.txt"), `${beforeSha}\n`);
    const startedAt = new Date();
    writeFileSync(join(artifactsDir, "writer-started-at.txt"), `${startedAt.toISOString()}\n`);

    const logsRoot = join(root, "logs");
    const profileDir = join(root, "profiles");
    mkdirSync(logsRoot);
    mkdirSync(profileDir);
    const profilePath = join(profileDir, "profile.json");
    writeJson(profilePath, {
      id: "profile",
      name: "Profile",
      cli: "claude",
      log_path: logsRoot,
    });
    const slug = projectRoot.replace(/^\//, "-").replace(/[/.]/g, "-");
    const conversationDir = join(logsRoot, slug);
    mkdirSync(conversationDir);
    const conversationPath = join(conversationDir, "conversation.jsonl");
    writeFileSync(conversationPath, "{\"role\":\"assistant\"}\n");
    const reportPath = join(root, "report.txt");
    writeFileSync(reportPath, "line one\nline two\n");

    const result = captureAgentActivity({
      agentId: "writer",
      runId,
      projectRoot,
      runsDir,
      reportFile: reportPath,
      profileFile: profilePath,
      now: new Date("2026-07-15T00:01:00.000Z"),
    });

    expect(result.git).toMatchObject({ captured: true, filesChanged: 1 });
    expect(result.conversations.captured).toBe(true);
    expect(result.conversations.files).toContain(conversationPath);
    expect(result.output).toMatchObject({ captured: true, lines: 2 });
    expect(result.manifest.updated).toBe(true);
    expect(readFileSync(join(artifactsDir, "writer-files-changed.json"), "utf8")).toContain('"status": "M"');
    expect(readFileSync(join(artifactsDir, "writer-diff.patch"), "utf8")).toContain("+after");
    expect(readFileSync(join(artifactsDir, "writer-output.txt"), "utf8")).toBe("line one\nline two\n");
    expect(readRunRecordAt(runsDir, runId).artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ agentId: "writer", type: "diff", diffLines: expect.any(Number) }),
      expect.objectContaining({ agentId: "writer", type: "files", fileCount: 1 }),
    ]));
  });

  it("does not invent a transcript CLI when the profile is absent", () => {
    const root = tempDir();
    const projectRoot = join(root, "project");
    const runsDir = join(root, "runs");
    mkdirSync(projectRoot);
    mkdirSync(runsDir);
    git(projectRoot, "init", "-q");
    git(projectRoot, "config", "user.email", "activity@example.test");
    git(projectRoot, "config", "user.name", "Activity Test");
    writeFileSync(join(projectRoot, "notes.txt"), "content\n");
    git(projectRoot, "add", "notes.txt");
    git(projectRoot, "commit", "-qm", "initial");
    createRun(runsDir, "run-no-profile");
    const artifactsDir = join(runsDir, "run-no-profile", "artifacts");
    mkdirSync(artifactsDir);
    writeFileSync(join(artifactsDir, "writer-started-at.txt"), `${new Date().toISOString()}\n`);

    const result = captureAgentActivity({
      agentId: "writer",
      runId: "run-no-profile",
      projectRoot,
      runsDir,
    });

    expect(result.conversations).toMatchObject({ captured: true, files: [], reason: "profile file is absent" });
    expect(readFileSync(join(artifactsDir, "writer-conversations.json"), "utf8")).toBe("[]\n");
  });

  it("rejects symlinked profile and artifact paths before treating them as provenance", () => {
    const root = tempDir();
    const projectRoot = join(root, "project");
    const runsDir = join(root, "runs");
    mkdirSync(projectRoot);
    mkdirSync(runsDir);
    git(projectRoot, "init", "-q");
    git(projectRoot, "config", "user.email", "activity@example.test");
    git(projectRoot, "config", "user.name", "Activity Test");
    writeFileSync(join(projectRoot, "notes.txt"), "content\n");
    git(projectRoot, "add", "notes.txt");
    git(projectRoot, "commit", "-qm", "initial");
    createRun(runsDir, "run-symlink");
    const artifactsDir = join(runsDir, "run-symlink", "artifacts");
    mkdirSync(artifactsDir);
    writeFileSync(join(artifactsDir, "writer-started-at.txt"), `${new Date().toISOString()}\n`);
    const profilePath = join(root, "profile.json");
    writeJson(profilePath, { id: "profile", name: "Profile", cli: "claude" });
    const profileLink = join(root, "profile-link.json");
    symlinkSync(profilePath, profileLink);

    expect(() => captureAgentActivity({
      agentId: "writer",
      runId: "run-symlink",
      projectRoot,
      runsDir,
      profileFile: profileLink,
    })).toThrow("agent profile must not be a symbolic link");

    const outside = join(root, "outside");
    mkdirSync(outside);
    const symlinkedArtifacts = join(runsDir, "run-symlinked");
    mkdirSync(symlinkedArtifacts);
    symlinkSync(outside, join(symlinkedArtifacts, "artifacts"));
    expect(() => captureAgentActivity({
      agentId: "writer",
      runId: "run-symlinked",
      projectRoot,
      runsDir,
    })).toThrow("activity artifact directory must not be a symbolic link");
    expect(lstatSync(join(symlinkedArtifacts, "artifacts")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(outside, "writer-output.txt"))).toBe(false);
  });
});
