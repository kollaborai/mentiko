"use client";

// Reusable Pulse surface: polls the operations read model, builds the scene, and
// renders the 3D canvas + HUD to fill its parent. Used by both the full-page /pulse
// route and the "Pulse" tab on /activity, so the two never drift.

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { buildScene } from "./pulse-model";
import { PulseHud } from "./pulse-hud";
import type { PulseHover } from "./pulse-scene";
import type { OperationsView } from "@/lib/operations/operations-read-model";

const PulseSceneCanvas = dynamic(() => import("./pulse-scene"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <WaveSpinner size="sm" color="primary" animation="ripple" />
    </div>
  ),
});

const POLL_MS = 4000;

export function PulseView() {
  const { fetchWithNamespace } = useNamespaceFetch();
  const router = useRouter();
  const [view, setView] = useState<OperationsView | null>(null);
  const [hover, setHover] = useState<PulseHover | null>(null);
  const [paused, setPaused] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetchWithNamespace("/api/operations/timeline");
      const data = (await res.json()) as { view: OperationsView | null };
      if (data?.view) setView(data.view);
    } catch {
      // keep last good view; the loop retries on the next tick
    } finally {
      inFlight.current = false;
    }
  }, [fetchWithNamespace]);

  useEffect(() => {
    load();
    if (paused) return;
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load, paused]);

  const scene = useMemo(() => buildScene(view), [view]);
  const onSelect = useCallback((url: string) => router.push(url), [router]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#060607]">
      <div className="absolute inset-0">
        <PulseSceneCanvas scene={scene} showLabels={showLabels} onHover={setHover} onSelect={onSelect} />
      </div>
      <PulseHud
        view={view}
        hover={hover}
        paused={paused}
        onTogglePause={() => setPaused((p) => !p)}
        showLabels={showLabels}
        onToggleLabels={() => setShowLabels((s) => !s)}
      />
    </div>
  );
}
