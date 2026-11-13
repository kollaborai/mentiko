import { readFileSync } from "node:fs";
import { join } from "node:path";

const codeRoot = join(process.cwd(), "..");
const compiledExistingRun = join(codeRoot, "lib", "runner-v2-existing-run.js");
const existingRunSource = join(process.cwd(), "lib", "runner-v2", "existing-run-launch-cli.ts");
const existingRunLaunchSource = join(process.cwd(), "lib", "runner-v2", "existing-run-launch.ts");

describe("runner-v2 existing-run launch bundle binding", () => {
  it("binds the existing-run source to the tenant-image bundle", () => {
    const dockerfile = readFileSync(join(codeRoot, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("existing-run-launch-cli.ts");
    expect(dockerfile).toContain("--outfile=/context/lib/runner-v2-existing-run.js");
  });

  // Git checkout mtimes describe extraction order, not build order. Check the
  // current single-flight launch behavior in both source and emitted bundle.
  it("includes the current single-flight launch contract in the checked-in bundle", () => {
    const source = readFileSync(existingRunLaunchSource, "utf8");
    const bundle = readFileSync(compiledExistingRun, "utf8");
    const contract = "already has an in-progress launch";
    expect(source).toContain(contract);
    expect(bundle).toContain(contract);
    expect(bundle.length).toBeGreaterThan(1000);
  });
});
