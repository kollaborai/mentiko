import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRunnerAgentProfileCli } from "@/lib/runner-v2/agent-profile-cli";

jest.mock("@/lib/secrets/secrets-store", () => ({ getSecretByName: jest.fn(() => null) }));

function tempDir() {
  return mkdtempSync(join(tmpdir(), "runner-v2-agent-profile-cli-"));
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value)}\n`);
}

describe("runner-agent-profile CLI", () => {
  it("returns the typed namespace default selection without exposing profile values", () => {
    const root = tempDir();
    const profilesDir = join(root, "profiles");
    mkdirSync(profilesDir, { recursive: true });
    writeJson(join(profilesDir, "default.json"), {
      id: "default", name: "Default", cli: "claude", isDefault: true, env: { SECRET: "do-not-expose" },
    });
    const output: string[] = [];

    runRunnerAgentProfileCli(["default", "--profiles-dir", profilesDir], (line) => output.push(line));

    expect(JSON.parse(output[0])).toEqual({ id: "default", name: "Default", path: join(profilesDir, "default.json"), source: "namespace" });
  });

  it("returns advisor primitives without making a shell parse profile JSON", () => {
    const root = tempDir();
    const profilesDir = join(root, "profiles");
    mkdirSync(profilesDir, { recursive: true });
    writeJson(join(profilesDir, "advisor.json"), {
      id: "advisor", name: "Advisor", cli: "codex", isAdvisorDefault: true, env: { SECRET: "do-not-expose" },
    });
    const id: string[] = [];
    const path: string[] = [];

    runRunnerAgentProfileCli(["advisor-field", "--profiles-dir", profilesDir, "--field", "id"], (line) => id.push(line));
    runRunnerAgentProfileCli(["advisor-field", "--profiles-dir", profilesDir, "--field", "path"], (line) => path.push(line));

    expect(id).toEqual(["advisor"]);
    expect(path).toEqual([join(profilesDir, "advisor.json")]);
  });

  it("returns selected-profile and transcript primitives without exposing profile JSON", () => {
    const root = tempDir();
    const profilesDir = join(root, "profiles");
    mkdirSync(profilesDir, { recursive: true });
    const profilePath = join(profilesDir, "monitor.json");
    writeJson(profilePath, {
      id: "monitor", name: "Monitor", cli: "codex", log_path: "/tmp/mentiko-transcripts",
    });
    const selectedPath: string[] = [];
    const cli: string[] = [];
    const logPath: string[] = [];

    runRunnerAgentProfileCli(["select-field", "--profiles-dir", profilesDir, "--profile-id", "monitor", "--field", "path"], (line) => selectedPath.push(line));
    runRunnerAgentProfileCli(["transcript-field", "--profile-path", profilePath, "--field", "cli"], (line) => cli.push(line));
    runRunnerAgentProfileCli(["transcript-field", "--profile-path", profilePath, "--field", "logPath"], (line) => logPath.push(line));

    expect(selectedPath).toEqual([profilePath]);
    expect(cli).toEqual(["codex"]);
    expect(logPath).toEqual(["/tmp/mentiko-transcripts"]);
  });

  it("rejects unsupported flags instead of silently changing profile command behavior", () => {
    expect(() => runRunnerAgentProfileCli([
      "command", "--profile-path", "/tmp/profile.json", "--interactive", "true", "--namespace-id", "default", "--org-id", "default", "--unknown", "x",
    ])).toThrow("--unknown is not valid");
  });
});
