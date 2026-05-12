"use client";

import { create } from "zustand";

type Locale = "en" | "es" | "fr" | "de";

const LOCALE_STORAGE_KEY = "mentiko-locale";

interface LocaleStore {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const getInitialLocale = (): Locale => {
  if (typeof window === "undefined") return "en";
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    return (stored === "en" || stored === "es" || stored === "fr" || stored === "de")
      ? stored
      : "en";
  } catch {
    return "en";
  }
};

export const useLocaleStore = create<LocaleStore>()((set) => ({
  locale: getInitialLocale(),
  setLocale: (locale) => {
    set({ locale });
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // ignore storage errors
    }
  },
}));
