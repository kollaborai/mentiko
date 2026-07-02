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
 * NOTE on the store's ID scheme: review IDs use a GLOBAL counter (the `rev-`
 * prefix space is shared across orgs), so two orgs in one namespace never
 * collide on the global `reviews.id` primary key. Assignments (`asn-`) and
 * comments (`cmt-`) are global too.
 *
 * @jest-environment node
 */
import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "fs";
import Database from "better-sqlite3";

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

  // ── GLOBAL ID COUNTER (regression for multi-org PK collision) ────────────
  // reviews.id is a GLOBAL primary key. Two orgs in one namespace creating their
  // first review must both succeed with distinct IDs — previously the per-org
  // counter restarted at rev-000001 in each org and threw UNIQUE constraint failed.
  test("createReview across two orgs yields distinct, non-colliding IDs", () => {
    const a = store.createReview("org-a", { title: "A", source_branch: "f", target_branch: "main" }, "u");
    const b = store.createReview("org-b", { title: "B", source_branch: "f", target_branch: "main" }, "u");
    expect(a.id).toMatch(/^rev-\d{6}$/);
    expect(b.id).toMatch(/^rev-\d{6}$/);
    expect(a.id).not.toBe(b.id);
    // Both are retrievable within their own org scope.
    expect(store.getReview(a.id, "org-a")?.id).toBe(a.id);
    expect(store.getReview(b.id, "org-b")?.id).toBe(b.id);
  });

  // ── MIGRATION BACKFILL (v1 → v2) ────────────────────────────────────────
  // Simulate a legacy DB that stopped at migration v1 with per-org review IDs
  // already on disk (org-a reached rev-000003). On upgrade, the global counter
  // must be seeded above 3 so the first new review is rev-000004 — not
  // rev-000001, which would collide with nothing here but proves the seed works.
  test("v2 migration seeds global rev counter above legacy per-org IDs", () => {
    const legacyRoot = mkdtempSync(join(tmpdir(), "mentiko-review-legacy-"));
    const savedLegacy = process.env.MENTIKO_GLOBAL_ROOT;
    process.env.MENTIKO_GLOBAL_ROOT = legacyRoot;
    const dbPath = join(legacyRoot, "namespaces", "default", "data", "reviews.db");
    mkdirSync(join(legacyRoot, "namespaces", "default", "data"), { recursive: true });
    const seed = new Database(dbPath);
    seed.pragma("journal_mode = WAL");
    seed.exec(`
      CREATE TABLE _migrations (version INTEGER PRIMARY KEY);
      CREATE TABLE id_counters (org_id TEXT NOT NULL, prefix TEXT NOT NULL, next_val INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (org_id, prefix));
      CREATE TABLE reviews (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, workspace_id TEXT, title TEXT NOT NULL, description TEXT DEFAULT '', source_branch TEXT NOT NULL, target_branch TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', priority TEXT NOT NULL DEFAULT 'medium', created_by TEXT NOT NULL, created_at TEXT NOT NULL, due_date TEXT, labels TEXT DEFAULT '[]', checklist TEXT DEFAULT '[]', updated_at TEXT NOT NULL, closed_at TEXT);
      CREATE TABLE review_assignments (id TEXT PRIMARY KEY, review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE, reviewer_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', assigned_at TEXT NOT NULL, completed_at TEXT);
      CREATE TABLE review_comments (id TEXT PRIMARY KEY, review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE, file_path TEXT NOT NULL, line_number INTEGER, commenter_id TEXT NOT NULL, comment TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, resolved BOOLEAN NOT NULL DEFAULT 0, resolved_at TEXT, resolved_by TEXT);
    `);
    seed.prepare("INSERT INTO _migrations (version) VALUES (1)").run();
    seed.prepare("INSERT INTO id_counters (org_id,prefix,next_val) VALUES ('org-a','rev',3)").run();
    seed.prepare("INSERT INTO reviews (id,org_id,title,source_branch,target_branch,created_by,created_at,updated_at) VALUES ('rev-000003','org-a','legacy','f','main','u','t','t')").run();
    seed.close();

    // Load the store against the legacy root — it opens the existing file,
    // runs migration v2, then the first create must be rev-000004.
    let legacyStore: ReviewStore;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      legacyStore = require("../reviews/review-store");
    });
    const r = legacyStore!.createReview("org-b", { title: "after-upgrade", source_branch: "f", target_branch: "main" }, "u");
    expect(r.id).toBe("rev-000004");
    // Legacy row survives the upgrade and stays org-scoped.
    expect(legacyStore!.getReview("rev-000003", "org-a")?.id).toBe("rev-000003");
    legacyStore!.closeAll();

    if (savedLegacy === undefined) delete process.env.MENTIKO_GLOBAL_ROOT;
    else process.env.MENTIKO_GLOBAL_ROOT = savedLegacy;
    rmSync(legacyRoot, { recursive: true, force: true });
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
