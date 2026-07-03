#!/usr/bin/env node
/**
 * clean-test-users.mjs — stopgap cleanup for e2e test pollution.
 *
 * Problem: the Playwright e2e suite signs up real users into the SHARED dev
 * auth DB (~/.mentiko/data/auth.db) when it piggybacks on the running dev
 * server (E2E_REUSE_DEV=1). They accumulate. This script removes them.
 *
 * The PROPER fix is DB isolation: run e2e against a throwaway
 * MENTIKO_GLOBAL_ROOT (see web/playwright.config.ts — default spins an
 * isolated server on :3100). This script is the safety net for the reuse mode
 * and for cleaning up already-accumulated users.
 *
 * Usage:
 *   node scripts/clean-test-users.mjs            # dry-run (prints only)
 *   node scripts/clean-test-users.mjs --apply    # actually delete
 *
 * Matches: email LIKE '%@test.local' OR name LIKE '%Smoke' OR email LIKE '%@example.com'
 * Keeps:   almazan@gmail.com (and any non-matching user).
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const Database = require("/Users/malmazan/dev/platform/mentiko/web/node_modules/better-sqlite3");
import { join } from "path";
import { homedir } from "os";

const APPLY = process.argv.includes("--apply");
const globalRoot = process.env.MENTIKO_GLOBAL_ROOT || join(homedir(), ".mentiko");
const dbPath = join(globalRoot, "data", "auth.db");

const MATCH_SQL = `
  "email" LIKE '%@test.local'
  OR "name" LIKE '%Smoke'
  OR "email" LIKE '%@example.com'
`;

const db = new Database(dbPath, { readonly: !APPLY, fileMustExist: true });
db.pragma("foreign_keys = ON");

const testUsers = db.prepare(`SELECT id, email, name FROM "user" WHERE ${MATCH_SQL}`).all();
console.log(`[clean-test-users] db: ${dbPath  } (mode: ${APPLY ? "APPLY" : "dry-run"})`);
console.log(`[clean-test-users] matched ${testUsers.length} test user(s):`);
for (const u of testUsers) console.log(`   - ${u.email}  (${u.name})`);

if (!APPLY) {
  console.log(`[clean-test-users] dry-run only. Re-run with --apply to delete.`);
  db.close();
  process.exit(0);
}

if (testUsers.length === 0) { db.close(); process.exit(0); }

const ids = testUsers.map((u) => u.id);
// Collect every table that references users via a userId/user_id column, so we
// delete dependents (sessions, accounts, verifications, …) before the user row.
const dependentTables = db
  .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name != 'user'`)
  .all()
  .map((r) => r.name)
  .filter((t) => {
    const cols = db.prepare(`PRAGMA table_info("${t}")`).all();
    return cols.some((c) => c.name === "userId" || c.name === "user_id");
  });

const txn = db.transaction(() => {
  for (const t of dependentTables) {
    const col = db.prepare(`PRAGMA table_info("${t}")`).all().some((c) => c.name === "userId") ? "userId" : "user_id";
    const placeholders = ids.map(() => "?").join(",");
    const r = db.prepare(`DELETE FROM "${t}" WHERE "${col}" IN (${placeholders})`).run(...ids);
    if (r.changes) console.log(`   • ${t}: removed ${r.changes} row(s)`);
  }
  const placeholders = ids.map(() => "?").join(",");
  const r = db.prepare(`DELETE FROM "user" WHERE id IN (${placeholders})`).run(...ids);
  console.log(`[clean-test-users] deleted ${r.changes} user(s).`);
});
txn();
db.close();
console.log("[clean-test-users] done.");
