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

type Theme = "dark" | "light" | "system";
type AccentColor = "blue" | "purple" | "green" | "orange" | "pink";

interface Preferences {
  accentColor: AccentColor;
  fontSize: "sm" | "md" | "lg";
  autoSave: boolean;
  streamOutput: boolean;
}

const FONT_SIZE_MAP: Record<string, string> = {
  sm: "13px",
  md: "15px",
  lg: "17px",
};

// oklch values for primary/ring CSS variables
const ACCENT_OKLCH: Record<AccentColor, string> = {
  blue:   "0.56 0.22 264.5",
  purple: "0.59 0.25 300.4",
  green:  "0.65 0.20 142.3",
  orange: "0.68 0.19 42.9",
  pink:   "0.63 0.24 0.6",
};

function applyFontSize(fontSize: string) {
  document.documentElement.style.fontSize = FONT_SIZE_MAP[fontSize] || "15px";
}

function applyAccentColor(accentColor: AccentColor) {
  const oklch = ACCENT_OKLCH[accentColor];
  if (oklch) {
    document.documentElement.style.setProperty("--primary", `oklch(${oklch})`);
    document.documentElement.style.setProperty("--ring", `oklch(${oklch})`);
  }
}

export default function AppearancePage() {
  const { t } = useTranslations();
  const { theme: currentTheme, setTheme } = useTheme();
  const [status, setStatus] = useState<string | null>(null);

  const defaultPrefs: Preferences = { accentColor: "blue", fontSize: "md", autoSave: true, streamOutput: true };
  const [prefs, setPrefs] = useState<Preferences>(() => {
    // hydrate from localStorage on first render (client-side only)
    if (typeof window === "undefined") return defaultPrefs;
    try {
      const stored = localStorage.getItem("user-preferences");
      if (stored) return { ...defaultPrefs, ...JSON.parse(stored) };
    } catch { /* ignore */ }
    return defaultPrefs;
  });

  // live preview font size changes
  useEffect(() => {
    applyFontSize(prefs.fontSize);
  }, [prefs.fontSize]);

  const handleSave = () => {
    localStorage.setItem("user-preferences", JSON.stringify(prefs));
    applyFontSize(prefs.fontSize);
    applyAccentColor(prefs.accentColor);
    setStatus("saved");
    setTimeout(() => setStatus(null), 2000);
  };

  return (
    <div className="flex-1 overflow-auto">
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
                  {(["blue", "purple", "green", "orange", "pink"] as AccentColor[]).map((color) => (
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
                {(["sm", "md", "lg"] as const).map((size) => (
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
