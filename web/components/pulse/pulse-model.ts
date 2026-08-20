// Pure OperationsView -> 3D scene model for the Pulse god-mode view.
//
// Everything here is deterministic and side-effect-free so it is trivially
// testable and stable frame-to-frame: node positions never jitter (run angles
// are seeded from an id hash, not array order), and every color/status maps to
// a REAL field on OperationsView (article i — no invented state). The scene
// component turns these MODES into motion; this file decides nothing visual
// beyond palette + layout.

import type { OperationsView, OpsLoopState } from "@/lib/operations/operations-read-model";

export type PulseNodeKind = "core" | "loop" | "run" | "gate" | "queue";

export type PulsePhase = "breathe" | "check" | "alert" | "dim" | "settle";

export interface PulseNode {
  id: string;
  kind: PulseNodeKind;
  label: string;
  sublabel?: string;
  /** Real status string from the read model (loop status / run status / gate kind). */
  status: string;
  color: string; // hex, for three.js materials
  position: [number, number, number];
  radius: number;
  phase: PulsePhase;
  /** Runs only: 0..1 agent completion. */
  progress?: number;
  agentsActive?: number;
  agentsTotal?: number;
  actionUrl?: string;
  /** Tooltip lines (already human-readable). */
  detail: string[];
}

export interface PulseLink {
  id: string;
  from: string;
  to: string;
  kind: "spine" | "dispatch" | "watch";
  active: boolean;
  color: string;
}

export interface PulseScene {
  nodes: PulseNode[];
  links: PulseLink[];
  overall: OperationsView["overall"];
  coreId: string;
}

export type PulseEvent =
  | { type: "dispatch"; runId: string }
  | { type: "complete"; runId: string };

// ---- palette (hex; mirrors chain-flow-graph + operations-sections) ----

export const PULSE_COLORS = {
  core: "#f59e0b", // amber — the worker heart / mentiko accent
  healthy: "#34d399", // emerald — loop running
  stopped: "#f87171", // red — loop stopped / run failed
  stale: "#fbbf24", // amber — loop stale
  blocked: "#fb923c", // orange — run/task blocked
  complete: "#4ade80", // green — settled
  gate: "#fbbf24", // amber beacon — needs a human
  queue: "#64748b", // slate — pending work (dim)
  // run kinds (match SYSTEM_CHAIN_KINDS in the read model)
  execution: "#f59e0b",
  recommendation: "#22d3ee",
  generation: "#a78bfa",
  audit: "#60a5fa",
  task_generation: "#4ade80",
  decision: "#e879f9",
} as const;

const RUN_KIND_COLOR: Record<string, string> = {
  execution: PULSE_COLORS.execution,
  recommendation: PULSE_COLORS.recommendation,
  generation: PULSE_COLORS.generation,
  audit: PULSE_COLORS.audit,
  task_generation: PULSE_COLORS.task_generation,
  decision: PULSE_COLORS.decision,
};

const LOOP_RING_RADIUS = 5;
const RUN_RING_RADIUS = 10;
const GATE_RING_RADIUS = 2.6;
const QUEUE_RING_RADIUS = 6.5;
const TAU = Math.PI * 2;

