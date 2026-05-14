import {
  USER_FONT_SIZE_MAP,
  getUserDisplayPreferencesInitScript,
} from "../user-display-preferences";

describe("user display preferences", () => {
  it("keeps font-size tokens stable across app shell and settings", () => {
    expect(USER_FONT_SIZE_MAP).toEqual({
      sm: "13px",
      md: "15px",
      lg: "17px",
    });
  });

  it("builds an early init script for saved display preferences", () => {
    const script = getUserDisplayPreferencesInitScript();
    expect(script).toContain("user-preferences");
    expect(script).toContain("document.documentElement.style.fontSize");
    expect(script).toContain("--primary");
  });
});
