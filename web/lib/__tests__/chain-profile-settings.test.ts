import {
  getMissingAgentProfileId,
  getMissingChainDefaultProfileId,
  withChainDefaultAgentProfile,
} from "../chain-profile-settings";

describe("chain profile settings", () => {
  const profiles = [
    { id: "kollab" },
    { id: "claude-opus" },
  ];

  it("detects stale chain default profile ids", () => {
    expect(getMissingChainDefaultProfileId("claude-opus-4-7", profiles)).toBe("claude-opus-4-7");
  });

  it("detects stale workspace default profile ids", () => {
    expect(getMissingAgentProfileId("missing-workspace-profile", profiles)).toBe("missing-workspace-profile");
  });

  it("does not mark installed profile ids as missing", () => {
    expect(getMissingChainDefaultProfileId("claude-opus", profiles)).toBeUndefined();
  });

  it("deletes the default profile override when workspace default is selected", () => {
    const chain = {
      id: "smoke-test-suite-generator",
      default_agent_profile: "claude-opus-4-7",
      name: "Smoke Test Suite Generator",
    };

    expect(withChainDefaultAgentProfile(chain, undefined)).toEqual({
      id: "smoke-test-suite-generator",
      name: "Smoke Test Suite Generator",
    });
  });

  it("sets the default profile override when a profile is selected", () => {
    expect(withChainDefaultAgentProfile({ id: "chain" }, "kollab")).toEqual({
      id: "chain",
      default_agent_profile: "kollab",
    });
  });
});
