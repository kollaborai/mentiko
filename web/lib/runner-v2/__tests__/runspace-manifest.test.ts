/** @jest-environment node */

import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRunspaceManifestCli } from "@/lib/runner-v2/runspace-manifest-cli";
import { ensureRunspaceManifest } from "@/lib/runner-v2/runspace-manifest";

function runsDir(): string {
  return mkdtempSync(join(tmpdir(), "mentiko-runspace-manifest-"));
}

describe("typed runspace manifest", () => {
  it("creates the exact initial manifest once and validates the existing identity", () => {
    const root = runsDir();
    const first = ensureRunspaceManifest(root, "run-1", "research");
    const second = ensureRunspaceManifest(root, "run-1", "research");

    expect(first.created).toBe(true);
    expect(second).toMatchObject({ created: false, manifest: { run_id: "run-1", chain: "research", artifacts: [] } });
    expect(JSON.parse(readFileSync(first.manifestPath, "utf8"))).toEqual({
      run_id: "run-1", chain: "research", artifacts: [],
    });
    expect(() => ensureRunspaceManifest(root, "run-1", "different-chain"))
      .toThrow("Runspace manifest identity mismatch");
  });

  it("fails closed on a malformed existing manifest or a symlinked runspace", () => {
    const root = runsDir();
    const runspace = join(root, "run-1", "runspace");
    mkdirSync(runspace, { recursive: true });
    writeFileSync(join(runspace, "manifest.json"), "not json");
    expect(() => ensureRunspaceManifest(root, "run-1", "research"))
      .toThrow("Runspace manifest is not valid JSON");

    const symlinkRoot = runsDir();
    const outside = runsDir();
    mkdirSync(join(symlinkRoot, "run-2"), { recursive: true });
    symlinkSync(outside, join(symlinkRoot, "run-2", "runspace"));
    expect(() => ensureRunspaceManifest(symlinkRoot, "run-2", "research"))
      .toThrow("Runspace directory must be a non-symbolic directory");
  });

  it("accepts only the named typed ensure operation", () => {
    const root = runsDir();
    const output: string[] = [];
    runRunspaceManifestCli([
      "ensure", "--runs-dir", root, "--run-id", "run-1", "--chain", "research",
    ], {}, (line) => output.push(line));
    expect(JSON.parse(output[0])).toMatchObject({ created: true, manifest: { run_id: "run-1" } });
    expect(() => runRunspaceManifestCli(["patch", "--runs-dir", root], {}, () => {}))
      .toThrow("usage: runner-runspace-manifest");
  });
});
