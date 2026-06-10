/**
 * @jest-environment node
 *
 * Unit tests for the run.json single-writer lock (TS side of engine bug #7).
 * These prove the lock primitive in isolation; the full cross-language concurrency
 * proof (bash completion helpers vs this TS protocol vs the watchdog) lives in
 * web/e2e/engine/engine-e2e-runjson.sh.
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { withRunJsonLock, writeRunJsonAtomic } from "./run-json-lock";

function makeRunJson(initial: unknown = { id: "run-1", status: "running", agents: [] }): string {
  const dir = mkdtempSync(join(tmpdir(), "mentiko-runjson-lock-"));
  const path = join(dir, "run.json");
  writeFileSync(path, JSON.stringify(initial, null, 2));
  return path;
}

describe("withRunJsonLock", () => {
  it("runs the critical section and releases the lock dir afterward", () => {
    const path = makeRunJson();
    const lockDir = `${path}.lock`;

    const result = withRunJsonLock(path, () => {
      // lock dir exists WHILE we hold it
      expect(existsSync(lockDir)).toBe(true);
      return 42;
    });

    expect(result).toBe(42);
    // released after the section returns
    expect(existsSync(lockDir)).toBe(false);
  });

  it("releases the lock even when the critical section throws", () => {
    const path = makeRunJson();
    const lockDir = `${path}.lock`;

    expect(() =>
      withRunJsonLock(path, () => {
        throw new Error("boom");
      })
    ).toThrow("boom");

    // finally-release must have fired despite the throw — no leaked lock.
    expect(existsSync(lockDir)).toBe(false);
  });

  it("serializes nested re-entrant-looking acquisitions by breaking nothing (sequential land)", () => {
    // Two sequential locked writes must both land (lock is free between them).
    const path = makeRunJson({ id: "run-1", status: "running", agents: [{ id: "a", status: "pending" }, { id: "b", status: "pending" }] });

    withRunJsonLock(path, () => {
      const run = JSON.parse(readFileSync(path, "utf-8"));
      run.agents.find((x: { id: string }) => x.id === "a").status = "complete";
      writeRunJsonAtomic(path, run);
    });
    withRunJsonLock(path, () => {
      const run = JSON.parse(readFileSync(path, "utf-8"));
      run.agents.find((x: { id: string }) => x.id === "b").status = "complete";
      writeRunJsonAtomic(path, run);
    });

    const final = JSON.parse(readFileSync(path, "utf-8"));
    expect(final.agents.every((a: { status: string }) => a.status === "complete")).toBe(true);
  });

  it("breaks a stale lock held by a dead pid and proceeds", () => {
    const path = makeRunJson();
    const lockDir = `${path}.lock`;
    // pre-seed a lock dir owned by a pid that cannot be alive.
    mkdirSync(lockDir);
    // 2^31-1 is not a real pid on any sane system; process.kill(pid,0) => ESRCH.
    writeFileSync(`${lockDir}/pid`, String(2147483646));

    let ran = false;
    withRunJsonLock(path, () => { ran = true; });

    expect(ran).toBe(true);
    expect(existsSync(lockDir)).toBe(false); // broke the stale lock, then released cleanly
  });

  it("breaks an aged-out lock (live holder, old mtime) via RUN_LOCK_STALE_SECS", () => {
    const prev = process.env.RUN_LOCK_STALE_SECS;
    const prevWait = process.env.RUN_LOCK_WAIT_SECS;
    // small stale window so the backdated lock is well past it; short wait so a
    // failure-to-break would time out fast rather than hang the test.
    process.env.RUN_LOCK_STALE_SECS = "1";
    process.env.RUN_LOCK_WAIT_SECS = "20";
    jest.resetModules();
    // re-import so the module re-reads the env knobs at load time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { withRunJsonLock: lockFresh } = require("./run-json-lock") as typeof import("./run-json-lock");

    const path = makeRunJson();
    const lockDir = `${path}.lock`;
    mkdirSync(lockDir);
    writeFileSync(`${lockDir}/pid`, String(process.pid)); // OUR pid, very much alive
    // backdate the lock dir's mtime ~1h into the past via utimesSync.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { utimesSync } = require("fs");
    const oldSecs = Math.floor(Date.now() / 1000) - 3600;
    utimesSync(lockDir, oldSecs, oldSecs);
    expect(statSync(lockDir).mtimeMs).toBeLessThan(Date.now() - 1000);

    let ran = false;
    lockFresh(path, () => { ran = true; });
    expect(ran).toBe(true);
    expect(existsSync(lockDir)).toBe(false);

    process.env.RUN_LOCK_STALE_SECS = prev;
    process.env.RUN_LOCK_WAIT_SECS = prevWait;
  });

  it("proceeds (degraded) and invokes onTimeout when the lock cannot be acquired", () => {
    const prevWait = process.env.RUN_LOCK_WAIT_SECS;
    const prevStale = process.env.RUN_LOCK_STALE_SECS;
    // 0 ticks => give up immediately; huge stale window => never break the live holder.
    process.env.RUN_LOCK_WAIT_SECS = "0";
    process.env.RUN_LOCK_STALE_SECS = "100000";
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { withRunJsonLock: lockFresh } = require("./run-json-lock") as typeof import("./run-json-lock");

    const path = makeRunJson();
    const lockDir = `${path}.lock`;
    // hold the lock with OUR (live) pid so the break rule never triggers.
    mkdirSync(lockDir);
    writeFileSync(`${lockDir}/pid`, String(process.pid));

    let timedOut = false;
    let ran = false;
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    lockFresh(path, () => { ran = true; }, () => { timedOut = true; });
    warn.mockRestore();

    expect(timedOut).toBe(true); // onTimeout fired
    expect(ran).toBe(true);      // and we proceeded with the write anyway (never hang)

    process.env.RUN_LOCK_WAIT_SECS = prevWait;
    process.env.RUN_LOCK_STALE_SECS = prevStale;
  });
});

describe("writeRunJsonAtomic", () => {
  it("writes valid JSON and leaves no temp file behind", () => {
    const path = makeRunJson();
    const dir = path.replace(/\/run\.json$/, "");
    writeRunJsonAtomic(path, { id: "run-2", status: "completed", agents: [{ id: "x", status: "complete" }] });

    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    expect(parsed.status).toBe("completed");
    expect(parsed.agents[0].id).toBe("x");

    // no leftover .tmp.<pid> sibling
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readdirSync } = require("fs");
    const leftovers = readdirSync(dir).filter((f: string) => f.includes(".tmp."));
    expect(leftovers).toHaveLength(0);
  });
});
