/**
 * Review store tests — runs against a THROWAWAY sqlite DB, never the live
 * ~/.mentiko/namespaces/default/data/reviews.db.
 *
 * Isolation: the store derives its DB path from `config.globalRoot`
 * (env MENTIKO_GLOBAL_ROOT) and caches the connection in a module-level Map.
 * So per test we (1) point MENTIKO_GLOBAL_ROOT at a fresh temp dir and (2) load
 * the store via `jest.isolateModules` so `config` and the connection Map
 * re-evaluate against that temp root. The live DB is never touched.
 *
 * NOTE on the store's ID scheme: `id_counters` is keyed on (org_id, prefix), so
 * each org restarts at rev-000001, but `reviews.id` is a GLOBAL primary key —
 * two creates across different orgs collide. So each test creates in at most
 * ONE org and only *reads* a second org for scoping assertions.
 *
 * @jest-environment node
 */
import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync, rmSync, existsSync } from "fs";

type ReviewStore = typeof import("../reviews/review-store");
let store: ReviewStore;
let tmpRoot: string;
let savedRoot: string | undefined;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "mentiko-review-test-"));
  savedRoot = process.env.MENTIKO_GLOBAL_ROOT;
  process.env.MENTIKO_GLOBAL_ROOT = tmpRoot;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    store = require("../reviews/review-store");
  });
});

