"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Element3Filled, ColorSwatchFilled, Setting2Filled } from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import { cn } from "@/lib/utils";
import {
  usePillNavPreferences,
  COLOR_SCHEME_SWATCH,
  COLOR_SCHEME_LABELS,
  COLOR_SCHEME_GRADIENTS,
  type PillNavColorScheme,
} from "@/lib/pill-nav-preferences";

const SCALE_KEY = "mentiko-pill-scale";
const SCALE_CHANGE_EVENT = "mentiko-pill-scale-change";
const SCHEMES: PillNavColorScheme[] = ["rainbow", "blue", "green", "pink", "purple", "amber", "cyan"];

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
  const { prefs, setColorScheme, setShowRecents, setNavigationMode } = usePillNavPreferences();
  const scale = usePillScale();
  const [status, setStatus] = useState<string | null>(null);

  const handleScaleChange = useCallback((value: number) => {
    const clamped = Math.min(1.6, Math.max(0.6, Math.round(value * 20) / 20));
    savePillScale(clamped);
  }, []);

  const handleReset = () => {
    setColorScheme("rainbow");
    setShowRecents(true);
    setNavigationMode("page");
    handleScaleChange(1);
    setStatus("reset");
    setTimeout(() => setStatus(null), 2000);
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

            <div className="grid grid-cols-4 sm:grid-cols-7 gap-3 mt-3">
              {SCHEMES.map((scheme) => {
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
                  backgroundImage: `radial-gradient(transparent, transparent, ${COLOR_SCHEME_GRADIENTS[prefs.colorScheme]}, transparent, transparent)`,
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
