"use client";

import { create } from "zustand";

export interface TerminalPreferences {
  autoCdFloatingTerminalToWorkspace: boolean;
}

const STORAGE_KEY = "terminal-preferences";

const defaults: TerminalPreferences = {
  autoCdFloatingTerminalToWorkspace: false,
};

function loadFromStorage(): TerminalPreferences {
  if (typeof window === "undefined") return defaults;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? { ...defaults, ...JSON.parse(stored) } : defaults;
  } catch {
    return defaults;
  }
}

function saveToStorage(prefs: TerminalPreferences) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch { /* ignore */ }
}

interface TerminalPreferencesStore {
  prefs: TerminalPreferences;
  hydrate: () => void;
  setAutoCdFloatingTerminalToWorkspace: (enabled: boolean) => void;
}

export const useTerminalPreferences = create<TerminalPreferencesStore>()((set, get) => ({
  prefs: defaults,

  hydrate: () => {
    set({ prefs: loadFromStorage() });
  },

  setAutoCdFloatingTerminalToWorkspace: (enabled) => {
    const nextPrefs = {
      ...get().prefs,
      autoCdFloatingTerminalToWorkspace: enabled,
    };
    set({ prefs: nextPrefs });
    saveToStorage(nextPrefs);
  },
}));
