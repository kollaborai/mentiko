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

  it("rejects unsupported flags instead of silently changing profile command behavior", () => {
    expect(() => runRunnerAgentProfileCli([
      "command", "--profile-path", "/tmp/profile.json", "--interactive", "true", "--namespace-id", "default", "--org-id", "default", "--unknown", "x",
    ])).toThrow("--unknown is not valid");
  });
});
