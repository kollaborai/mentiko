"use client";

import { create } from "zustand";
import { unwrapApiData } from "@/lib/api-client";

export type NotificationChannel = "in_app" | "push" | "email" | "slack" | "webhook";
export type NotificationCategory = "agent" | "chain" | "webhook" | "system";

export interface NotificationPreference {
  category: NotificationCategory;
  channels: {
    in_app: boolean;
    push: boolean;
    email: boolean;
    slack: boolean;
    webhook: boolean;
  };
}

export interface NotificationSettings {
  enabled: boolean;
  preferences: NotificationPreference[];
  email: string;
  slackWebhookUrl?: string;
  webhookUrl?: string;
  quiet_hours: {
    enabled: boolean;
    start: string;
    end: string;
    timezone: string;
  };
  sound_enabled: boolean;
  desktop_enabled: boolean;
}

const defaultPreferences: NotificationPreference[] = [
  { category: "agent", channels: { in_app: true, push: true, email: false, slack: false, webhook: false } },
  { category: "chain", channels: { in_app: true, push: true, email: false, slack: false, webhook: false } },
  { category: "webhook", channels: { in_app: true, push: true, email: true, slack: false, webhook: false } },
  { category: "system", channels: { in_app: true, push: false, email: false, slack: false, webhook: false } },
];

const defaultSettings: NotificationSettings = {
  enabled: true,
  preferences: defaultPreferences,
  email: "",
  quiet_hours: {
    enabled: false,
    start: "22:00",
    end: "08:00",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  },
  sound_enabled: true,
  desktop_enabled: false,
};

const STORAGE_KEY = "notification-preferences";

function loadFromStorage(): NotificationSettings {
  if (typeof window === "undefined") return defaultSettings;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? { ...defaultSettings, ...JSON.parse(stored) } : defaultSettings;
  } catch {
    return defaultSettings;
  }
}

function saveToStorage(settings: NotificationSettings) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error("failed to save notification preferences:", e);
  }
}

interface NotificationPreferencesStore {
  settings: NotificationSettings;
  initialized: boolean;
  init: () => Promise<void>;
  updateSettings: (settings: Partial<NotificationSettings>) => Promise<void>;
  updatePreference: (
    category: NotificationCategory,
    channels: Partial<NotificationPreference["channels"]>
  ) => Promise<void>;
  toggleQuietHours: () => void;
  setQuietHours: (start: string, end: string) => void;
  setEmail: (email: string) => void;
  isChannelEnabled: (category: NotificationCategory, channel: NotificationChannel) => boolean;
  isInQuietHours: () => boolean;
}

export const useNotificationPreferences = create<NotificationPreferencesStore>()((set, get) => ({
  settings: loadFromStorage(),
  initialized: false,

  init: async () => {
    try {
      const res = await fetch("/api/settings/notifications");
      if (res.ok) {
        const data = unwrapApiData<Partial<NotificationSettings>>(await res.json());
        const merged = { ...get().settings, ...data };
        set({ settings: merged, initialized: true });
        saveToStorage(merged);
      } else {
        set({ initialized: true });
      }
    } catch {
      set({ initialized: true });
    }
  },

  updateSettings: async (updates) => {
    const newSettings = { ...get().settings, ...updates };
    set({ settings: newSettings });
    saveToStorage(newSettings);

    try {
      await fetch("/api/settings/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSettings),
      });
    } catch (error) {
      console.error("failed to save notification preferences:", error);
    }
  },

  updatePreference: async (category, channels) => {
    const settings = get().settings;
    const preferences = settings.preferences.map((pref) =>
      pref.category === category
        ? { ...pref, channels: { ...pref.channels, ...channels } }
        : pref
    );

    const newSettings = { ...settings, preferences };
    set({ settings: newSettings });
    saveToStorage(newSettings);

    try {
      await fetch("/api/settings/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSettings),
      });
    } catch (error) {
      console.error("failed to save notification preferences:", error);
    }
  },

  toggleQuietHours: () => {
    const settings = get().settings;
    const newSettings = {
      ...settings,
      quiet_hours: { ...settings.quiet_hours, enabled: !settings.quiet_hours.enabled },
    };
    set({ settings: newSettings });
    saveToStorage(newSettings);
  },

  setQuietHours: (start, end) => {
    const settings = get().settings;
    const newSettings = {
      ...settings,
      quiet_hours: { ...settings.quiet_hours, start, end },
    };
    set({ settings: newSettings });
    saveToStorage(newSettings);
  },

  setEmail: (email) => {
    const newSettings = { ...get().settings, email };
    set({ settings: newSettings });
    saveToStorage(newSettings);
  },

  isChannelEnabled: (category, channel) => {
    const { settings } = get();
    if (!settings.enabled) return false;

    const preference = settings.preferences.find((p) => p.category === category);
    return preference?.channels[channel] ?? false;
  },

  isInQuietHours: () => {
    const { settings } = get();
    if (!settings.quiet_hours.enabled) return false;

    const now = new Date();
    const currentTime = now.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      timeZone: settings.quiet_hours.timezone,
    });

    const { start, end } = settings.quiet_hours;
    return currentTime >= start && currentTime <= end;
  },
}));

// helper to check if a notification should be sent
export function shouldNotify(category: NotificationCategory, channel: NotificationChannel): boolean {
  const store = useNotificationPreferences.getState();
  if (!store.settings.enabled) return false;
  if (store.isInQuietHours() && channel === "push") return false;
  return store.isChannelEnabled(category, channel);
}