afterEach(() => {
  try { store?.closeAll(); } catch { /* already closed */ }
  if (savedRoot === undefined) delete process.env.MENTIKO_GLOBAL_ROOT;
  else process.env.MENTIKO_GLOBAL_ROOT = savedRoot;
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("Review Store (isolated temp DB)", () => {
  test("create + get a review by ID", () => {
    const created = store.createReview(
      "org-a",
      { title: "Test Review", description: "desc", source_branch: "feature/test", target_branch: "main" },
      "test-user",
      "/workspace",
    );
    expect(created.id).toMatch(/^rev-\d{6}$/);
    expect(created.title).toBe("Test Review");
    expect(created.status).toBe("pending");
    expect(created.org_id).toBe("org-a");

    const found = store.getReview(created.id, "org-a");
    expect(found?.id).toBe(created.id);
    expect(found?.title).toBe("Test Review");
  });

  test("getReview returns null for a non-existent review", () => {
    expect(store.getReview("rev-nonexistent", "org-a")).toBeNull();
  });

  test("listReviews scoped to an org returns only that org's reviews", () => {
    store.createReview("org-a", { title: "A1", source_branch: "f/1", target_branch: "main" }, "u");
    store.createReview("org-a", { title: "A2", source_branch: "f/2", target_branch: "main" }, "u");

    const inA = store.listReviews({ org_id: "org-a" });
    expect(inA).toHaveLength(2);
    expect(inA.every((r) => r.org_id === "org-a")).toBe(true);

    // a different org sees nothing
    expect(store.listReviews({ org_id: "org-b" })).toHaveLength(0);
  });

  // ── ORG-SCOPING CONTRACT ─────────────────────────────────────────────────
  // createReview in org A is NOT visible to listReviews({ org_id: B }).
  test("createReview in org A is invisible to listReviews in org B", () => {
    const review = store.createReview(
      "org-a",
      { title: "secret", source_branch: "f", target_branch: "main" },
      "u",
    );
    expect(store.listReviews({ org_id: "org-a" }).some((r) => r.id === review.id)).toBe(true);
    expect(store.listReviews({ org_id: "org-b" }).some((r) => r.id === review.id)).toBe(false);
  });

  test("update a review (title + status) and set closed_at on completion", () => {
    const review = store.createReview(
      "org-a", { title: "Original", source_branch: "f", target_branch: "main" }, "u",
    );
    const updated = store.updateReview(review.id, { title: "Updated", status: "in_progress" }, "org-a");
    expect(updated?.title).toBe("Updated");
    expect(updated?.status).toBe("in_progress");
    expect(updated?.closed_at).toBeNull();

    const completed = store.updateReview(review.id, { status: "completed" }, "org-a");
    expect(completed?.status).toBe("completed");
    expect(completed?.closed_at).not.toBeNull();
  });

  test("delete a review", () => {
    const review = store.createReview(
      "org-a", { title: "ToDelete", source_branch: "f", target_branch: "main" }, "u",
    );
    expect(store.deleteReview(review.id, "org-a")).toBe(true);
    expect(store.getReview(review.id, "org-a")).toBeNull();
  });

  test("status filter within an org", () => {
    const r1 = store.createReview("org-a", { title: "p", source_branch: "f", target_branch: "main" }, "u");
    const r2 = store.createReview("org-a", { title: "c", source_branch: "f", target_branch: "main" }, "u");
    store.updateReview(r2.id, { status: "completed" }, "org-a");

    const pending = store.listReviews({ org_id: "org-a", status: "pending" });
    const completed = store.listReviews({ org_id: "org-a", status: "completed" });
    expect(pending.some((r) => r.id === r1.id)).toBe(true);
    expect(pending.some((r) => r.id === r2.id)).toBe(false);
    expect(completed.some((r) => r.id === r2.id)).toBe(true);
  });

  test("create + list assignments for reviewers", () => {
    const review = store.createReview(
      "org-a",
      { title: "R", source_branch: "f", target_branch: "main", reviewers: ["u1", "u2"] },
      "creator",
    );
    const assignments = store.listAssignments(review.id);
    expect(assignments).toHaveLength(2);
    expect(assignments.every((a) => a.status === "pending")).toBe(true);
  });

  test("update assignment status stamps completed_at on terminal status", () => {
    const review = store.createReview(
      "org-a",
      { title: "R", source_branch: "f", target_branch: "main", reviewers: ["u1"] },
      "creator",
    );
    const a = store.listAssignments(review.id)[0];
    // the store treats approved / changes_requested as terminal (stamps
    // completed_at); "completed" is NOT in that set, so use a real terminal one.
    const updated = store.updateAssignmentStatus(a.id, "approved");
    expect(updated?.status).toBe("approved");
    expect(updated?.completed_at).not.toBeNull();
  });

  test("delete an assignment", () => {
    const review = store.createReview(
      "org-a",
      { title: "R", source_branch: "f", target_branch: "main", reviewers: ["u1"] },
      "creator",
    );
    const a = store.listAssignments(review.id)[0];
    expect(store.deleteAssignment(a.id)).toBe(true);
    expect(store.listAssignments(review.id)).toHaveLength(0);
  });

  test("create + list + resolve + delete a comment", () => {
    const review = store.createReview(
      "org-a", { title: "R", source_branch: "f", target_branch: "main" }, "creator",
    );
    const c = store.createComment(review.id, "src/file.ts", 42, "rev1", "looks wrong");
    expect(c.review_id).toBe(review.id);
    expect(c.resolved).toBe(false);

    store.createComment(review.id, "src/file.ts", 50, "rev2", "another");
    expect(store.listComments(review.id)).toHaveLength(2);

    const resolved = store.resolveComment(c.id, "author1");
    expect(resolved?.resolved).toBe(true);
    expect(resolved?.resolved_by).toBe("author1");

    expect(store.deleteComment(c.id)).toBe(true);
    expect(store.listComments(review.id)).toHaveLength(1);
  });

  test("reviewer_count, comment_count, completed_reviewer_count", () => {
    const review = store.createReview(
      "org-a",
      { title: "R", source_branch: "f", target_branch: "main", reviewers: ["u1", "u2", "u3"] },
      "creator",
    );
    store.createComment(review.id, "a", 1, "x", "c1");
    store.createComment(review.id, "b", 2, "y", "c2");

    const a = store.listAssignments(review.id)[0];
    store.updateAssignmentStatus(a.id, "approved");

    const found = store.getReview(review.id, "org-a");
    expect(found?.reviewer_count).toBe(3);
    expect(found?.comment_count).toBe(2);
    expect(found?.completed_reviewer_count).toBe(1);
  });

  // sanity: confirm the suite wrote to the temp DB, never the live reviews.db
  test("DB file lives under the temp root (os.tmpdir), never under ~/.mentiko", () => {
    // force the lazy DB open by creating a review
    store.createReview(
      "org-a", { title: "force-open", source_branch: "f", target_branch: "main" }, "u",
    );
    const dbPath = join(tmpRoot, "namespaces", "default", "data", "reviews.db");
    expect(existsSync(dbPath)).toBe(true);
    expect(tmpRoot.startsWith(tmpdir())).toBe(true);
    expect(tmpRoot).not.toContain(".mentiko");
  });
});
