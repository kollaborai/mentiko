/**
 * REAL handler tests for POST /api/git branch actions.
 *
 * Spins up a throwaway git repo in os.tmpdir(), mocks auth + path-validation so
 * the handler accepts it, and asserts on the actual returned data.
 *
 * No exact precedent existed for mocking requirePermission + getAllowedRoots, so
 * this is the minimal pattern: mock the three modules the route imports
 * (@/lib/auth/api-auth, @/lib/auth/rbac-auth, @/lib/system/path-validation) and
 * let everything else (the route logic + real `git` binary) run for real.
 *
 * @jest-environment node
 */
import { execSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

jest.mock("@/lib/auth/api-auth", () => ({
  checkAuth: jest.fn().mockResolvedValue(true),
}));
jest.mock("@/lib/auth/rbac-auth", () => ({
  // write actions call requirePermission; returning null means "allowed".
  requirePermission: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/system/path-validation", () => ({
  // accept whatever the caller passes — temp repo is the only root.
  resolveAndValidate: (rawPath: string) => rawPath,
  getAllowedRoots: jest.fn().mockResolvedValue([]),
}));

import { POST } from "@/app/api/git/route";
import type { NextRequest } from "next/server";

function makeRequest(body: object) {
  return new Request("http://localhost/api/git", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function git(args: string[], cwd: string) {
  execSync(["git", ...args].join(" "), { cwd, stdio: "pipe" });
}

function localBranches(cwd: string): string[] {
  return execSync('git branch --format="%(refname:short)"', {
    cwd,
    encoding: "utf-8",
  })
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

describe("POST /api/git — branch actions (real git repo)", () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "git-branch-test-"));
    git(["init", "-q"], repo);
    git(["config", "user.email", "test@example.com"], repo);
    git(["config", "user.name", "Test"], repo);
    writeFileSync(join(repo, "README.md"), "# base\n");
    git(["add", "-A"], repo);
    git(["commit", "-q", "-m", "init"], repo);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("lists branches including the default", async () => {
    git(["branch", "feature/simple"], repo);
    const res = await POST(
      makeRequest({ action: "list_branches", workspacePath: repo }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    const names = json.data.branches
      .filter((b: { isRemote?: boolean; name: string }) => !b.isRemote)
      .map((b: { name: string }) => b.name);
    expect(names).toContain("feature/simple");
    expect(json.data.current).toMatch(/main|master/);
  });

  // ── REGRESSION 1 ──────────────────────────────────────────────────────────
  // A LOCAL branch named `feature/x` (contains a slash) must NOT be
  // misinterpreted as a remote and must NOT run `git push feature --delete x`.
  // The old code did `branchName.includes("/")` → treated it as remote, which
  // left the local branch in place (push failed, no remote "feature"). Deleting
  // the local branch proves the fix: after the call `feature/x` is gone locally.
  it("delete_branch on a local `feature/x` branch deletes the local branch", async () => {
    git(["branch", "feature/x"], repo);
    git(["branch", "feature/y"], repo);
    expect(localBranches(repo)).toEqual(
      expect.arrayContaining(["feature/x", "feature/y"]),
    );

    const res = await POST(
      makeRequest({ action: "delete_branch", workspacePath: repo, branchName: "feature/x" }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.ok).toBe(true);
    expect(json.data.deleted).toBe("feature/x");

    // the real proof: `feature/x` is gone, `feature/y` survived. No remote is
    // configured at all, so a buggy `git push feature --delete x` would have
    // failed and left `feature/x` present — making this assertion fail.
    const remaining = localBranches(repo);
    expect(remaining).not.toContain("feature/x");
    expect(remaining).toContain("feature/y");
  });

  it("delete_branch on a simple (slashless) branch deletes the local branch", async () => {
    git(["branch", "plain"], repo);
    const res = await POST(
      makeRequest({ action: "delete_branch", workspacePath: repo, branchName: "plain" }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data.ok).toBe(true);
    expect(localBranches(repo)).not.toContain("plain");
  });

  it("create_branch then switch_branch round-trips", async () => {
    const create = await POST(
      makeRequest({ action: "create_branch", workspacePath: repo, branchName: "feature/z" }),
    );
    expect((await create.json()).data.ok).toBe(true);

    const sw = await POST(
      makeRequest({ action: "switch_branch", workspacePath: repo, branchName: "feature/z" }),
    );
    const swJson = await sw.json();
    expect(swJson.data.ok).toBe(true);
    expect(swJson.data.current).toBe("feature/z");
  });
});
