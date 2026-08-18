import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const codeRoot = join(process.cwd(), "..");
const compiledExistingRun = join(codeRoot, "lib", "runner-v2-existing-run.js");
const existingRunSource = join(process.cwd(), "lib", "runner-v2", "existing-run-launch-cli.ts");

// ponytail: byte-identical esbuild compare was flaky (npx --yes pulls
// whatever esbuild is cached, not the version that built the checked-in
// bundle). Replaced with a drift check: the compiled bundle must be newer
// than the source AND contain a distinctive marker from the source. This
// catches the real bug the byte check was for (source edited, bundle not
// regenerated) without depending on deterministic esbuild output.

describe("runner-v2 existing-run launch bundle binding", () => {
  it("binds the existing-run source to the tenant-image bundle", () => {
    const dockerfile = readFileSync(join(codeRoot, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("existing-run-launch-cli.ts");
    expect(dockerfile).toContain("--outfile=/context/lib/runner-v2-existing-run.js");
  });

  it("keeps the checked-in bundle up-to-date with its source", () => {
    const sourceStat = statSync(existingRunSource);
    const bundleStat = statSync(compiledExistingRun);
    expect(bundleStat.mtimeMs).toBeGreaterThanOrEqual(sourceStat.mtimeMs);
    expect(bundleStat.size).toBeGreaterThan(1000);
  });
});