/** Small stable string hash -> unsigned int (djb2). Keeps run orbs from jumping. */
export function hashId(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

function loopColor(loop: OpsLoopState): string {
  if (loop.status === "stopped" || loop.lastError) return PULSE_COLORS.stopped;
  if (loop.stale) return PULSE_COLORS.stale;
  return PULSE_COLORS.healthy;
}

function loopPhase(loop: OpsLoopState): PulsePhase {
  if (loop.status === "stopped") return "dim";
  if (loop.stale || loop.lastError) return "alert";
  // "checking" if a poll landed within the last ~8s, else a resting breathe.
  if (loop.lastCheck) {
    const age = Date.now() - Date.parse(loop.lastCheck);
    if (age >= 0 && age < 8000) return "check";
  }
  return "breathe";
}

function loopDetail(name: string, loop: OpsLoopState): string[] {
  const lines = [`${name}: ${loop.status}${loop.stale ? " (stale)" : ""}`];
  lines.push(loop.lastCheck ? `last check ${new Date(loop.lastCheck).toLocaleTimeString()}` : "no check recorded");
  if (loop.lastError) lines.push(`error: ${loop.lastError}`);
  return lines;
}

function runColor(kind: string, status: string): string {
  const s = status.toLowerCase();
  if (s === "failed" || s === "error") return PULSE_COLORS.stopped;
  if (s === "blocked") return PULSE_COLORS.blocked;
  return RUN_KIND_COLOR[kind] ?? PULSE_COLORS.execution;
}

const SKELETON_LOOPS = ["auto-run", "chain-watcher", "decision reconciler", "watchdog"];

/** Dim structural placeholder shown before the first snapshot lands (never a blank void). */
function skeletonScene(): PulseScene {
  const coreId = "loop:worker";
  const nodes: PulseNode[] = [{
    id: coreId, kind: "core", label: "worker", sublabel: "orchestrator",
    status: "connecting", color: PULSE_COLORS.queue, position: [0, 0, 0], radius: 1.5,
    phase: "dim", detail: ["waiting for /api/operations/timeline"],
  }];
  const links: PulseLink[] = [];
  SKELETON_LOOPS.forEach((label, i) => {
    const a = (i / SKELETON_LOOPS.length) * TAU;
    const id = `loop:skeleton:${i}`;
    nodes.push({
      id, kind: "loop", label, status: "connecting", color: PULSE_COLORS.queue,
      position: [Math.cos(a) * LOOP_RING_RADIUS, 0, Math.sin(a) * LOOP_RING_RADIUS],
      radius: 0.85, phase: "dim", detail: ["connecting…"],
    });
    links.push({ id: `spine:${id}`, from: coreId, to: id, kind: "spine", active: false, color: PULSE_COLORS.queue });
  });
  return { nodes, links, overall: "idle", coreId };
}

/**
 * Build the full scene graph from a single OperationsView snapshot.
 * Deterministic: same view -> same nodes/links/positions.
 */
export function buildScene(view: OperationsView | null): PulseScene {
  const nodes: PulseNode[] = [];
  const links: PulseLink[] = [];

  if (!view) return skeletonScene();

  const sys = view.system;
  const coreId = "loop:worker";

  // --- core (worker heart) ---
  const workerStopped = sys.worker.status === "stopped";
  nodes.push({
    id: coreId,
    kind: "core",
    label: "worker",
    sublabel: "orchestrator",
    status: sys.worker.status,
    color: workerStopped ? PULSE_COLORS.stopped : PULSE_COLORS.core,
    position: [0, 0, 0],
    radius: 1.5,
    phase: loopPhase(sys.worker),
    detail: loopDetail("worker", sys.worker),
  });

  // --- 4 loop satellites on an inner ring ---
  const loops: Array<{ id: string; label: string; loop: OpsLoopState }> = [
    { id: "loop:autoRun", label: "auto-run", loop: sys.autoRun },
    { id: "loop:chainWatcher", label: "chain-watcher", loop: sys.chainWatcher },
    { id: "loop:decisionReconciler", label: "decision reconciler", loop: sys.decisionReconciler },
    { id: "loop:watchdog", label: "watchdog", loop: sys.watchdog },
  ];
  loops.forEach((l, i) => {
    const a = (i / loops.length) * TAU;
    nodes.push({
      id: l.id,
      kind: "loop",
      label: l.label,
      status: l.loop.status,
      color: loopColor(l.loop),
      position: [Math.cos(a) * LOOP_RING_RADIUS, 0, Math.sin(a) * LOOP_RING_RADIUS],
      radius: 0.85,
      phase: loopPhase(l.loop),
      detail: loopDetail(l.label, l.loop),
    });
    links.push({
      id: `spine:${l.id}`,
      from: coreId,
      to: l.id,
      kind: "spine",
      active: l.loop.status === "running" && !workerStopped,
      color: PULSE_COLORS.core,
    });
  });

  const autoRunId = "loop:autoRun";
  const chainWatcherId = "loop:chainWatcher";

  // --- runs on an outer ring; angle seeded by id hash for stability ---
  view.runningNow.forEach((run) => {
    const id = `run:${run.runId}`;
    const h = hashId(run.runId);
    const a = ((h % 3600) / 3600) * TAU;
    const yTilt = (((h >> 3) % 5) - 2) * 0.9; // spread in Y for real 3D depth
    const total = run.agentsTotal || 0;
    const progress = total > 0 ? Math.min(1, run.agentsComplete / total) : 0;
    const isExec = run.kind === "execution";
    nodes.push({
      id,
      kind: "run",
      label: run.chainName || run.taskTitle || run.runId.slice(0, 8),
      sublabel: run.kind,
      status: run.status,
      color: runColor(run.kind, run.status),
      position: [Math.cos(a) * RUN_RING_RADIUS, yTilt, Math.sin(a) * RUN_RING_RADIUS],
      radius: 0.55 + Math.min(0.5, total * 0.06),
      phase: run.status.toLowerCase() === "blocked" ? "alert" : "breathe",
      progress,
      agentsActive: run.agentsActive,
      agentsTotal: total,
      actionUrl: run.actionUrl,
      detail: [
        `${run.kind} · ${run.status}`,
        run.goal || run.taskTitle || "",
        total > 0 ? `agents ${run.agentsComplete}/${total} (${run.agentsActive} active)` : "",
      ].filter(Boolean),
    });
    // dispatch tether from auto-run; watch tether from chain-watcher (execution only)
    links.push({
      id: `dispatch:${id}`,
      from: isExec ? autoRunId : coreId,
      to: id,
      kind: "dispatch",
      active: true,
      color: isExec ? PULSE_COLORS.execution : run.kind in RUN_KIND_COLOR ? RUN_KIND_COLOR[run.kind] : PULSE_COLORS.core,
    });
    if (isExec) {
      links.push({
        id: `watch:${id}`,
        from: chainWatcherId,
        to: id,
        kind: "watch",
        active: true,
        color: PULSE_COLORS.recommendation,
      });
    }
  });

  // --- human gates: beacons in a top cluster ---
  view.humanGates.forEach((gate, i) => {
    const a = view.humanGates.length > 1 ? (i / view.humanGates.length) * TAU : 0;
    nodes.push({
      id: `gate:${gate.decisionId || gate.runId || gate.taskId || i}`,
      kind: "gate",
      label: gate.kind === "decision" ? "decision" : "review",
      sublabel: gate.title,
      status: gate.status || "waiting",
      color: PULSE_COLORS.gate,
      position: [Math.cos(a) * GATE_RING_RADIUS, 4.2, Math.sin(a) * GATE_RING_RADIUS],
      radius: 0.6,
      phase: "alert",
      actionUrl: gate.actionUrl,
      detail: [gate.title, gate.detail].filter(Boolean),
    });
  });

  // --- queue belt: faint pending-work dots near auto-run (capped, deduped:
  // a task can appear in BOTH upNext and waiting, which would collide on id) ---
  const seenQueue = new Set<string>();
  const queue = [...view.upNext, ...view.waiting].filter((it) => {
    if (seenQueue.has(it.taskId)) return false;
    seenQueue.add(it.taskId);
    return true;
  }).slice(0, 10);
  queue.forEach((item, i) => {
    const a = (i / Math.max(1, queue.length)) * TAU;
    nodes.push({
      id: `queue:${item.taskId}`,
      kind: "queue",
      label: item.title,
      status: "reason" in item ? String(item.reason) : "waiting",
      color: PULSE_COLORS.queue,
      position: [Math.cos(a) * QUEUE_RING_RADIUS - LOOP_RING_RADIUS, -3.2, Math.sin(a) * QUEUE_RING_RADIUS],
      radius: 0.28,
      phase: "dim",
      detail: [item.title, "detail" in item ? String(item.detail) : ""].filter(Boolean),
    });
  });

  return { nodes, links, overall: view.overall, coreId };
}

/** Diff two snapshots to fire one-shot animations (new run dispatches, finished runs settle). */
export function diffScene(prev: PulseScene | null, cur: PulseScene): PulseEvent[] {
  if (!prev) return [];
  const events: PulseEvent[] = [];
  const prevRuns = new Set(prev.nodes.filter((n) => n.kind === "run").map((n) => n.id));
  const curRuns = new Set(cur.nodes.filter((n) => n.kind === "run").map((n) => n.id));
  for (const id of curRuns) {
    if (!prevRuns.has(id)) events.push({ type: "dispatch", runId: id });
  }
  for (const id of prevRuns) {
    if (!curRuns.has(id)) events.push({ type: "complete", runId: id });
  }
  return events;
}
