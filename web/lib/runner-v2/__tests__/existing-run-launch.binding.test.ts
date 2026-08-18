import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const codeRoot = join(process.cwd(), "..");
const compiledExistingRun = join(codeRoot, "lib", "runner-v2-existing-run.js");
const existingRunSource = join(process.cwd(), "lib", "runner-v2", "existing-run-launch-cli.ts");

describe("runner-v2 existing-run launch bundle binding", () => {
  it("binds the existing-run source to the tenant-image bundle", () => {
    const dockerfile = readFileSync(join(codeRoot, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("existing-run-launch-cli.ts");
    expect(dockerfile).toContain("--outfile=/context/lib/runner-v2-existing-run.js");
  });

  it("keeps the checked-in runtime bundle byte-identical to a fresh esbuild", () => {
    const root = mkdtempSync(join(tmpdir(), "runner-v2-existing-run-bundle-"));
    const freshBundle = join(root, "runner-v2-existing-run.js");
    execFileSync("npx", [
      "--yes",
      "esbuild",
      existingRunSource,
      "--bundle",
      "--platform=node",
      "--target=node20",
      `--outfile=${freshBundle}`,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: "pipe",
    });

    expect(readFileSync(compiledExistingRun, "utf8")).toBe(readFileSync(freshBundle, "utf8"));
  });
});
