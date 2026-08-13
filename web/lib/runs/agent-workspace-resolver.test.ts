import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAgentWorkspacePaths } from "@/lib/runs/agent-workspace-resolver";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "mentiko-agent-workspace-resolver-"));
}

describe("resolveAgentWorkspacePaths", () => {
  it("includes the isolated node worktree recorded by the agent handoff", () => {
    const root = tempDir();
    const sourceWorkspace = join(root, "workspace");
    const runDir = join(root, "runs", "run-1");
    const artifactsDir = join(runDir, "artifacts");
    const worktree = join(runDir, ".internal", "workspace-isolation", "worktrees", "node-1");
    mkdirSync(sourceWorkspace, { recursive: true });
    mkdirSync(worktree, { recursive: true });
    mkdirSync(artifactsDir, { recursive: true });
    writeFileSync(
      join(artifactsDir, "writer-workspace-start-run-1-writer-1.json"),
      JSON.stringify({ agentId: "writer", workspacePath: worktree }),
    );

    expect(resolveAgentWorkspacePaths(artifactsDir, "writer", sourceWorkspace)).toEqual([
      sourceWorkspace,
      worktree,
    ]);
  });

  it("ignores a handoff path outside the run worktree or source workspace", () => {
    const root = tempDir();
    const sourceWorkspace = join(root, "workspace");
    const runDir = join(root, "runs", "run-1");
    const artifactsDir = join(runDir, "artifacts");
    const outside = join(root, "untrusted");
    mkdirSync(sourceWorkspace, { recursive: true });
    mkdirSync(artifactsDir, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(
      join(artifactsDir, "writer-workspace-start-run-1-writer-1.json"),
      JSON.stringify({ agentId: "writer", workspacePath: outside }),
    );

    expect(resolveAgentWorkspacePaths(artifactsDir, "writer", sourceWorkspace)).toEqual([
      sourceWorkspace,
    ]);
  });

  it("keeps a recorded worktree path after the worktree is cleaned up", () => {
    const root = tempDir();
    const sourceWorkspace = join(root, "workspace");
    const runDir = join(root, "runs", "run-1");
    const artifactsDir = join(runDir, "artifacts");
    const cleanedWorktree = join(
      runDir,
      ".internal",
      "workspace-isolation",
      "worktrees",
      "node-1",
    );
    mkdirSync(sourceWorkspace, { recursive: true });
    mkdirSync(artifactsDir, { recursive: true });
    writeFileSync(
      join(artifactsDir, "writer-workspace-start-run-1-writer-1.json"),
      JSON.stringify({ agentId: "writer", workspacePath: cleanedWorktree }),
    );

    expect(resolveAgentWorkspacePaths(artifactsDir, "writer", sourceWorkspace)).toEqual([
      sourceWorkspace,
      cleanedWorktree,
    ]);
  });
});
