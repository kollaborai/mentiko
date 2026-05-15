export type UserFontSizePreference = "sm" | "md" | "lg";
export type UserAccentColorPreference = "blue" | "purple" | "green" | "orange" | "pink";

export interface UserDisplayPreferences {
  accentColor: UserAccentColorPreference;
  fontSize: UserFontSizePreference;
  floatingPanelTransparency: number;
}

export const USER_PREFERENCES_STORAGE_KEY = "user-preferences";
// Storage keeps the old "transparency" key, but the UI value now means
// surface opacity: higher numbers make panel body/sidebar/header more solid.
export const FLOATING_PANEL_TRANSPARENCY_MIN = 80;
export const FLOATING_PANEL_TRANSPARENCY_MAX = 100;
export const FLOATING_PANEL_TRANSPARENCY_DEFAULT = 90;

export const USER_FONT_SIZE_MAP: Record<UserFontSizePreference, string> = {
  sm: "13px",
  md: "15px",
  lg: "17px",
};

export const USER_ACCENT_OKLCH: Record<UserAccentColorPreference, string> = {
  blue: "0.56 0.22 264.5",
  purple: "0.59 0.25 300.4",
  green: "0.65 0.20 142.3",
  orange: "0.68 0.19 42.9",
  pink: "0.63 0.24 0.6",
};

export interface FloatingPanelSurfaceMixes {
  body: string;
  pane: string;
  filters: string;
  item: string;
  itemHover: string;
  controls: string;
  border: string;
  docsSidebar: string;
  docsHeader: string;
  docsSurface: string;
  docsHover: string;
}

function clampPercent(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function clampFloatingPanelTransparency(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return FLOATING_PANEL_TRANSPARENCY_DEFAULT;
  return clampPercent(
    parsed,
    FLOATING_PANEL_TRANSPARENCY_MIN,
    FLOATING_PANEL_TRANSPARENCY_MAX,
  );
}

function toPercent(value: number) {
  return `${clampPercent(value)}%`;
}

export function getFloatingPanelSurfaceMixes(
  transparency: unknown = FLOATING_PANEL_TRANSPARENCY_DEFAULT,
): FloatingPanelSurfaceMixes {
  const base = clampFloatingPanelTransparency(transparency);

  return {
    body: toPercent(base + 6),
    pane: toPercent(base + 8),
    filters: toPercent(base + 4),
    item: toPercent(base + 7),
    itemHover: toPercent(base + 10),
    controls: toPercent(base + 8),
    border: toPercent(base + 12),
    docsSidebar: toPercent(base + 8),
    docsHeader: toPercent(base + 8),
    docsSurface: toPercent(base + 7),
    docsHover: toPercent(base + 10),
  };
}

function applyFloatingPanelSurfaceMixes(transparency: unknown) {
  const mixes = getFloatingPanelSurfaceMixes(transparency);
  const root = document.documentElement.style;

  root.setProperty("--floating-panel-body-mix", mixes.body);
  root.setProperty("--floating-panel-pane-mix", mixes.pane);
  root.setProperty("--floating-panel-filters-mix", mixes.filters);
  root.setProperty("--floating-panel-item-mix", mixes.item);
  root.setProperty("--floating-panel-item-hover-mix", mixes.itemHover);
  root.setProperty("--floating-panel-control-mix", mixes.controls);
  root.setProperty("--floating-panel-border-mix", mixes.border);
  root.setProperty("--floating-panel-docs-sidebar-mix", mixes.docsSidebar);
  root.setProperty("--floating-panel-docs-header-mix", mixes.docsHeader);
  root.setProperty("--floating-panel-docs-surface-mix", mixes.docsSurface);
  root.setProperty("--floating-panel-docs-hover-mix", mixes.docsHover);
}

export function applyUserDisplayPreferences(prefs: Partial<UserDisplayPreferences> | null | undefined) {
  if (typeof document === "undefined" || !prefs) return;

  if (prefs.fontSize && USER_FONT_SIZE_MAP[prefs.fontSize]) {
    document.documentElement.style.fontSize = USER_FONT_SIZE_MAP[prefs.fontSize];
  }

  if (prefs.accentColor && USER_ACCENT_OKLCH[prefs.accentColor]) {
    const accent = `oklch(${USER_ACCENT_OKLCH[prefs.accentColor]})`;
    document.documentElement.style.setProperty("--primary", accent);
    document.documentElement.style.setProperty("--ring", accent);
  }

  if (prefs.floatingPanelTransparency !== undefined) {
    applyFloatingPanelSurfaceMixes(prefs.floatingPanelTransparency);
  }
}

export function readStoredUserDisplayPreferences(): Partial<UserDisplayPreferences> | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(USER_PREFERENCES_STORAGE_KEY);
    if (!stored) return null;
    return JSON.parse(stored) as Partial<UserDisplayPreferences>;
  } catch {
    return null;
  }
}

export function applyStoredUserDisplayPreferences() {
  applyUserDisplayPreferences(readStoredUserDisplayPreferences());
}

export function getUserDisplayPreferencesInitScript() {
  return `(() => {
  try {
    const stored = localStorage.getItem("${USER_PREFERENCES_STORAGE_KEY}");
    if (!stored) return;
    const prefs = JSON.parse(stored);
    const fontMap = ${JSON.stringify(USER_FONT_SIZE_MAP)};
    const accentMap = ${JSON.stringify(USER_ACCENT_OKLCH)};
    const panelMin = ${FLOATING_PANEL_TRANSPARENCY_MIN};
    const panelMax = ${FLOATING_PANEL_TRANSPARENCY_MAX};
    const panelDefault = ${FLOATING_PANEL_TRANSPARENCY_DEFAULT};
    const clamp = (value, min, max) => Math.min(max, Math.max(min, Math.round(value)));
    const percent = (value) => clamp(value, 0, 100) + "%";
    if (prefs.fontSize && fontMap[prefs.fontSize]) {
      document.documentElement.style.fontSize = fontMap[prefs.fontSize];
    }
    if (prefs.accentColor && accentMap[prefs.accentColor]) {
      const accent = "oklch(" + accentMap[prefs.accentColor] + ")";
      document.documentElement.style.setProperty("--primary", accent);
      document.documentElement.style.setProperty("--ring", accent);
    }
    if (prefs.floatingPanelTransparency !== undefined) {
      const parsed = Number(prefs.floatingPanelTransparency);
      const transparency = Number.isFinite(parsed) ? clamp(parsed, panelMin, panelMax) : panelDefault;
      const base = transparency;
      const root = document.documentElement.style;
      root.setProperty("--floating-panel-body-mix", percent(base + 6));
      root.setProperty("--floating-panel-pane-mix", percent(base + 8));
      root.setProperty("--floating-panel-filters-mix", percent(base + 4));
      root.setProperty("--floating-panel-item-mix", percent(base + 7));
      root.setProperty("--floating-panel-item-hover-mix", percent(base + 10));
      root.setProperty("--floating-panel-control-mix", percent(base + 8));
      root.setProperty("--floating-panel-border-mix", percent(base + 12));
      root.setProperty("--floating-panel-docs-sidebar-mix", percent(base + 8));
      root.setProperty("--floating-panel-docs-header-mix", percent(base + 8));
      root.setProperty("--floating-panel-docs-surface-mix", percent(base + 7));
      root.setProperty("--floating-panel-docs-hover-mix", percent(base + 10));
    }
  } catch {}
})();`;
}
