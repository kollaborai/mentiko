import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSessionLogResolverCli } from "@/lib/runs/session-log-resolver-cli";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "mentiko-session-log-cli-"));
}

describe("runner-session-log-resolver CLI", () => {
  it("resolves profile roots through the typed profile contract", () => {
    const root = tempDir();
    const profiles = join(root, "profiles");
    mkdirSync(profiles);
    const profile = join(profiles, "agent.json");
    writeFileSync(profile, JSON.stringify({ id: "agent", name: "Agent", cli: "claude", log_path: "/tmp/transcripts" }));
    const output: string[] = [];

    expect(runSessionLogResolverCli(["log-dir", "--profile-or-cli", profile, "--cwd", "/work/demo"], (line) => output.push(line))).toBe(0);
    expect(output).toEqual(["/tmp/transcripts/-work-demo"]);
  });

  it("preserves degraded capture for a bare CLI instead of guessing a transcript root", () => {
    const output: string[] = [];
    expect(runSessionLogResolverCli(["log-dir", "--profile-or-cli", "claude", "--cwd", "/work/demo"], (line) => output.push(line))).toBe(0);
    expect(output).toEqual([]);
  });

  it("rejects unknown command flags", () => {
    expect(() => runSessionLogResolverCli(["log-dir", "--profile-or-cli", "claude", "--cwd", "/tmp", "--unknown", "x"])).toThrow("--unknown is not valid");
  });
});
