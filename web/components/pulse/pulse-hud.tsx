"use client";

// HTML overlay for the Pulse view — crisp mentiko-native chrome floating over the
// 3D canvas. Every number is passed through from the read model (OperationsView);
// nothing here invents status. Reuses OVERALL_PILL + TimeAgo from the ops surface.

import { PlayFilled, PauseFilled, TagFilled } from "@aliimam/icons";
import { OVERALL_PILL } from "@/components/operations/operations-sections";
import { TimeAgo } from "@/components/shared/time-ago";
import { cn } from "@/lib/utils";
import { PULSE_COLORS } from "./pulse-model";
import type { PulseHover } from "./pulse-scene";
import type { OperationsView } from "@/lib/operations/operations-read-model";

const LEGEND: Array<{ label: string; color: string }> = [
  { label: "execution", color: PULSE_COLORS.execution },
  { label: "recommendation", color: PULSE_COLORS.recommendation },
  { label: "generation", color: PULSE_COLORS.generation },
  { label: "audit", color: PULSE_COLORS.audit },
  { label: "decision", color: PULSE_COLORS.decision },
  { label: "human gate", color: PULSE_COLORS.gate },
];

function Panel({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-lg border border-white/10 bg-black/45 backdrop-blur-md shadow-xl", className)}>
      {children}
    </div>
  );
}

export function PulseHud({
  view,
  hover,
  paused,
  onTogglePause,
  showLabels,
  onToggleLabels,
}: {
  view: OperationsView | null;
  hover: PulseHover | null;
  paused: boolean;
  onTogglePause: () => void;
  showLabels: boolean;
  onToggleLabels: () => void;
}) {
  const counts = view?.counts;
  const runsActive = counts?.runsActive ?? 0;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 select-none">
      {/* verdict + counts */}
      {view && (
        <Panel className="absolute left-5 top-5 w-64 p-3">
          <div className="flex items-center gap-2">
            <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-[0.14em]", OVERALL_PILL[view.overall])}>
              {view.overall}
            </span>
            <span className="ml-auto text-[10px] text-white/30">
              <TimeAgo date={view.generatedAt} format="short" className="!text-[10px] text-white/30" />
            </span>
          </div>
          {view.overallDetail && <p className="mt-2 text-[11px] leading-snug text-white/50">{view.overallDetail}</p>}
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono text-[11px] text-white/60">
            <Stat label="run slots" value={`${runsActive}/${counts?.maxConcurrentRuns ?? 0}`} hot={runsActive > 0} />
            <Stat label="ready" value={counts?.ready ?? 0} />
            <Stat label="open" value={counts?.tasksOpen ?? 0} />
            <Stat label="in progress" value={counts?.tasksInProgress ?? 0} />
            <Stat label="waiting" value={counts?.waiting ?? 0} />
            <Stat label="gates" value={counts?.humanGates ?? 0} hot={(counts?.humanGates ?? 0) > 0} />
          </div>
        </Panel>
      )}

      {/* controls */}
      <div className="pointer-events-auto absolute right-5 top-5 flex gap-2">
        <button
          type="button"
          onClick={onTogglePause}
          title={paused ? "resume live polling" : "pause live polling"}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-black/45 px-3 text-[11px] text-white/70 backdrop-blur-md transition-colors hover:bg-white/10"
        >
          {paused ? <PlayFilled className="h-3.5 w-3.5" /> : <PauseFilled className="h-3.5 w-3.5" />}
          {paused ? "paused" : "live"}
        </button>
        <button
          type="button"
          onClick={onToggleLabels}
          title="toggle labels"
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-black/45 text-white/70 backdrop-blur-md transition-colors hover:bg-white/10",
            showLabels && "text-amber-400",
          )}
        >
          <TagFilled className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* legend */}
      <Panel className="absolute bottom-5 left-5 p-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">legend</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {LEGEND.map((l) => (
            <div key={l.label} className="flex items-center gap-2 text-[11px] text-white/60">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: l.color, boxShadow: `0 0 8px ${l.color}` }} />
              {l.label}
            </div>
          ))}
        </div>
        <div className="mt-2 border-t border-white/10 pt-2 text-[10px] text-white/35">
          drag to orbit · scroll to zoom · click a node to open
        </div>
      </Panel>

      {/* empty-state hint */}
      {view && runsActive === 0 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-center text-[11px] text-white/35">
          no active runs — the core and loops keep watch. start a run to see the system light up.
        </div>
      )}

      {/* hover tooltip */}
      {hover && (
        <div
          className="pointer-events-none fixed z-20 max-w-xs"
          style={{ left: Math.min(hover.x + 14, window.innerWidth - 280), top: hover.y + 14 }}
        >
          <Panel className="p-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: hover.node.color, boxShadow: `0 0 10px ${hover.node.color}` }} />
              <span className="font-mono text-xs font-semibold text-white/90">{hover.node.label}</span>
              {hover.node.sublabel && <span className="text-[10px] uppercase tracking-wide text-white/40">{hover.node.sublabel}</span>}
            </div>
            {hover.node.detail.map((line, i) => (
              <p key={i} className={cn("mt-1 text-[11px] leading-snug", i === 0 ? "text-white/70" : "text-white/45")}>{line}</p>
            ))}
            {hover.node.actionUrl && <p className="mt-2 text-[10px] text-amber-400/80">click to open →</p>}
          </Panel>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hot }: { label: string; value: React.ReactNode; hot?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-white/35">{label}</span>
      <span className={cn("tabular-nums", hot ? "text-amber-400" : "text-white/80")}>{value}</span>
    </div>
  );
}
