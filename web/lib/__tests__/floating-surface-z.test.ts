import { FLOATING_SURFACE_Z } from "../ui/floating-surface-z";

describe("FLOATING_SURFACE_Z", () => {
  it("keeps floating app panels below tools, nav, and kollab", () => {
    expect(FLOATING_SURFACE_Z.appDesktop).toBeLessThan(FLOATING_SURFACE_Z.appPanelBackdrop);
    expect(FLOATING_SURFACE_Z.appPanelBackdrop).toBeLessThan(FLOATING_SURFACE_Z.appPanelBase);
    expect(FLOATING_SURFACE_Z.appPanelBase).toBeLessThan(FLOATING_SURFACE_Z.codeBackdrop);
    expect(FLOATING_SURFACE_Z.codeBackdrop).toBeLessThan(FLOATING_SURFACE_Z.codePanel);
    expect(FLOATING_SURFACE_Z.codePanel).toBeLessThan(FLOATING_SURFACE_Z.terminalPanel);
    expect(FLOATING_SURFACE_Z.terminalPanel).toBeLessThan(FLOATING_SURFACE_Z.pillNavGlow);
    expect(FLOATING_SURFACE_Z.pillNavGlow).toBeLessThan(FLOATING_SURFACE_Z.pillNav);
    expect(FLOATING_SURFACE_Z.pillNav).toBeLessThan(FLOATING_SURFACE_Z.pillNavMenu);
    expect(FLOATING_SURFACE_Z.pillNavMenu).toBeLessThan(FLOATING_SURFACE_Z.kollaborBackdrop);
    expect(FLOATING_SURFACE_Z.kollaborBackdrop).toBeLessThan(FLOATING_SURFACE_Z.kollaborBar);
    expect(FLOATING_SURFACE_Z.kollaborBar).toBeLessThan(FLOATING_SURFACE_Z.kollaborPrompt);
  });
});
