import { resolveRunAgentProfileId } from "../agents/run-agent-profile";

const profiles = [
  { id: "claude-sonnet", isDefault: true },
  { id: "kollab", isDefault: false },
  { id: "codex-default", isDefault: false },
];

describe("resolveRunAgentProfileId", () => {
  it("uses an explicitly requested profile when it exists", () => {
    expect(resolveRunAgentProfileId({
      requestedProfileId: "kollab",
      chainDefaultProfileId: "claude-sonnet",
      profiles,
    })).toBe("kollab");
  });

  it("skips stale chain defaults instead of returning missing profile ids", () => {
    expect(resolveRunAgentProfileId({
      chainDefaultProfileId: "claude-opus-4-7",
      profiles,
    })).toBe("claude-sonnet");
  });

  it("uses workspace default before namespace default when chain default is stale", () => {
    expect(resolveRunAgentProfileId({
      chainDefaultProfileId: "claude-opus-4-7",
      workspaceDefaultProfileId: "kollab",
      profiles,
    })).toBe("kollab");
  });

  it("returns undefined when no valid profile exists", () => {
    expect(resolveRunAgentProfileId({
      requestedProfileId: "missing",
      chainDefaultProfileId: "also-missing",
      profiles: [],
    })).toBeUndefined();
  });
});
