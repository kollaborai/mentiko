/**
 * sqlcipher-migrate: one-shot plain → encrypted auth.db migration.
 *
 * Idempotent: if auth.db is already encrypted, exits 0.
 * Only runs when AUTH_DB_ENCRYPT=1 is set.
 *
 * Key derived from resolveAppSecret("vault") (same as auth-server.ts).
 */

import { existsSync, closeSync, copyFileSync, openSync, readSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { resolveAppSecret } from "../secrets/dev-secret";

function getDbPath(): string {
  const url = process.env.DATABASE_URL || `file:${process.env.MENTIKO_GLOBAL_ROOT || join(homedir(), ".mentiko")}/data/auth.db`;
  return url.replace(/^file:/, "").split("?")[0].replace(/^~\//, join(homedir(), "/"));
}

function isEncrypted(dbPath: string): boolean {
  // SQLCipher databases start with a random salt — the SQLite header
  // magic "SQLite format 3\000" will NOT be present.
  const fd = openSync(dbPath, "r");
  const buf = Buffer.alloc(16);
  try {
    readSync(fd, buf, 0, buf.length, 0);
  } finally {
    closeSync(fd);
  }
  return !buf.toString("utf8", 0, 6).startsWith("SQLite");
}

export async function migrateToSqlCipher(): Promise<void> {
  if (process.env.AUTH_DB_ENCRYPT !== "1") {
    console.log("[sqlcipher-migrate] AUTH_DB_ENCRYPT not set, skipping");
    return;
  }

  const dbPath = getDbPath();
  if (!existsSync(dbPath)) {
    console.log("[sqlcipher-migrate] no auth.db found, will be created encrypted on first run");
    return;
  }

  if (isEncrypted(dbPath)) {
    console.log("[sqlcipher-migrate] auth.db already encrypted, nothing to do");
    return;
  }

  const vaultKey = resolveAppSecret("vault");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3-multiple-ciphers");

  const backupPath = dbPath + ".plain-backup";
  const stagingPath = dbPath + ".encrypted";

  console.log("[sqlcipher-migrate] migrating plain auth.db → encrypted...");
  console.log(`[sqlcipher-migrate] source: ${dbPath}`);

  // Backup the plain DB
  copyFileSync(dbPath, backupPath);
  console.log(`[sqlcipher-migrate] backup: ${backupPath}`);

  // Open plain DB, dump everything
  const plainDb = new Database(dbPath, { readonly: true });
  const tables = plainDb.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
  const schemaRows = plainDb.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all() as { sql: string }[];
  plainDb.close();

  // Create new encrypted DB at staging path
  const encDb = new Database(stagingPath);
  encDb.pragma("cipher='sqlcipher'");
  encDb.pragma("legacy=4");
  encDb.exec(`PRAGMA key = '${vaultKey.replace(/'/g, "''")}'`);
  encDb.pragma("journal_mode = WAL");
  encDb.pragma("foreign_keys = OFF");

  // Recreate schema
  for (const row of schemaRows) {
    encDb.exec(row.sql);
  }

  // Copy data table by table
  const plainForCopy = new Database(dbPath, { readonly: true });
  for (const { name } of tables) {
    if (name.startsWith("sqlite_")) continue;
    const rows = plainForCopy.prepare(`SELECT * FROM "${name}"`).all();
    if (rows.length === 0) continue;
    const cols = Object.keys(rows[0]);
    const placeholders = cols.map(() => "?").join(", ");
    const insert = encDb.prepare(`INSERT INTO "${name}" (${cols.map(c => `"${c}"`).join(", ")}) VALUES (${placeholders})`);
    const insertMany = encDb.transaction((rs: Record<string, unknown>[]) => {
      for (const r of rs) insert.run(...cols.map(c => r[c]));
    });
    insertMany(rows);
    console.log(`[sqlcipher-migrate]   ${name}: ${rows.length} rows`);
  }
  plainForCopy.close();
  encDb.close();

  // Swap: replace plain with encrypted
  unlinkSync(dbPath);
  // Remove WAL/SHM from old plain DB if they exist
  for (const ext of ["-wal", "-shm"]) {
    const p = dbPath + ext;
    if (existsSync(p)) unlinkSync(p);
  }
  copyFileSync(stagingPath, dbPath);
  unlinkSync(stagingPath);

  console.log("[sqlcipher-migrate] migration complete");
  console.log(`[sqlcipher-migrate] plain backup kept at: ${backupPath}`);
  console.log("[sqlcipher-migrate] verify login works, then delete backup manually");
}

// CLI entry point
if (require.main === module) {
  migrateToSqlCipher().then(
    () => process.exit(0),
    (err) => {
      console.error("[sqlcipher-migrate] FAILED:", err);
      process.exit(1);
    },
  );
}
