/**
 * REAL handler test for POST /api/git `show_commit` action (the log-view "diff
 * report" tab). Mirrors branch-api.test.ts: throwaway temp repo, mocked auth +
 * path-validation, real route + real `git`.
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
  requirePermission: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/system/path-validation", () => ({
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

describe("POST /api/git — show_commit (real git repo)", () => {
  let repo: string;
  let hash: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "git-showcommit-test-"));
    git(["init", "-q"], repo);
    git(["config", "user.email", "test@example.com"], repo);
    git(["config", "user.name", "Test"], repo);
    writeFileSync(join(repo, "hello.txt"), "hello world\n");
    git(["add", "-A"], repo);
    git(["commit", "-q", "-m", "add-hello"], repo);
    hash = execSync("git rev-parse HEAD", { cwd: repo, encoding: "utf-8" }).trim();
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("returns the full patch for a valid commit hash", async () => {
    const res = await POST(
      makeRequest({ action: "show_commit", workspacePath: repo, commitHash: hash }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    // the patch carries the subject line and the added-file diff
    expect(json.data.content).toContain("add-hello");
    expect(json.data.content).toContain("hello.txt");
    expect(json.data.content).toContain("+hello world");
  });

  it("accepts an abbreviated hash", async () => {
    const res = await POST(
      makeRequest({ action: "show_commit", workspacePath: repo, commitHash: hash.slice(0, 8) }),
    );
    const json = await res.json();
    expect(json.data.content).toContain("hello.txt");
  });

  // Guard: a non-hex ref (or an option-looking value) must be rejected before it
  // ever reaches `git show`, so it can never be read as a git option or path.
  it("rejects a non-hex ref instead of running git", async () => {
    for (const bad of ["HEAD", "--oneline", "-p", "main; rm -rf /"]) {
      const res = await POST(
        makeRequest({ action: "show_commit", workspacePath: repo, commitHash: bad }),
      );
      const json = await res.json();
      expect(json.data.content).toBe("");
      expect(json.data.error).toMatch(/valid commitHash required/);
    }
  });
});
