import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createParallelGroup,
  recordParallelPid,
  recordParallelResult,
  validateParallelGroup,
} from "@/lib/runner-v2/parallel-contract";

describe("typed parallel group contract", () => {
  let root: string;

  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "mentiko-parallel-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("owns group lifecycle and reduces all process results", () => {
    const group = createParallelGroup(root, ["a", "b"], "parallel-lifecycle");
    expect(validateParallelGroup(group)).toBe(true);
    recordParallelPid(root, group.id, "a", 101);
    recordParallelResult(root, group.id, "a", 0);
    const completed = recordParallelResult(root, group.id, "b", 2);

    expect(completed).toMatchObject({
      status: "complete",
      results: { a: { status: "success" }, b: { status: "failed", exitCode: 2 } },
    });
    expect(JSON.parse(readFileSync(join(root, "parallel", "parallel-lifecycle.json"), "utf8"))).toMatchObject({ status: "complete" });
  });

  it("rejects duplicate agents, malformed normalized records, and symlink records", () => {
    expect(() => createParallelGroup(root, ["a", "a"], "parallel-duplicate")).toThrow(/unique/);
    const stateDir = join(root, "parallel");
    mkdirSync(stateDir, { recursive: true });
    const malformed = join(stateDir, "parallel-malformed.json");
    writeFileSync(malformed, JSON.stringify({ id: "parallel-malformed", status: "running" }));
    expect(() => recordParallelPid(root, "parallel-malformed", "a", 1)).toThrow(/invalid parallel group/);

    const target = join(root, "target.json");
    writeFileSync(target, JSON.stringify({}));
    const symlink = join(stateDir, "parallel-symlink.json");
    symlinkSync(target, symlink);
    expect(() => recordParallelPid(root, "parallel-symlink", "a", 1)).toThrow(/non-symlink regular file/);
    expect(lstatSync(symlink).isSymbolicLink()).toBe(true);
  });
});
