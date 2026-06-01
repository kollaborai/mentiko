"use client";

import { create } from "zustand";

export type PillNavPresetColorScheme = "grey" | "rainbow" | "blue" | "green" | "pink" | "purple" | "amber" | "cyan";
export type PillNavColorScheme = PillNavPresetColorScheme | "custom";
export type PillNavNavigationMode = "page" | "floating-nav-panels";

export const PILL_NAV_PRESET_COLOR_SCHEMES: PillNavPresetColorScheme[] = [
  "grey",
  "rainbow",
  "blue",
  "green",
  "pink",
  "purple",
  "amber",
  "cyan",
];

export const DEFAULT_PILL_NAV_COLOR_SCHEME: PillNavPresetColorScheme = "grey";
export const DEFAULT_PILL_NAV_CUSTOM_GLOW_COLORS = [
  "#929292",
  "#ffffff",
  "#606060",
  "#000000",
  "#232323",
];

export interface PillNavPreferences {
  colorScheme: PillNavColorScheme;
  customGlowColors: string[];
  scale: number; // 0.8 - 1.4
  showRecents: boolean;
  navigationMode: PillNavNavigationMode;
}

const defaults: PillNavPreferences = {
  colorScheme: DEFAULT_PILL_NAV_COLOR_SCHEME,
  customGlowColors: DEFAULT_PILL_NAV_CUSTOM_GLOW_COLORS,
  scale: 1.0,
  showRecents: true,
  navigationMode: "page",
};

export const COLOR_SCHEME_GRADIENTS: Record<PillNavPresetColorScheme, string> = {
  grey:    "#929292, #ffffff, #606060, #000000, #232323",
  rainbow: "#ff00ff, #00ffff, #ff3131, #00ff00, #ffea00",
  blue:    "#1e3a5f, #3b82f6, #60a5fa, #93c5fd, #1e3a5f",
  green:   "#064e3b, #10b981, #34d399, #6ee7b7, #064e3b",
  pink:    "#831843, #ec4899, #f472b6, #f9a8d4, #831843",
  purple:  "#4c1d95, #8b5cf6, #a78bfa, #c4b5fd, #4c1d95",
  amber:   "#78350f, #f59e0b, #fbbf24, #fcd34d, #78350f",
  cyan:    "#083344, #06b6d4, #22d3ee, #67e8f9, #083344",
};

export const COLOR_SCHEME_LABELS: Record<PillNavPresetColorScheme, string> = {
  grey:    "Grey",
  rainbow: "Rainbow",
  blue:    "Blue",
  green:   "Green",
  pink:    "Pink",
  purple:  "Purple",
  amber:   "Amber",
  cyan:    "Cyan",
};

// preview swatch color for each scheme (middle tone)
export const COLOR_SCHEME_SWATCH: Record<PillNavPresetColorScheme, string> = {
  grey:    "conic-gradient(#929292, #ffffff, #606060, #000000, #232323, #929292)",
  rainbow: "conic-gradient(#ff00ff, #00ffff, #ff3131, #00ff00, #ffea00, #ff00ff)",
  blue:    "#3b82f6",
  green:   "#10b981",
  pink:    "#ec4899",
  purple:  "#8b5cf6",
  amber:   "#f59e0b",
  cyan:    "#06b6d4",
};

const STORAGE_KEY = "pill-nav-preferences";
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

function normalizeCustomGlowColors(colors: unknown): string[] {
  if (!Array.isArray(colors)) return defaults.customGlowColors;
  const safe = colors
    .filter((color): color is string => typeof color === "string" && HEX_COLOR_RE.test(color))
    .slice(0, 5);
  return safe.length >= 2 ? safe : defaults.customGlowColors;
}

export function getPillNavShineGradient(prefs: PillNavPreferences): string {
  if (prefs.colorScheme === "custom") {
    return normalizeCustomGlowColors(prefs.customGlowColors).join(", ");
  }
  return COLOR_SCHEME_GRADIENTS[prefs.colorScheme] || COLOR_SCHEME_GRADIENTS.rainbow;
}

function loadFromStorage(): PillNavPreferences {
  if (typeof window === "undefined") return defaults;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? { ...defaults, ...JSON.parse(stored) } : defaults;
    return {
      ...parsed,
      customGlowColors: normalizeCustomGlowColors(parsed.customGlowColors),
    };
  } catch {
    return defaults;
  }
}

function saveToStorage(prefs: PillNavPreferences) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch { /* ignore */ }
}

interface PillNavPreferencesStore {
  prefs: PillNavPreferences;
  hydrate: () => void;
  setColorScheme: (scheme: PillNavColorScheme) => void;
  setCustomGlowColors: (colors: string[]) => void;
  setScale: (scale: number) => void;
  setShowRecents: (show: boolean) => void;
  setNavigationMode: (mode: PillNavNavigationMode) => void;
  getShineGradient: () => string;
}

export const usePillNavPreferences = create<PillNavPreferencesStore>()((set, get) => ({
  prefs: defaults,

  hydrate: () => {
    set({ prefs: loadFromStorage() });
  },

  setColorScheme: (scheme) => {
    const newPrefs = { ...get().prefs, colorScheme: scheme };
    set({ prefs: newPrefs });
    saveToStorage(newPrefs);
  },

  setCustomGlowColors: (colors) => {
    const newPrefs = {
      ...get().prefs,
      colorScheme: "custom" as const,
      customGlowColors: normalizeCustomGlowColors(colors),
    };
    set({ prefs: newPrefs });
    saveToStorage(newPrefs);
  },

  setScale: (scale) => {
    const clamped = Math.min(1.4, Math.max(0.8, scale));
    const newPrefs = { ...get().prefs, scale: clamped };
    set({ prefs: newPrefs });
    saveToStorage(newPrefs);
  },

  setShowRecents: (show) => {
    const newPrefs = { ...get().prefs, showRecents: show };
    set({ prefs: newPrefs });
    saveToStorage(newPrefs);
  },

  setNavigationMode: (mode) => {
    const newPrefs = { ...get().prefs, navigationMode: mode };
    set({ prefs: newPrefs });
    saveToStorage(newPrefs);
  },

  getShineGradient: () => {
    return getPillNavShineGradient(get().prefs);
  },
}));
