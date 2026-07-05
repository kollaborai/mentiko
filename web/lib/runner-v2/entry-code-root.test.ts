import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { anchorCodeRootEnv, findCodeRootFrom } from "@/lib/runner-v2/entry-code-root";

describe("runner-v2 entry code root anchor", () => {
  let root: string;
  const previousEnv = process.env.MENTIKO_CODE_ROOT;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "mentiko-code-root-"));
    mkdirSync(join(root, "lib"), { recursive: true });
    writeFileSync(join(root, "lib", "chain-runner.sh"), "#!/bin/bash\n");
    delete process.env.MENTIKO_CODE_ROOT;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    if (previousEnv === undefined) delete process.env.MENTIKO_CODE_ROOT;
    else process.env.MENTIKO_CODE_ROOT = previousEnv;
  });

  it("finds the code root from nested entry locations", () => {
    const bundled = join(root, "lib");
    const devScripts = join(root, "web", "scripts");
    const devModule = join(root, "web", "lib", "runner-v2");
    mkdirSync(devModule, { recursive: true });
    mkdirSync(devScripts, { recursive: true });

    expect(findCodeRootFrom(bundled)).toBe(root);
    expect(findCodeRootFrom(devScripts)).toBe(root);
    expect(findCodeRootFrom(devModule)).toBe(root);
  });

  it("returns null when no code root exists within the hop bound", () => {
    const stray = mkdtempSync(join(tmpdir(), "mentiko-stray-"));
    try {
      expect(findCodeRootFrom(stray, 0)).toBeNull();
    } finally {
      rmSync(stray, { recursive: true, force: true });
    }
  });

  it("anchors MENTIKO_CODE_ROOT for the process when unset", () => {
    const anchored = anchorCodeRootEnv(join(root, "web", "scripts"));
    expect(anchored).toBe(root);
    expect(process.env.MENTIKO_CODE_ROOT).toBe(root);
  });

  it("respects an explicitly configured MENTIKO_CODE_ROOT", () => {
    process.env.MENTIKO_CODE_ROOT = "/opt/mentiko";
    expect(anchorCodeRootEnv(join(root, "lib"))).toBe("/opt/mentiko");
    expect(process.env.MENTIKO_CODE_ROOT).toBe("/opt/mentiko");
  });
});
