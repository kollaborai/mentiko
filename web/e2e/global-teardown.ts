/**
 * e2e global-teardown — remove the throwaway data root created by global-setup.
 * Reads the path from /tmp/mentiko-e2e-root (global-setup writes it there
 * because this runs in a separate module). Also sweeps any stale
 * mentiko-e2e-* dirs in the system tmp dir left by aborted runs.
 */
import { readFileSync, existsSync, rmSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export default async function globalTeardown() {
  try {
    const marker = join(tmpdir(), "mentiko-e2e-root");
    if (existsSync(marker)) {
      const root = readFileSync(marker, "utf8").trim();
      if (root && root.startsWith(tmpdir())) rmSync(root, { recursive: true, force: true });
      rmSync(marker, { force: true });
    }
  } catch {
    /* best-effort */
  }
  // sweep stale throwaway roots from aborted runs
  try {
    for (const entry of readdirSync(tmpdir())) {
      if (entry.startsWith("mentiko-e2e-")) {
        rmSync(join(tmpdir(), entry), { recursive: true, force: true });
      }
    }
  } catch {
    /* best-effort */
  }
}
