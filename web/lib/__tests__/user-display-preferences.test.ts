import {
  FLOATING_PANEL_TRANSPARENCY_DEFAULT,
  USER_FONT_SIZE_MAP,
  applyUserDisplayPreferences,
  getFloatingPanelSurfaceMixes,
  getUserDisplayPreferencesInitScript,
} from "../ui/user-display-preferences";

describe("user display preferences", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("style");
  });

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

  it("keeps the default floating panel opacity aligned with readable chrome", () => {
    expect(FLOATING_PANEL_TRANSPARENCY_DEFAULT).toBe(90);
    expect(getFloatingPanelSurfaceMixes(FLOATING_PANEL_TRANSPARENCY_DEFAULT)).toEqual({
      body: "96%",
      pane: "98%",
      filters: "94%",
      item: "97%",
      itemHover: "100%",
      controls: "98%",
      border: "100%",
      docsSidebar: "98%",
      docsHeader: "98%",
      docsSurface: "97%",
      docsHover: "100%",
    });
  });

  it("treats an 85 panel setting as mostly solid, not mostly transparent", () => {
    expect(getFloatingPanelSurfaceMixes(85)).toEqual(
      expect.objectContaining({
        body: "91%",
        pane: "93%",
        docsSurface: "92%",
      }),
    );
  });

  it("applies floating panel opacity variables", () => {
    applyUserDisplayPreferences({ floatingPanelTransparency: 85 });

    expect(document.documentElement.style.getPropertyValue("--floating-panel-body-mix")).toBe("91%");
    expect(document.documentElement.style.getPropertyValue("--floating-panel-pane-mix")).toBe("93%");
    expect(document.documentElement.style.getPropertyValue("--floating-panel-filters-mix")).toBe("89%");
    expect(document.documentElement.style.getPropertyValue("--floating-panel-item-hover-mix")).toBe("95%");
    expect(document.documentElement.style.getPropertyValue("--floating-panel-docs-sidebar-mix")).toBe("93%");
    expect(document.documentElement.style.getPropertyValue("--floating-panel-docs-surface-mix")).toBe("92%");
  });

  it("initializes saved floating panel transparency before the app shell paints", () => {
    const script = getUserDisplayPreferencesInitScript();

    expect(script).toContain("floatingPanelTransparency");
    expect(script).toContain("--floating-panel-body-mix");
    expect(script).toContain("--floating-panel-pane-mix");
    expect(script).toContain("--floating-panel-item-hover-mix");
    expect(script).toContain("--floating-panel-docs-sidebar-mix");
  });
});
