describe("kollabor bar font settings", () => {
  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
  });

  it("loads, clamps, and persists the agent font scale", async () => {
    const {
      FONT_SCALE_MAX,
      FONT_SCALE_MIN,
      useKollaborBarStore,
    } = await import("../kollabor-bar-store");

    expect(useKollaborBarStore.getState().fontScale).toBe(1);

    useKollaborBarStore.getState().setFontScale(FONT_SCALE_MAX + 1);
    expect(useKollaborBarStore.getState().fontScale).toBe(FONT_SCALE_MAX);
    expect(localStorage.getItem("mentiko-kollabor-font-scale")).toBe(String(FONT_SCALE_MAX));

    useKollaborBarStore.getState().setFontScale(FONT_SCALE_MIN - 1);
    expect(useKollaborBarStore.getState().fontScale).toBe(FONT_SCALE_MIN);
    expect(localStorage.getItem("mentiko-kollabor-font-scale")).toBe(String(FONT_SCALE_MIN));
  });

  it("hydrates the agent font scale from local storage", async () => {
    localStorage.setItem("mentiko-kollabor-font-scale", "1.25");

    const { useKollaborBarStore } = await import("../kollabor-bar-store");

    expect(useKollaborBarStore.getState().fontScale).toBe(1.25);
  });
});
