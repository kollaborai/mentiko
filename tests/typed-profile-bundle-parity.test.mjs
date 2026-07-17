import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const web = join(root, "web");
const pairs = [
  ["direct-run-cli.ts", "runner-v2-direct-run.js"],
  ["existing-run-launch-cli.ts", "runner-v2-existing-run.js"],
  ["launch-agent-cli.ts", "runner-v2-launch-agent.js"],
];
const temp = mkdtempSync(join(tmpdir(), "mentiko-typed-profile-bundle-"));

try {
  for (const [source, bundle] of pairs) {
    const output = join(temp, bundle);
    execFileSync(
      "npx",
      ["esbuild", join("lib", "runner-v2", source), "--bundle", "--platform=node", "--target=node20", `--outfile=${output}`],
      { cwd: web, stdio: "pipe" },
    );
    assert.equal(readFileSync(output, "utf8"), readFileSync(join(root, "lib", bundle), "utf8"), `${bundle} is stale`);
  }
  console.log(`typed profile bundle parity: ${pairs.length}/${pairs.length}`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
