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
    } = await import("../ui/kollabor-bar-store");

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

    const { useKollaborBarStore } = await import("../ui/kollabor-bar-store");

    expect(useKollaborBarStore.getState().fontScale).toBe(1.25);
  });

  it("loads and persists side docking for the floating bar", async () => {
    const { useKollaborBarStore } = await import("../ui/kollabor-bar-store");

    expect(useKollaborBarStore.getState().dock).toEqual({ edge: "bottom", offset: 50 });

    useKollaborBarStore.getState().setDock({ edge: "left", offset: 4 });

    expect(useKollaborBarStore.getState().dock).toEqual({ edge: "left", offset: 10 });
    expect(JSON.parse(localStorage.getItem("mentiko-kollabor-dock") || "{}")).toEqual({
      edge: "left",
      offset: 10,
    });
  });

  it("hydrates a saved side dock and ignores corrupted dock storage", async () => {
    localStorage.setItem("mentiko-kollabor-dock", JSON.stringify({ edge: "right", offset: 91 }));

    let mod = await import("../ui/kollabor-bar-store");
    expect(mod.useKollaborBarStore.getState().dock).toEqual({ edge: "right", offset: 90 });

    jest.resetModules();
    localStorage.setItem("mentiko-kollabor-dock", "{nope");

    mod = await import("../ui/kollabor-bar-store");
    expect(mod.useKollaborBarStore.getState().dock).toEqual({ edge: "bottom", offset: 50 });
  });

  it("maps dragged screen points to side dock positions inside the edge reach", async () => {
    const { getKollaborBarDockForPoint } = await import("../ui/kollabor-bar-store");

    expect(getKollaborBarDockForPoint(240, 500, 1440, 1000)).toEqual({
      edge: "left",
      offset: 50,
    });
    expect(getKollaborBarDockForPoint(1200, 250, 1440, 1000)).toEqual({
      edge: "right",
      offset: 25,
    });
    expect(getKollaborBarDockForPoint(720, 500, 1440, 1000)).toEqual({
      edge: "bottom",
      offset: 50,
    });
  });

  it("keeps transcripts scoped per signed-in user and ignores legacy origin-wide transcripts", async () => {
    localStorage.setItem("mentiko-kollabor-transcript", JSON.stringify([
      { id: "old", role: "assistant", content: "old install", timestamp: 1 },
    ]));
    localStorage.setItem("mentiko-kollabor-transcript:user-a", JSON.stringify([
      { id: "a", role: "assistant", content: "user a", timestamp: 2 },
    ]));

    const { setKollaborBarStorageScope, useKollaborBarStore } = await import("../ui/kollabor-bar-store");

    expect(useKollaborBarStore.getState().messages).toEqual([]);

    setKollaborBarStorageScope("user-a");
    expect(useKollaborBarStore.getState().messages.map((m) => m.content)).toEqual(["user a"]);

    useKollaborBarStore.getState().pushMessage({
      id: "u",
      role: "user",
      content: "new user a message",
      timestamp: 3,
    });

    expect(localStorage.getItem("mentiko-kollabor-transcript")).toContain("old install");
    expect(localStorage.getItem("mentiko-kollabor-transcript:user-a")).toContain("new user a message");

    setKollaborBarStorageScope("user-b");
    expect(useKollaborBarStore.getState().messages).toEqual([]);
  });
});
