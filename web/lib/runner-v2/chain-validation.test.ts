import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readRawChainFile, validateChainFile } from "@/lib/runner-v2/chain-validation-cli";

function fixture(text: string): string {
  const root = mkdtempSync(join(tmpdir(), "mentiko-chain-validation-"));
  const path = join(root, "chain.json");
  writeFileSync(path, text);
  return path;
}

describe("typed chain validation", () => {
  it("separates JSON5 raw parsing from normalized strict validation", () => {
    const path = fixture(`{
      // comments and trailing commas are accepted by the legacy entrypoint
      name: "demo",
      agents: [
        { id: "writer", name: "Writer", triggers: ["manual-start"], emits: "draft", prompt: "write", },
        { id: "reviewer", name: "Reviewer", triggers: ["draft"], emits: "approved", spec: "review.md", },
      ],
    }`);
    expect(readRawChainFile(path).value.name).toBe("demo");
    const report = validateChainFile(path, true);
    expect(report.errors).toEqual([]);
    expect(report.lines).toEqual(expect.arrayContaining(["running strict validation..."]));
    expect(report.warnings.join("\n")).toContain("emits with no matching triggers");
  });

  it("reports normalized required-field and strict graph failures", () => {
    const path = fixture(JSON.stringify({ name: "broken", agents: [{ id: "a", name: "A", triggers: ["missing"], emits: "done" }] }));
    const report = validateChainFile(path, true);
    expect(report.errors).toEqual([]);
    expect(report.warnings.join("\n")).toContain("missing");
    const invalid = fixture(JSON.stringify({ name: "broken", agents: [{ id: "a", name: "A" }] }));
    expect(validateChainFile(invalid, false).errors.join("\n")).toContain("agents missing required fields");
  });

  it("rejects symlinked raw files", () => {
    const target = fixture(JSON.stringify({ name: "demo", agents: [] }));
    const link = `${target}.link`;
    symlinkSync(target, link);
    expect(() => readRawChainFile(link)).toThrow("non-symlink regular file");
  });
});
