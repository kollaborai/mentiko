"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Element3Filled, ColorSwatchFilled, Setting2Filled } from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import { cn } from "@/lib/utils";
import {
  usePillNavPreferences,
  DEFAULT_PILL_NAV_COLOR_SCHEME,
  DEFAULT_PILL_NAV_CUSTOM_GLOW_COLORS,
  PILL_NAV_PRESET_COLOR_SCHEMES,
  COLOR_SCHEME_SWATCH,
  COLOR_SCHEME_LABELS,
  getPillNavShineGradient,
} from "@/lib/pill-nav-preferences";

const SCALE_KEY = "mentiko-pill-scale";
const SCALE_CHANGE_EVENT = "mentiko-pill-scale-change";

function loadPillScale(): number {
  try {
    const s = localStorage.getItem(SCALE_KEY);
    if (s) { const n = parseFloat(s); if (n >= 0.6 && n <= 1.6) return n; }
  } catch { /* ignore */ }
  return 1;
}

function savePillScale(scale: number) {
  try {
    localStorage.setItem(SCALE_KEY, JSON.stringify(scale));
    window.dispatchEvent(new Event(SCALE_CHANGE_EVENT));
  } catch { /* ignore */ }
}

function subscribePillScale(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(SCALE_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(SCALE_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function usePillScale() {
  return useSyncExternalStore(subscribePillScale, loadPillScale, () => 1);
}

export default function PillNavSettingsPage() {
  const { prefs, setColorScheme, setCustomGlowColors, setShowRecents, setNavigationMode } = usePillNavPreferences();
  const scale = usePillScale();
  const [status, setStatus] = useState<string | null>(null);
  const shineGradient = getPillNavShineGradient(prefs);

  const handleScaleChange = useCallback((value: number) => {
    const clamped = Math.min(1.6, Math.max(0.6, Math.round(value * 20) / 20));
    savePillScale(clamped);
  }, []);

  const handleReset = () => {
    setCustomGlowColors(DEFAULT_PILL_NAV_CUSTOM_GLOW_COLORS);
    setColorScheme(DEFAULT_PILL_NAV_COLOR_SCHEME);
    setShowRecents(true);
    setNavigationMode("page");
    handleScaleChange(1);
    setStatus("reset");
    setTimeout(() => setStatus(null), 2000);
  };

  const handleCustomColorChange = (index: number, color: string) => {
    const nextColors = [...prefs.customGlowColors];
    nextColors[index] = color;
    setCustomGlowColors(nextColors);
  };

  return (
    <div className="flex-1 overflow-auto">
      <PageBanner
        title="Navigation Bar"
        subtitle="Customize the floating pill navigation bar. Change colors, size, and toggle features."
        icon={Element3Filled}
        sectionColor="#a0927b"
        actions={[
          { label: "Appearance", href: "/settings/appearance", icon: ColorSwatchFilled, iconColor: "#a0927b" },
          { label: "Settings", href: "/settings", icon: Setting2Filled, iconColor: "#a0927b" },
        ]}
      />
      <div className="px-4 py-3 max-w-4xl mx-auto">
        <div className="space-y-6">

          {/* color scheme */}
          <div className="bg-card rounded-md p-6 space-y-4">
            <h2 className="text-sm font-semibold">Border Glow</h2>
            <p className="text-xs text-muted-foreground">
              Choose the animated shine color around the navigation bar, terminal, and code panels.
            </p>

            <div className="grid grid-cols-4 sm:grid-cols-8 gap-3 mt-3">
              {PILL_NAV_PRESET_COLOR_SCHEMES.map((scheme) => {
                const isActive = prefs.colorScheme === scheme;
                const swatch = COLOR_SCHEME_SWATCH[scheme];
                const isGradient = swatch.includes("gradient");
                return (
                  <button
                    key={scheme}
                    onClick={() => setColorScheme(scheme)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 p-2 rounded-md transition-all",
                      isActive ? "bg-accent ring-1 ring-primary" : "hover:bg-muted"
                    )}
                  >
                    <div
                      className={cn(
                        "h-8 w-8 rounded-full transition-transform",
                        isActive && "scale-110"
                      )}
                      style={{ background: isGradient ? swatch : swatch }}
                    />
                    <span className="text-[10px] text-muted-foreground">{COLOR_SCHEME_LABELS[scheme]}</span>
                  </button>
                );
              })}
            </div>

            <div className="rounded-md bg-muted p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-medium">Custom Builder</h3>
                  <p className="text-[11px] text-muted-foreground">Pick up to five glow stops.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setCustomGlowColors(prefs.customGlowColors)}
                  className={cn(
                    "h-7 px-2 rounded-md text-[11px] transition-colors",
                    prefs.colorScheme === "custom" ? "bg-accent text-foreground" : "bg-background hover:bg-accent/60"
                  )}
                >
                  use custom
                </button>
              </div>

              <div className="grid grid-cols-5 gap-2">
                {prefs.customGlowColors.map((color, index) => (
                  <label key={`${index}-${color}`} className="min-w-0 space-y-1">
                    <span className="block text-[10px] text-muted-foreground">stop {index + 1}</span>
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => handleCustomColorChange(index, e.target.value)}
                      className="h-8 w-full rounded-sm border-0 bg-transparent p-0 cursor-pointer"
                    />
                    <span className="block h-7 truncate rounded-sm bg-background px-1.5 py-1.5 text-[10px] font-mono uppercase text-muted-foreground">
                      {color}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* live preview */}
            <div className="mt-4 relative h-10 rounded-xl overflow-hidden bg-muted">
              <style>{`
                @keyframes sb-shine-pulse {
                  0%   { background-position: 0% 0%; }
                  50%  { background-position: 100% 100%; }
                  100% { background-position: 0% 0%; }
                }
              `}</style>
              <div
                aria-hidden="true"
                className="absolute inset-0 rounded-xl pointer-events-none"
                style={{
                  padding: "2px",
                  backgroundImage: `radial-gradient(transparent, transparent, ${shineGradient}, transparent, transparent)`,
                  backgroundSize: "300% 300%",
                  animation: "sb-shine-pulse 14s linear infinite",
                  WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
                  WebkitMaskComposite: "xor" as React.CSSProperties["WebkitMaskComposite"],
                  mask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
                  maskComposite: "exclude" as unknown as string,
                }}
              />
              <div className="absolute inset-[2px] rounded-[10px] bg-card flex items-center justify-center">
                <span className="text-[10px] text-muted-foreground">preview</span>
              </div>
            </div>
          </div>

          {/* scale */}
          <div className="bg-card rounded-md p-6 space-y-4">
            <h2 className="text-sm font-semibold">Size</h2>
            <p className="text-xs text-muted-foreground">
              Adjust the overall scale of the navigation bar. You can also scroll on the drag handle to resize live.
            </p>

            <div className="flex items-center gap-4 mt-2">
              <Label className="text-xs w-8 text-right">{Math.round(scale * 100)}%</Label>
              <input
                type="range"
                min={0.6}
                max={1.6}
                step={0.05}
                value={scale}
                onChange={(e) => handleScaleChange(parseFloat(e.target.value))}
                className="flex-1 accent-primary h-1"
              />
              <div className="flex gap-1">
                <button
                  onClick={() => handleScaleChange(0.8)}
                  className={cn("px-2 py-1 rounded text-[10px]", scale === 0.8 ? "bg-accent" : "bg-muted hover:bg-accent/50")}
                >
                  small
                </button>
                <button
                  onClick={() => handleScaleChange(1)}
                  className={cn("px-2 py-1 rounded text-[10px]", scale === 1 ? "bg-accent" : "bg-muted hover:bg-accent/50")}
                >
                  default
                </button>
                <button
                  onClick={() => handleScaleChange(1.3)}
                  className={cn("px-2 py-1 rounded text-[10px]", scale === 1.3 ? "bg-accent" : "bg-muted hover:bg-accent/50")}
                >
                  large
                </button>
              </div>
            </div>
          </div>

          {/* features */}
          <div className="bg-card rounded-md p-6 space-y-4">
            <h2 className="text-sm font-semibold">Features</h2>

            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <p className="text-sm">Show Recents</p>
                  <p className="text-xs text-muted-foreground">
                    Display recently visited pages as quick-access pills in the navigation bar.
                  </p>
                </div>
                <Switch checked={prefs.showRecents} onCheckedChange={setShowRecents} />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <p className="text-sm">Open Pages in Panels</p>
                  <p className="text-xs text-muted-foreground">
                    Launch floating navigation routes in a movable app panel instead of replacing the current page.
                  </p>
                </div>
                <Switch
                  checked={prefs.navigationMode === "floating-nav-panels"}
                  onCheckedChange={(enabled) =>
                    setNavigationMode(enabled ? "floating-nav-panels" : "page")
                  }
                />
              </div>
            </div>
          </div>

          {/* actions */}
          <div className="flex items-center justify-between">
            <button
              onClick={handleReset}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Reset to defaults
            </button>
            {status && (
              <span className="text-xs text-green-500">{status}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
