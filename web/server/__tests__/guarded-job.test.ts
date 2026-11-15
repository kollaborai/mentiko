// issue #136: one failing worker job must not exit the worker process.
import { runGuardedJob, type GuardedJobDeps } from "../guarded-job";

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
