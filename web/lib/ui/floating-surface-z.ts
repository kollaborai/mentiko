export const FLOATING_SURFACE_Z = {
  appDesktop: 10000,
  appPanelBackdrop: 10010,
  appPanelBase: 10100,
  codeBackdrop: 11990,
  codePanel: 12000,
  terminalPanel: 12100,
  pillNavGlow: 12990,
  pillNav: 13000,
  pillNavMenu: 13010,
  // transient toasts sit above the top chrome (pill nav / notifications) so they
  // are never covered, but below the kollabor assistant surfaces.
  toast: 19500,
  kollaborBackdrop: 19999,
  kollaborBar: 20000,
  kollaborPrompt: 20001,
} as const;
