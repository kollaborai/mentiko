import { selectOnboardingProfileId } from "./select-provider-profile";

describe("selectOnboardingProfileId", () => {
  it("uses the explicitly requested profile when given, regardless of readiness", () => {
    const profiles = [
      { id: "a" },
      { id: "b", readiness: { enabled: true, ready_patterns: [{ value: "x" }] } },
    ];
    expect(selectOnboardingProfileId(profiles, "a")).toBe("a");
  });

  it("never relies on array order: codex-default (readiness disabled) is skipped for codex-terra", () => {
    const profiles = [
      { id: "codex-default", readiness: { enabled: false } },
      { id: "codex-terra", readiness: { enabled: true, ready_patterns: [{ value: "OpenAI Codex" }] } },
      { id: "codex-fast", readiness: { enabled: true, ready_patterns: [{ value: "OpenAI Codex" }] } },
    ];
    expect(selectOnboardingProfileId(profiles)).toBe("codex-terra");
  });

  it("treats readiness enabled with zero ready_patterns as not readiness-capable", () => {
    const profiles = [
      { id: "a", readiness: { enabled: true, ready_patterns: [] } },
      { id: "b", readiness: { enabled: true, ready_patterns: [{ value: "x" }] } },
    ];
    expect(selectOnboardingProfileId(profiles)).toBe("b");
  });

  it("falls back to the bundle's first profile when nothing in it can ever prove readiness", () => {
    const profiles = [
      { id: "a", readiness: { enabled: false } },
      { id: "b" },
    ];
    expect(selectOnboardingProfileId(profiles)).toBe("a");
  });

  it("returns an empty string for an empty bundle", () => {
    expect(selectOnboardingProfileId([])).toBe("");
  });
});
