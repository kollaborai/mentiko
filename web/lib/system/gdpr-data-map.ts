/**
 * GDPR data map — exhaustive inventory of where user data lives.
 *
 * Used by /api/gdpr/export (Art 15 access, Art 20 portability)
 * and /api/gdpr/delete (Art 17 erasure via crypto-shred).
 *
 * Each surface describes where the data is, how to enumerate it
 * for a given user, how to remove it, and whether it could be
 * encrypted under a per-user DEK in the future.
 */

export interface DataSurface {
  location: string;
  howToList: string;
  howToDelete: string;
  encryptedUnderDek: boolean;
}

export const USER_DATA_SURFACES: DataSurface[] = [
  {
    location: "auth.db → user table",
    howToList: `SELECT * FROM "user" WHERE id = ?`,
    howToDelete: `DELETE FROM "user" WHERE id = ? (tombstone first)`,
    encryptedUnderDek: false,
  },
  {
    location: "auth.db → session table",
    howToList: `SELECT * FROM session WHERE "userId" = ?`,
    howToDelete: `DELETE FROM session WHERE "userId" = ?`,
    encryptedUnderDek: false,
  },
  {
    location: "auth.db → account table (OAuth links)",
    howToList: `SELECT * FROM account WHERE "userId" = ?`,
    howToDelete: `DELETE FROM account WHERE "userId" = ?`,
    encryptedUnderDek: false,
  },
  {
    location: "auth.db → verification table",
    howToList: `SELECT * FROM verification WHERE "userId" = ?`,
    howToDelete: `DELETE FROM verification WHERE "userId" = ?`,
    encryptedUnderDek: false,
  },
  {
    location: "auth.db → member table (org memberships)",
    howToList: `SELECT * FROM member WHERE "userId" = ?`,
    howToDelete: `DELETE FROM member WHERE "userId" = ?`,
    encryptedUnderDek: false,
  },
  {
    location: "tasks.db → tasks (createdBy column)",
    howToList: `SELECT * FROM tasks WHERE "createdBy" = ?`,
    howToDelete: `DELETE FROM tasks WHERE "createdBy" = ?`,
    encryptedUnderDek: true,
  },
  {
    location: "tasks.db → task_comments (author column)",
    howToList: `SELECT * FROM task_comments WHERE author = ?`,
    howToDelete: `DELETE FROM task_comments WHERE author = ?`,
    encryptedUnderDek: true,
  },
  {
    location: "filesystem → chains/ (chain.json with created_by)",
    howToList: `find chains/ -name chain.json | xargs grep -l '"created_by":"USER_ID"'`,
    howToDelete: `rm -rf chains/{chain-id}/ for each match`,
    encryptedUnderDek: true,
  },
  {
    location: "filesystem → runs/ (run.json with user_id)",
    howToList: `find runs/ -name run.json | xargs grep -l '"user_id":"USER_ID"'`,
    howToDelete: `rm -rf runs/{run-id}/ for each match`,
    encryptedUnderDek: true,
  },
  {
    location: "filesystem → conversations/ (agent session logs)",
    howToList: `find conversations/ -name "*.jsonl" | xargs grep -l '"user_id":"USER_ID"'`,
    howToDelete: `rm -rf conversations/{session-id}/ for each match`,
    encryptedUnderDek: true,
  },
  {
    location: "filesystem → decisions/ (decision JSON files)",
    howToList: `find decisions/ -name "*.json" | xargs grep -l '"userId":"USER_ID"'`,
    howToDelete: `rm decisions/{decision-id}.json for each match`,
    encryptedUnderDek: false,
  },
  {
    location: "filesystem → notifications/ (per-user notification files)",
    howToList: `find notifications/ -name "*.json" | xargs grep -l '"userId":"USER_ID"'`,
    howToDelete: `rm notifications/{notification-id}.json for each match`,
    encryptedUnderDek: false,
  },
];
