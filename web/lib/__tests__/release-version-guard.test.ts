import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";

const repoRoot = join(__dirname, "../../..");

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function latestStableTag(): string {
  return execFileSync(
    "git",
    ["tag", "--list", "v[0-9]*.[0-9]*.[0-9]*", "--sort=-v:refname"],
    { cwd: repoRoot, encoding: "utf8" },
  )
    .split("\n")
    .map((tag) => tag.trim())
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))[0];
}

describe("release version guard", () => {
  it("keeps package and release metadata aligned to the latest public tag", () => {
    const packageJson = JSON.parse(readRepoFile("web/package.json")) as {
      version: string;
    };
    const releasesSource = readRepoFile("web/lib/releases.ts");
    const latestTag = latestStableTag();

    expect(`v${packageJson.version}`).toBe(latestTag);
    expect(releasesSource).toContain(`version: "${latestTag}"`);
    expect(releasesSource.indexOf(`version: "${latestTag}"`)).toBeLessThan(
      releasesSource.indexOf('version: "v0.3.9"'),
    );
  });

  it("runs the strict semver patch guard before public image builds", () => {
    const workflow = readRepoFile(".github/workflows/build-platform.yml");

    expect(workflow).toContain("validate-release-version");
    expect(workflow).toContain("node scripts/validate-platform-release-version.mjs");
    expect(workflow).toContain("fetch-depth: 0");
  });
});
