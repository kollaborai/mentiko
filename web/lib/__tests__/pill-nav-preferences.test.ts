import {
  COLOR_SCHEME_GRADIENTS,
  COLOR_SCHEME_LABELS,
  COLOR_SCHEME_SWATCH,
  PILL_NAV_PRESET_COLOR_SCHEMES,
  getPillNavShineGradient,
  usePillNavPreferences,
} from "../pill-nav-preferences";

describe("pill nav preferences", () => {
  it("uses grey tones as the default shine preset before rainbow", () => {
    expect(PILL_NAV_PRESET_COLOR_SCHEMES.slice(0, 2)).toEqual(["grey", "rainbow"]);
    expect(usePillNavPreferences.getState().prefs.colorScheme).toBe("grey");
    expect(getPillNavShineGradient(usePillNavPreferences.getState().prefs)).toBe(
      "#929292, #ffffff, #606060, #000000, #232323",
    );
  });

  it("defines the grey preset label, swatch, and gradient", () => {
    expect(COLOR_SCHEME_LABELS.grey).toBe("Grey");
    expect(COLOR_SCHEME_SWATCH.grey).toBe(
      "conic-gradient(#929292, #ffffff, #606060, #000000, #232323, #929292)",
    );
    expect(COLOR_SCHEME_GRADIENTS.grey).toBe(
      "#929292, #ffffff, #606060, #000000, #232323",
    );
  });
});
