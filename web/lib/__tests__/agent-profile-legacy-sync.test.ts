import { getLegacyProfileSyncUpdates } from "@/lib/agents/agent-profile-legacy-sync";
import type { AgentProfile } from "@/lib/agents/agent-profile-storage";

function profile(overrides: Partial<AgentProfile>): AgentProfile {
  return {
    id: "test",
    name: "Test",
    isDefault: false,
    isAdvisorDefault: false,
    cli: "claude",
    extra_args: [],
    env: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("agent profile legacy sync", () => {
  it("rewrites installed Gemini CLI profile metadata to Antigravity without creating a new id", () => {
    const updates = getLegacyProfileSyncUpdates(profile({
      id: "gemini-pro",
      name: "Gemini / Pro",
      cli: "gemini",
      model: "gemini-2.5-pro",
      pipe_flag: "-p",
      permission_flag: "-y",
      log_path: "~/.gemini/tmp/",
      env: { GEMINI_API_KEY: "{secret:google}" },
    }));

    expect(updates).toEqual(expect.objectContaining({
      name: "Antigravity / Gemini Pro Legacy",
      cli: "agy",
      model: "",
      pipe_flag: "",
      permission_flag: "--dangerously-skip-permissions",
      log_path: "~/.gemini/antigravity-cli/",
      log_format: "json",
    }));
    expect(updates).not.toHaveProperty("env");
  });

  it("ignores profiles that are not catalog legacy replacements", () => {
    expect(getLegacyProfileSyncUpdates(profile({ id: "user-owned-profile" }))).toBeNull();
  });
});
