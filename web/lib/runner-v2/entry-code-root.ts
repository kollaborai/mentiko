import { existsSync } from "fs";
import { dirname, join, resolve } from "path";

/**
 * Locate the mentiko code root (the checkout/image dir holding lib/chain-runner.sh)
 * by walking up from a file that physically lives inside it.
 *
 * The completion bridge runs in a PTY session whose cwd is inside the DATA root
 * (~/.mentiko/...), so config's parent-of-cwd fallback resolves codeRoot to the
 * data tree and every typed launch path comes out wrong. Entry scripts
 * know where they live on disk regardless of cwd, so they anchor from __dirname:
 *   dev ts-node entry  codeRoot/web/scripts  -> 2 hops
 *   dev TS module      codeRoot/web/lib/runner-v2 -> 3 hops
 *   bundled bridge     codeRoot/lib          -> 1 hop
 */
export function findCodeRootFrom(startDir: string, maxHops = 8): string | null {
  let dir = resolve(startDir);
  for (let hop = 0; hop <= maxHops; hop++) {
    if (existsSync(join(dir, "lib", "chain-runner.sh"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * Set MENTIKO_CODE_ROOT for this process (and its children) unless the caller
 * already provided one. Must run BEFORE any module that imports @/lib/config,
 * because codeRoot is resolved at config import time.
 */
export function anchorCodeRootEnv(startDir: string): string | null {
  const existing = process.env.MENTIKO_CODE_ROOT?.trim();
  if (existing) return existing;
  const found = findCodeRootFrom(startDir);
  if (found) process.env.MENTIKO_CODE_ROOT = found;
  return found;
}
