import { buildScene, diffScene, hashId } from "./pulse-model";
import type { OperationsView, OpsLoopState } from "@/lib/operations/operations-read-model";

const loop = (over: Partial<OpsLoopState> = {}): OpsLoopState => ({
  status: "running",
  stale: false,
  lastCheck: new Date().toISOString(),
  ...over,
});

// Minimal view — buildScene only reads system/runningNow/humanGates/upNext/waiting/overall.
function makeView(runs: OperationsView["runningNow"]): OperationsView {
  return {
    system: {
      worker: { ...loop(), startedAt: undefined, pid: 1 },
      autoRun: { ...loop(), lastTriggered: Date.now() },
      watchdog: loop(),
      decisionReconciler: loop(),
      chainWatcher: loop(),
      health: { status: "ok", failing: [], warning: [] },
      mode: "dev",
      recentErrors: [],
      recentRecoveries: [],
      headline: "all good",
    },
    overall: "running",
    runningNow: runs,
    humanGates: [
      { kind: "decision", title: "pick an option", detail: "d", actionUrl: "/tasks?d=1", decisionId: "d1" },
    ],
    upNext: [{ position: 1, taskId: "T2", title: "next up", reason: "ready", detail: "", priority: 1, blockingTaskIds: [], actionUrl: "/tasks/T2" }],
    waiting: [],
    // unused-by-buildScene fields:
    generatedAt: new Date().toISOString(),
    overallDetail: "",
    attention: [],
    recentAccomplishments: [],
    timeline: [],
    taskStates: [],
    dependencyCycleTaskIds: [],
    counts: {
      tasksOpen: 0, tasksInProgress: 0, tasksClosed: 0, runsActive: runs.length,
      maxConcurrentRuns: 3, availableSlots: 3 - runs.length, attention: 0, ready: 1, waiting: 0, humanGates: 1,
    },
  } as unknown as OperationsView;
}

const run = (runId: string, kind: OperationsView["runningNow"][number]["kind"]): OperationsView["runningNow"][number] => ({
  runId, kind, status: "running", agentsTotal: 4, agentsActive: 2, agentsComplete: 1, actionUrl: `/runs/${runId}`,
});

describe("pulse-model", () => {
  it("maps a view to core + 4 loops + runs + gate + queue with the right links", () => {
    const scene = buildScene(makeView([run("r1", "execution"), run("r2", "audit")]));

    expect(scene.nodes.filter((n) => n.kind === "core")).toHaveLength(1);
    expect(scene.nodes.filter((n) => n.kind === "loop")).toHaveLength(4);
    expect(scene.nodes.filter((n) => n.kind === "run")).toHaveLength(2);
    expect(scene.nodes.filter((n) => n.kind === "gate")).toHaveLength(1);
    expect(scene.nodes.filter((n) => n.kind === "queue")).toHaveLength(1);

    // execution run gets BOTH a dispatch and a watch tether; audit run gets dispatch only.
    expect(scene.links.find((l) => l.id === "watch:run:r1")).toBeTruthy();
    expect(scene.links.find((l) => l.id === "watch:run:r2")).toBeFalsy();
    expect(scene.links.find((l) => l.id === "dispatch:run:r2")?.from).toBe("loop:worker");
    expect(scene.links.find((l) => l.id === "dispatch:run:r1")?.from).toBe("loop:autoRun");

    // core is centered; layout is deterministic.
    expect(scene.nodes.find((n) => n.id === "loop:worker")?.position).toEqual([0, 0, 0]);
    expect(buildScene(makeView([run("r1", "execution")])).nodes.find((n) => n.id === "run:r1")?.position)
      .toEqual(buildScene(makeView([run("r1", "execution")])).nodes.find((n) => n.id === "run:r1")?.position);
  });

  it("stopped loop turns red and dims; core stays amber when worker runs", () => {
    const view = makeView([]);
    view.system.watchdog = { status: "stopped", stale: false };
    const scene = buildScene(view);
    const wd = scene.nodes.find((n) => n.id === "loop:watchdog");
    expect(wd?.color).toBe("#f87171");
    expect(wd?.phase).toBe("dim");
    expect(scene.nodes.find((n) => n.id === "loop:worker")?.color).toBe("#f59e0b");
  });

  it("diffScene reports a newly-appeared run as a dispatch and a vanished run as complete", () => {
    const a = buildScene(makeView([run("r1", "execution")]));
    const b = buildScene(makeView([run("r1", "execution"), run("r2", "execution")]));
    expect(diffScene(a, b)).toEqual([{ type: "dispatch", runId: "run:r2" }]);
    expect(diffScene(b, a)).toEqual([{ type: "complete", runId: "run:r2" }]);
    expect(diffScene(null, b)).toEqual([]);
  });

  it("hashId is stable and unsigned", () => {
    expect(hashId("run:abc")).toBe(hashId("run:abc"));
    expect(hashId("run:abc")).toBeGreaterThanOrEqual(0);
  });
});
