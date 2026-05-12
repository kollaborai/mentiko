"use client";

import { create } from "zustand";

export type PillNavColorScheme = "rainbow" | "blue" | "green" | "pink" | "purple" | "amber" | "cyan";

export interface PillNavPreferences {
  colorScheme: PillNavColorScheme;
  scale: number; // 0.8 - 1.4
  showRecents: boolean;
}

const defaults: PillNavPreferences = {
  colorScheme: "rainbow",
  scale: 1.0,
  showRecents: true,
};

export const COLOR_SCHEME_GRADIENTS: Record<PillNavColorScheme, string> = {
  rainbow: "#ff00ff, #00ffff, #ff3131, #00ff00, #ffea00",
  blue:    "#1e3a5f, #3b82f6, #60a5fa, #93c5fd, #1e3a5f",
  green:   "#064e3b, #10b981, #34d399, #6ee7b7, #064e3b",
  pink:    "#831843, #ec4899, #f472b6, #f9a8d4, #831843",
  purple:  "#4c1d95, #8b5cf6, #a78bfa, #c4b5fd, #4c1d95",
  amber:   "#78350f, #f59e0b, #fbbf24, #fcd34d, #78350f",
  cyan:    "#083344, #06b6d4, #22d3ee, #67e8f9, #083344",
};

export const COLOR_SCHEME_LABELS: Record<PillNavColorScheme, string> = {
  rainbow: "Rainbow",
  blue:    "Blue",
  green:   "Green",
  pink:    "Pink",
  purple:  "Purple",
  amber:   "Amber",
  cyan:    "Cyan",
};

// preview swatch color for each scheme (middle tone)
export const COLOR_SCHEME_SWATCH: Record<PillNavColorScheme, string> = {
  rainbow: "conic-gradient(#ff00ff, #00ffff, #ff3131, #00ff00, #ffea00, #ff00ff)",
  blue:    "#3b82f6",
  green:   "#10b981",
  pink:    "#ec4899",
  purple:  "#8b5cf6",
  amber:   "#f59e0b",
  cyan:    "#06b6d4",
};

const STORAGE_KEY = "pill-nav-preferences";

function loadFromStorage(): PillNavPreferences {
  if (typeof window === "undefined") return defaults;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? { ...defaults, ...JSON.parse(stored) } : defaults;
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
  setColorScheme: (scheme: PillNavColorScheme) => void;
  setScale: (scale: number) => void;
  setShowRecents: (show: boolean) => void;
  getShineGradient: () => string;
}

export const usePillNavPreferences = create<PillNavPreferencesStore>()((set, get) => ({
  prefs: loadFromStorage(),

  setColorScheme: (scheme) => {
    const newPrefs = { ...get().prefs, colorScheme: scheme };
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

  getShineGradient: () => {
    return COLOR_SCHEME_GRADIENTS[get().prefs.colorScheme] || COLOR_SCHEME_GRADIENTS.rainbow;
  },
}));
