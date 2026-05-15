"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "@/hooks/use-translation";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useTheme } from "next-themes";
import { MonitorFilled, SunFilled, MoonFilled, ColorSwatchFilled, UserFilled, NotificationFilled } from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import { cn } from "@/lib/utils";
import {
  FLOATING_PANEL_TRANSPARENCY_DEFAULT,
  FLOATING_PANEL_TRANSPARENCY_MAX,
  FLOATING_PANEL_TRANSPARENCY_MIN,
  USER_ACCENT_OKLCH,
  USER_FONT_SIZE_MAP,
  USER_PREFERENCES_STORAGE_KEY,
  applyUserDisplayPreferences,
  clampFloatingPanelTransparency,
  type UserAccentColorPreference,
  type UserFontSizePreference,
} from "@/lib/user-display-preferences";

type Theme = "dark" | "light" | "system";

interface Preferences {
  accentColor: UserAccentColorPreference;
  fontSize: UserFontSizePreference;
  floatingPanelTransparency: number;
  autoSave: boolean;
  streamOutput: boolean;
}

function applyFontSize(fontSize: string) {
  applyUserDisplayPreferences({ fontSize: fontSize as UserFontSizePreference });
}

function applyAccentColor(accentColor: UserAccentColorPreference) {
  applyUserDisplayPreferences({ accentColor });
}

function applyFloatingPanelTransparency(floatingPanelTransparency: number) {
  applyUserDisplayPreferences({ floatingPanelTransparency });
}

