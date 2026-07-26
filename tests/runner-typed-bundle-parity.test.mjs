// Bundle parity: every committed lib/*.js runner bundle must equal a fresh esbuild
// of its web/ source. The build list and the esbuild invocation live in ONE place —
// scripts/build-runner-bundles.mjs — so this test and the rebuild script can never
// drift apart. CI runs this (see .github/workflows/engine-tests.yml); locally,
// `node scripts/build-runner-bundles.mjs` rebuilds, `--check` is this check.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { allTargets, buildBundle } from "../scripts/build-runner-bundles.mjs";

const root = new URL("..", import.meta.url).pathname;
const lib = join(root, "lib");
const temp = mkdtempSync(join(tmpdir(), "mentiko-bundle-parity-"));
try {
  for (const [stem, bundle] of allTargets()) {
    const output = join(temp, `${bundle}.js`);
    buildBundle(stem, output); // cwd = web; adds the GENERATED banner
    assert.equal(
      readFileSync(output, "utf8"),
      readFileSync(join(lib, `${bundle}.js`), "utf8"),
      `${bundle} is stale — run: node scripts/build-runner-bundles.mjs`,
    );
  }
  console.log(`bundle parity: ${allTargets().length}/${allTargets().length}`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
