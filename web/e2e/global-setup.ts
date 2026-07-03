/**
 * e2e global-setup — DB isolation.
 *
 * Creates a throwaway MENTIKO_GLOBAL_ROOT for the run and exports it (plus a
 * DATABASE_URL pointed at the temp auth.db and PORT=3100) via process.env.
 * The webServer is spawned by Playwright AFTER this runs and inherits these
 * vars, so the ephemeral dev server reads/writes only the temp root. Test
 * workers inherit them too (needed by specs that read on-disk artifacts, e.g.
 * task-chain-recommendation-reload.spec.ts).
 *
 * Why DATABASE_URL must be set explicitly: Next.js loads web/.env.local (which
 * hardcodes DATABASE_URL=file:~/.mentiko/data/auth.db) and would otherwise
 * win over any MENTIKO_GLOBAL_ROOT-derived path. Next.js does NOT override
 * env already set by the parent, so setting it here forces auth into the temp
 * DB. See web/lib/auth/auth-server.ts (parseSqlitePath / getDb).
 *
 * The temp-root path is stashed to /tmp/mentiko-e2e-root for global-teardown.
 */
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export default async function globalSetup() {
  const tmpRoot =
    process.env.E2E_GLOBAL_ROOT || mkdtempSync(join(tmpdir(), "mentiko-e2e-"));
  process.env.MENTIKO_GLOBAL_ROOT = tmpRoot;
  process.env.DATABASE_URL = `file:${join(tmpRoot, "data", "auth.db")}`;
  process.env.PORT = "3100";
  // channel to global-teardown (separate module/process — can't read this env)
  writeFileSync(join(tmpdir(), "mentiko-e2e-root"), tmpRoot);
}