export default function AppearancePage() {
  const { t } = useTranslations();
  const { theme: currentTheme, setTheme } = useTheme();
  const [status, setStatus] = useState<string | null>(null);

  const defaultPrefs: Preferences = {
    accentColor: "blue",
    fontSize: "md",
    floatingPanelTransparency: FLOATING_PANEL_TRANSPARENCY_DEFAULT,
    autoSave: true,
    streamOutput: true,
  };
  const [prefs, setPrefs] = useState<Preferences>(() => {
    // hydrate from localStorage on first render (client-side only)
    if (typeof window === "undefined") return defaultPrefs;
    try {
      const stored = localStorage.getItem(USER_PREFERENCES_STORAGE_KEY);
      if (stored) {
        const parsed = { ...defaultPrefs, ...JSON.parse(stored) };
        return {
          ...parsed,
          floatingPanelTransparency: clampFloatingPanelTransparency(parsed.floatingPanelTransparency),
        };
      }
    } catch { /* ignore */ }
    return defaultPrefs;
  });

  // live preview font size changes
  useEffect(() => {
    applyFontSize(prefs.fontSize);
  }, [prefs.fontSize]);

  useEffect(() => {
    applyFloatingPanelTransparency(prefs.floatingPanelTransparency);
  }, [prefs.floatingPanelTransparency]);

  const handleSave = () => {
    localStorage.setItem(USER_PREFERENCES_STORAGE_KEY, JSON.stringify(prefs));
    applyFontSize(prefs.fontSize);
    applyAccentColor(prefs.accentColor);
    applyFloatingPanelTransparency(prefs.floatingPanelTransparency);
    setStatus("saved");
    setTimeout(() => setStatus(null), 2000);
  };

  return (
    <div className="flex-1 overflow-auto" data-source="app/settings/appearance/page.tsx">
      <PageBanner
        title="Appearance"
        subtitle="Customize your visual experience. Choose a theme, accent color, and font size."
        icon={ColorSwatchFilled}
        sectionColor="#a0927b"
        actions={[
          { label: "Account", href: "/settings/account", icon: UserFilled, iconColor: "#a0927b" },
          { label: "Notifications", href: "/settings/notifications", icon: NotificationFilled, iconColor: "#a0927b" },
        ]}
      />
      <div className="px-4 py-3 max-w-4xl mx-auto">
        <div className="space-y-6">
          <div className="bg-card rounded-md p-6 space-y-6">
            <h2 className="text-sm font-semibold">{t("settings.appearance")}</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <Label className="text-xs">{t("settings.theme")}</Label>
                <div className="flex gap-2 mt-2">
                  {(["system", "light", "dark"] as Theme[]).map((mode) => {
                    const isActive = (currentTheme ?? "dark") === mode;
                    return (
                      <button
                        key={mode}
                        onClick={() => setTheme(mode)}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-all",
                          isActive ? "bg-accent" : "bg-muted hover:bg-accent/50"
                        )}
                      >
                        {mode === "system" && <MonitorFilled className="h-3.5 w-3.5" />}
                        {mode === "light" && <SunFilled className="h-3.5 w-3.5" />}
                        {mode === "dark" && <MoonFilled className="h-3.5 w-3.5" />}
                        <span>{mode === "system" ? "Auto" : mode}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <Label className="text-xs">{t("settings.accent")}</Label>
                <div className="flex gap-2 mt-2">
                  {(Object.keys(USER_ACCENT_OKLCH) as UserAccentColorPreference[]).map((color) => (
                    <button
                      key={color}
                      onClick={() => setPrefs((prev) => ({ ...prev, accentColor: color }))}
                      className={cn(
                        "h-6 w-6 rounded-full transition-all",
                        prefs.accentColor === color ? "scale-125 ring-2 ring-offset-2 ring-offset-background" : ""
                      )}
                      style={{
                        backgroundColor:
                          color === "blue" ? "#3b82f6" :
                          color === "purple" ? "#a855f7" :
                          color === "green" ? "#22c55e" :
                          color === "orange" ? "#f97316" : "#ec4899",
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div>
              <Label className="text-xs">{t("settings.fontSize")}</Label>
              <div className="flex gap-2 mt-2">
                {(Object.keys(USER_FONT_SIZE_MAP) as UserFontSizePreference[]).map((size) => (
                  <button
                    key={size}
                    onClick={() => setPrefs((prev) => ({ ...prev, fontSize: size }))}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-xs",
                      prefs.fontSize === size ? "bg-foreground text-background" : "bg-muted hover:bg-accent"
                    )}
                  >
                    {size === "sm" ? "small" : size === "md" ? "medium" : "large"}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label htmlFor="floating-panel-transparency" className="text-xs">
                    {t("settings.floatingPanelTransparency")}
                  </Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("settings.floatingPanelTransparencyDesc")}
                  </p>
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {prefs.floatingPanelTransparency}%
                </span>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <span className="text-[10px] text-muted-foreground">dots</span>
                <input
                  id="floating-panel-transparency"
                  type="range"
                  min={FLOATING_PANEL_TRANSPARENCY_MIN}
                  max={FLOATING_PANEL_TRANSPARENCY_MAX}
                  step={1}
                  value={prefs.floatingPanelTransparency}
                  onChange={(e) => {
                    const nextValue = clampFloatingPanelTransparency(e.target.value);
                    setPrefs((prev) => ({ ...prev, floatingPanelTransparency: nextValue }));
                  }}
                  className="h-1 flex-1 accent-primary"
                />
                <span className="text-[10px] text-muted-foreground">solid</span>
              </div>
            </div>

          </div>

          <div className="bg-card rounded-md p-6 space-y-4">
            <h2 className="text-sm font-semibold">{t("settings.behavior")}</h2>

            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <p className="text-sm">{t("settings.autoSave")}</p>
                  <p className="text-xs text-muted-foreground">{t("settings.autoSaveDesc")}</p>
                </div>
                <Switch
                  checked={prefs.autoSave}
                  onCheckedChange={(v) => setPrefs((prev) => ({ ...prev, autoSave: v }))}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <p className="text-sm">{t("settings.streamOutput")}</p>
                  <p className="text-xs text-muted-foreground">{t("settings.streamOutputDesc")}</p>
                </div>
                <Switch
                  checked={prefs.streamOutput}
                  onCheckedChange={(v) => setPrefs((prev) => ({ ...prev, streamOutput: v }))}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            {status && (
              <span className="text-xs text-green-500">{status}</span>
            )}
            <Button size="sm" onClick={handleSave}>
              {t("settings.savePreferences")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
