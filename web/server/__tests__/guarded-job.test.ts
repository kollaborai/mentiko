// issue #136: one failing worker job must not exit the worker process.
import { readFileSync } from "fs";
import { join } from "path";
import { createBoundedJob, getOverrunningJobs, runGuardedJob, type GuardedJobDeps } from "../guarded-job";

function recordingDeps() {
  const entries: Array<{ nsId: string; orgId: string; level: string; source: string; message: string; detail?: string }> = [];
  const deps: GuardedJobDeps = {
    nsId: "ns-test",
    orgId: "org-test",
    writeLog: (nsId, orgId, level, source, message, detail) => {
      entries.push({ nsId, orgId, level, source, message, detail });
    },
  };
  return { deps, entries };
}

describe("runGuardedJob", () => {
  it("catches a throwing job, logs job name and stack to the system log, and resolves", async () => {
    const { deps, entries } = recordingDeps();
    await expect(
      runGuardedJob("decision-reconciler", () => { throw new Error("boom"); }, deps),
    ).resolves.toBeUndefined();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      nsId: "ns-test",
      orgId: "org-test",
      level: "error",
      source: "worker",
    });
    expect(entries[0].message).toContain("decision-reconciler");
    expect(entries[0].message).toContain("boom");
    expect(entries[0].detail).toContain("boom");
    expect(entries[0].detail).toContain("at "); // stack, not just the message
  });

  it("catches a rejected async job the same way", async () => {
    const { deps, entries } = recordingDeps();
    await expect(
      runGuardedJob("watchdog", () => Promise.reject(new Error("async boom")), deps),
    ).resolves.toBeUndefined();
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toContain("watchdog");
  });

  it("a failed job does not stop the next tick from running", async () => {
    const { deps } = recordingDeps();
    await runGuardedJob("reconciler", () => { throw new Error("first tick dies"); }, deps);
    let ran = false;
    await runGuardedJob("reconciler", async () => { ran = true; }, deps);
    expect(ran).toBe(true);
  });

  it("does not log anything when the job succeeds", async () => {
    const { deps, entries } = recordingDeps();
    await runGuardedJob("external-drain", () => Promise.resolve("ok"), deps);
    expect(entries).toHaveLength(0);
  });
});

describe("createBoundedJob (issue #136: a job that never settles)", () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("logs an overrun once with the job name, keeps the flag held, and surfaces it for health", async () => {
    const { deps, entries } = recordingDeps();
    let secondRan = false;
    const body = jest.fn()
      .mockImplementationOnce(() => new Promise<void>(() => { /* never settles */ }))
      .mockImplementationOnce(async () => { secondRan = true; });
    const run = createBoundedJob("watchdog", (label) => body(label), deps, 20);

    // a hung tick is fire-and-forget in the worker — never awaited
    void run("startup");
    await sleep(60);

    const overrun = entries.filter((e) => e.message.includes("still in flight"));
    expect(overrun).toHaveLength(1); // once per overrun, not once per interval
    expect(overrun[0].message).toContain("watchdog");
    expect(overrun[0].level).toBe("warn");
    expect(overrun[0].detail).toContain("watchdog");

    // the job is listed as overrunning while it stays in flight (health input)
    expect(getOverrunningJobs()).toContain("watchdog");

    // the in-flight flag is NOT released: no overlapping execution, ever
    await run("periodic");
    expect(secondRan).toBe(false);
    expect(body).toHaveBeenCalledTimes(1);
  });

  it("clears the overrun state once the body settles, and the next tick runs", async () => {
    const { deps } = recordingDeps();
    let release: (() => void) | null = null;
    let hang = true;
    const run = createBoundedJob("external-drain", () => new Promise<void>((r) => {
      if (hang) release = r; else r();
    }), deps, 20);

    void run("first");
    await sleep(40);
    expect(getOverrunningJobs()).toContain("external-drain");

    release!();
    await sleep(10); // let the settled body release the flag
    hang = false;
    await run("second"); // flag was released on settle, so this tick runs
    expect(getOverrunningJobs()).not.toContain("external-drain");
  });

  it("does not start a second run while one is in flight", async () => {
    const { deps } = recordingDeps();
    const calls: string[] = [];
    let release: (() => void) | null = null;
    const run = createBoundedJob("external-drain", (label) => {
      calls.push(label);
      return new Promise<void>((r) => { release = r; });
    }, deps, 60_000);

    void run("first");
    await run("second"); // returns immediately: in flight
    expect(calls).toEqual(["first"]);

    release!();
    await sleep(5);
  });

  it("does not log an overrun when the body settles inside the threshold", async () => {
    const { deps, entries } = recordingDeps();
    const run = createBoundedJob("launch-jobs", async () => { await sleep(10); }, deps, 5_000);
    await run("startup");
    expect(entries).toHaveLength(0);
    expect(getOverrunningJobs()).not.toContain("launch-jobs");
  });

  it("still isolates a throwing body like runGuardedJob", async () => {
    const { deps, entries } = recordingDeps();
    const run = createBoundedJob("reconciler", () => { throw new Error("bounded boom"); }, deps, 60_000);
    await expect(run("startup")).resolves.toBeUndefined();
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toContain("reconciler");
    expect(entries[0].detail).toContain("bounded boom");
  });
});

describe("background-worker startup wiring (codex rev2 P1)", () => {
  it("installs every periodic timer and the heartbeat before startup jobs fire, and awaits none of them", () => {
    const source = readFileSync(join(__dirname, "..", "background-worker.ts"), "utf8");
    const timers = [
      "reconcileInterval = setInterval",
      "decisionReconcileInterval = setInterval",
      "externalDrainInterval = setInterval",
      "watchdogInterval = setInterval",
      "launchJobInterval = setInterval",
      "workspaceCleanupInterval = setInterval",
      "heartbeatInterval = setInterval",
    ].map((needle) => source.indexOf(needle));
    for (const at of timers) expect(at).toBeGreaterThan(-1);

    const startupPass = source.indexOf("startup pass, fire-and-forget");
    expect(startupPass).toBeGreaterThan(-1);
    // every timer is installed before the startup pass fires
    for (const at of timers) expect(at).toBeLessThan(startupPass);
    // no startup or periodic job tick is awaited
    expect(source).not.toContain("await runReconciler(");
    expect(source).not.toContain("await runWatchdog(");
    expect(source).not.toContain("await runExternalDrain(");
    expect(source).not.toContain("await runDecisionReconciler(");
  });
});
