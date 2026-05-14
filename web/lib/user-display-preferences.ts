export type UserFontSizePreference = "sm" | "md" | "lg";
export type UserAccentColorPreference = "blue" | "purple" | "green" | "orange" | "pink";

export interface UserDisplayPreferences {
  accentColor: UserAccentColorPreference;
  fontSize: UserFontSizePreference;
}

export const USER_PREFERENCES_STORAGE_KEY = "user-preferences";

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
    if (prefs.fontSize && fontMap[prefs.fontSize]) {
      document.documentElement.style.fontSize = fontMap[prefs.fontSize];
    }
    if (prefs.accentColor && accentMap[prefs.accentColor]) {
      const accent = "oklch(" + accentMap[prefs.accentColor] + ")";
      document.documentElement.style.setProperty("--primary", accent);
      document.documentElement.style.setProperty("--ring", accent);
    }
  } catch {}
})();`;
}
