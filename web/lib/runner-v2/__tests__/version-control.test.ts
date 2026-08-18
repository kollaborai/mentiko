import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  compareAgents,
  createVersion,
  getMetadata,
  listVersions,
  nextVersion,
  parseSemver,
  rollback,
  versionPath,
} from "../version-control";

describe("typed chain version contract", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "mentiko-version-control-"));
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "chain.json"), JSON.stringify({
      version: "1.2.3",
      agents: [{ id: "a1", prompt: "one" }],
    }));
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("parses and bumps semver without shell helpers", () => {
    expect(parseSemver("v2.3.4")).toEqual([2, 3, 4]);
    expect(nextVersion(root, "minor")).toBe("1.3.0");
  });

  it("uses the initial version for a missing or invalid version field", () => {
    rmSync(join(root, "chain.json"));
    expect(nextVersion(root)).toBe("1.0.0");
    writeFileSync(join(root, "chain.json"), JSON.stringify({ version: "not-semver" }));
    expect(nextVersion(root)).toBe("1.0.0");
  });

  it("archives raw chain bytes and writes typed metadata/history", () => {
    const raw = readFileSync(join(root, "chain.json"));
    expect(createVersion(root, "1.2.4", "release", "tester", new Date("2026-01-01T00:00:00.000Z"))).toBe("v1.2.4");
    expect(readFileSync(versionPath(root, "1.2.4"))).toEqual(raw);
    expect(getMetadata(root, "1.2.4")).toMatchObject({ version: "1.2.4", message: "release", author: "tester" });
    expect(JSON.parse(readFileSync(join(root, "chain.json"), "utf8")).versions).toHaveLength(1);
  });

  it("lists snapshots by semantic version and rejects malformed JSON", () => {
    createVersion(root, "1.2.4", "new", "tester", new Date("2026-01-01T00:00:00.000Z"));
    mkdirSync(join(root, "versions", "v2.0.0"), { recursive: true });
    writeFileSync(join(root, "versions", "v2.0.0", "metadata.json"), JSON.stringify({ version: "2.0.0", created: "2026-01-02T00:00:00.000Z", message: "latest" }));
    expect(listVersions(root).map((entry) => entry.version)).toEqual(["2.0.0", "1.2.4"]);
    writeFileSync(join(root, "versions", "v2.0.0", "metadata.json"), "{");
    expect(() => listVersions(root)).toThrow(/not valid JSON/);
  });

  it("rolls back with a backup and increments the restored chain", () => {
    createVersion(root, "1.2.4", "release", "tester", new Date("2026-01-01T00:00:00.000Z"));
    const result = rollback(root, "1.2.4", new Date("2026-01-02T03:04:05.000Z"));
    expect(result).toMatchObject({ currentVersion: "1.2.3", targetVersion: "1.2.4", newVersion: "1.2.4" });
    expect(readFileSync(join(root, "chain.json"), "utf8")).toContain('"version": "1.2.4"');
  });

  it("compares agent prompts through the typed JSON reader", () => {
    createVersion(root, "1.2.4", "release", "tester", new Date("2026-01-01T00:00:00.000Z"));
    const current = JSON.parse(readFileSync(join(root, "chain.json"), "utf8"));
    current.agents = [{ id: "a1", prompt: "two" }, { id: "a2", prompt: "new" }];
    mkdirSync(join(root, "versions", "v1.2.5"), { recursive: true });
    writeFileSync(join(root, "versions", "v1.2.5", "chain.json"), JSON.stringify(current));
    expect(compareAgents(root, "1.2.4", "1.2.5")).toContain("~ a1");
    expect(compareAgents(root, "1.2.4", "1.2.5")).toContain("+ a2");
  });
});
