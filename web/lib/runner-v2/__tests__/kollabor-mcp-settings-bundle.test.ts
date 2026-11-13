/** @jest-environment node */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const webRoot = resolve(__dirname, "../../..");
const codeRoot = resolve(webRoot, "..");
const source = join(webRoot, "lib", "runner-v2", "kollabor-mcp-settings-cli.ts");
const bundle = join(codeRoot, "lib", "runner-kollabor-mcp-settings.js");

describe("Kollabor MCP settings runtime bundle", () => {
  it("matches a fresh esbuild of its TypeScript source", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "runner-mcp-settings-bundle-"));
    const freshBundle = join(temporaryRoot, "runner-kollabor-mcp-settings.js");

    try {
      execFileSync("npx", [
        "esbuild",
        source,
        "--bundle",
        "--platform=node",
        "--target=node20",
        `--outfile=${freshBundle}`,
      ], { cwd: webRoot, stdio: "pipe" });

      expect(readFileSync(bundle, "utf8")).toBe(readFileSync(freshBundle, "utf8"));
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
