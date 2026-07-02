/**
 * REAL handler tests for POST /api/git stash actions.
 *
 * Spins up a throwaway git repo in os.tmpdir(), mocks auth + path-validation so
 * the handler accepts it, and asserts on the actual returned data.
 *
 * Coverage focus (regression 2): `apply_stash` / `drop_stash` by `stashCommit`
 * (SHA) must still resolve the right stash after the positional list shifts.
 * The fix added `resolveStashRef` keyed on commitHash; this test creates two
 * stashes, drops stash@{0}, then applies the survivor by its SHA and checks the
 * real working-tree contents match that stash (not the dropped one).
 *
 * @jest-environment node
 */
import { execSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
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

const README = "README.md";

function read(cwd: string): string {
  return readFileSync(join(cwd, README), "utf-8");
}

describe("POST /api/git — stash actions (real git repo)", () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "git-stash-test-"));
    git(["init", "-q"], repo);
    git(["config", "user.email", "test@example.com"], repo);
    git(["config", "user.name", "Test"], repo);
    writeFileSync(join(repo, README), "base\n");
    git(["add", "-A"], repo);
    git(["commit", "-q", "-m", "init"], repo);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("create_stash then apply_stash by stashId restores the changes", async () => {
    writeFileSync(join(repo, README), "base\nA\n");
    const create = await POST(
      makeRequest({ action: "create_stash", workspacePath: repo, stashMessage: "stash-A" }),
    );
    const createJson = await create.json();
    expect(createJson.data.ok).toBe(true);
    expect(read(repo)).toBe("base\n"); // stashing reverts the working tree

    const apply = await POST(
      makeRequest({
        action: "apply_stash",
        workspacePath: repo,
        stashId: createJson.data.stashId,
      }),
    );
    expect((await apply.json()).data.ok).toBe(true);
    expect(read(repo)).toBe("base\nA\n");
  });

  // ── REGRESSION 2 ──────────────────────────────────────────────────────────
  // apply_stash / drop_stash by `stashCommit` (SHA) must resolve the right
  // stash after the positional list shifts. Before the fix there was no
  // SHA-keyed lookup; an index captured before a drop would point at the wrong
  // stash (or nothing) afterwards. Here we drop stash@{0} and then apply the
  // survivor by its SHA, asserting the survivor's actual content is restored.
  it("apply_stash by stashCommit resolves the survivor after a positional shift", async () => {
    // stash B (will become stash@{0})
    writeFileSync(join(repo, README), "base\nB\n");
    await POST(
      makeRequest({ action: "create_stash", workspacePath: repo, stashMessage: "stash-B" }),
    );
    // stash A (will become stash@{1})
    writeFileSync(join(repo, README), "base\nA\n");
    await POST(
      makeRequest({ action: "create_stash", workspacePath: repo, stashMessage: "stash-A" }),
    );

    // list: stash@{0} = A (newest), stash@{1} = B
    const list = await POST(
      makeRequest({ action: "list_stashes", workspacePath: repo }),
    );
    const stashes = (await list.json()).data.stashes as Array<{
      id: string;
      message: string;
      commitHash?: string;
    }>;
    expect(stashes).toHaveLength(2);
    const survivor = stashes.find((s) => s.message.includes("stash-B"))!;
    expect(survivor).toBeTruthy();
    const survivorSha = survivor.commitHash;
    expect(survivorSha).toBeTruthy();

    // drop the newest (stash@{0} = A) — survivor B now shifts up to stash@{0}
    const dropRes = await POST(
      makeRequest({
        action: "drop_stash",
        workspacePath: repo,
        stashId: stashes[0].id, // drop A by positional id
      }),
    );
    expect((await dropRes.json()).data.ok).toBe(true);

    // apply the survivor BY SHA (not by its old positional id, which now points
    // at nothing). The fix's resolveStashRef re-lists and matches commitHash.
    expect(read(repo)).toBe("base\n");
    const apply = await POST(
      makeRequest({
        action: "apply_stash",
        workspacePath: repo,
        stashCommit: survivorSha,
      }),
    );
    const applyJson = await apply.json();
    expect(applyJson.data.ok).toBe(true);
    // real proof: B's content (not A's) was restored.
    expect(read(repo)).toBe("base\nB\n");
  });

  // drop_stash by SHA must resolve the right stash after a shift too.
  it("drop_stash by stashCommit removes the matching stash, not a positional victim", async () => {
    writeFileSync(join(repo, README), "base\nB\n");
    await POST(
      makeRequest({ action: "create_stash", workspacePath: repo, stashMessage: "stash-B" }),
    );
    writeFileSync(join(repo, README), "base\nA\n");
    await POST(
      makeRequest({ action: "create_stash", workspacePath: repo, stashMessage: "stash-A" }),
    );

    const list = await POST(
      makeRequest({ action: "list_stashes", workspacePath: repo }),
    );
    const stashes = (await list.json()).data.stashes as Array<{
      id: string;
      message: string;
      commitHash?: string;
    }>;
    const target = stashes.find((s) => s.message.includes("stash-B"))!;
    const targetSha = target.commitHash!;
    const otherSha = stashes.find((s) => s.message.includes("stash-A"))!.commitHash!;

    // drop B by SHA. A must remain (verify by its SHA still being listed).
    const drop = await POST(
      makeRequest({ action: "drop_stash", workspacePath: repo, stashCommit: targetSha }),
    );
    expect((await drop.json()).data.ok).toBe(true);

    const after = await POST(
      makeRequest({ action: "list_stashes", workspacePath: repo }),
    );
    const remaining = ((await after.json()).data.stashes as Array<{
      message: string;
      commitHash?: string;
    }>).map((s) => s.commitHash);
    expect(remaining).not.toContain(targetSha);
    expect(remaining).toContain(otherSha);
  });
});
