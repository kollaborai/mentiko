/** @jest-environment node */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveResumeChainPath } from "./resume-chain-path";

describe("resolveResumeChainPath", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "resume-chain-path-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("resolves a record without chainId through its own run-dir snapshot", () => {
    const runDir = join(root, "run-thin-child");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "chain.json"), "{}");

    expect(resolveResumeChainPath({ runDir, chainId: undefined, chainsDir: join(root, "chains") }))
      .toBe(join(runDir, "chain.json"));
  });

  it("falls back to the chains-dir copy when the run dir has no snapshot", () => {
    const runDir = join(root, "run-no-snapshot");
    mkdirSync(runDir, { recursive: true });
    const chainsDir = join(root, "chains", "release-review");
    mkdirSync(chainsDir, { recursive: true });
    writeFileSync(join(chainsDir, "chain.json"), "{}");

    expect(resolveResumeChainPath({ runDir, chainId: "release-review", chainsDir: join(root, "chains") }))
      .toBe(join(chainsDir, "chain.json"));
  });

  it("returns null, never throws, when chainId is missing and no snapshot exists", () => {
    const runDir = join(root, "run-empty");
    mkdirSync(runDir, { recursive: true });

    expect(resolveResumeChainPath({ runDir, chainId: undefined, chainsDir: join(root, "chains") }))
      .toBeNull();
  });

  it("prefers the run's own snapshot over the chains-dir copy", () => {
    const runDir = join(root, "run-both");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "chain.json"), "{}");
    const chainsDir = join(root, "chains", "release-review");
    mkdirSync(chainsDir, { recursive: true });
    writeFileSync(join(chainsDir, "chain.json"), "{}");

    expect(resolveResumeChainPath({ runDir, chainId: "release-review", chainsDir: join(root, "chains") }))
      .toBe(join(runDir, "chain.json"));
  });
});
