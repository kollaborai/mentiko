/**
 * @jest-environment node
 *
 * Unit tests for the run.json single-writer lock (TS side of engine bug #7).
 * These prove the lock primitive in isolation; the full cross-language concurrency
 * proof (bash completion helpers vs this TS protocol vs the watchdog) lives in
 * web/e2e/engine/engine-e2e-runjson.sh.
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, utimesSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { withRunJsonLock, writeRunJsonAtomic } from "../run-json-lock";

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
      expect(readFileSync(`${lockDir}/owner`, "utf-8")).toMatch(/^[a-f0-9-]{36}$/);
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

  it("breaks a legacy shell-shaped lock held by a provably dead pid and proceeds", () => {
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

  it("breaks a tokened TypeScript lock held by a provably dead pid", () => {
    const path = makeRunJson();
    const lockDir = `${path}.lock`;
    mkdirSync(lockDir);
    writeFileSync(`${lockDir}/owner`, "dead-typescript-holder");
    writeFileSync(`${lockDir}/pid`, String(2147483646));

    let ran = false;
    withRunJsonLock(path, () => { ran = true; });

    expect(ran).toBe(true);
    expect(existsSync(lockDir)).toBe(false);
  });

  it("recovers a dead owner-bearing takeover claim before breaking the dead holder", () => {
    const path = makeRunJson();
    const lockDir = `${path}.lock`;
    const claimDir = `${lockDir}.takeover`;
    mkdirSync(lockDir);
    writeFileSync(`${lockDir}/owner`, "dead-holder");
    writeFileSync(`${lockDir}/pid`, String(2147483646));
    mkdirSync(claimDir);
    writeFileSync(`${claimDir}/owner`, "dead-claimant");
    writeFileSync(`${claimDir}/pid`, String(2147483646));

    let ran = false;
    withRunJsonLock(path, () => { ran = true; });

    expect(ran).toBe(true);
    expect(existsSync(lockDir)).toBe(false);
    expect(existsSync(claimDir)).toBe(false);
  });

  it("migrates an old empty legacy takeover claim without evicting a live claimant", () => {
    const path = makeRunJson();
    const lockDir = `${path}.lock`;
    const claimDir = `${lockDir}.takeover`;
    mkdirSync(lockDir);
    writeFileSync(`${lockDir}/owner`, "dead-holder");
    writeFileSync(`${lockDir}/pid`, String(2147483646));
    mkdirSync(claimDir);
    const oldSecs = Math.floor(Date.now() / 1000) - 5;
    utimesSync(claimDir, oldSecs, oldSecs);

    let ran = false;
    withRunJsonLock(path, () => { ran = true; });

    expect(ran).toBe(true);
    expect(existsSync(lockDir)).toBe(false);
    expect(existsSync(claimDir)).toBe(false);
  });

  it("does not evict a live owner-bearing takeover claimant", () => {
    const prevWait = process.env.RUN_LOCK_WAIT_SECS;
    process.env.RUN_LOCK_WAIT_SECS = "0";
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { withRunJsonLock: lockFresh } = require("../run-json-lock") as typeof import("../run-json-lock");
    const path = makeRunJson();
    const lockDir = `${path}.lock`;
    const claimDir = `${lockDir}.takeover`;
    mkdirSync(lockDir);
    writeFileSync(`${lockDir}/owner`, "dead-holder");
    writeFileSync(`${lockDir}/pid`, String(2147483646));
    mkdirSync(claimDir);
    writeFileSync(`${claimDir}/owner`, "live-claimant");
    writeFileSync(`${claimDir}/pid`, String(process.pid));

    let ran = false;
    expect(() => lockFresh(path, () => { ran = true; })).toThrow("Could not acquire run.json lock");
    expect(ran).toBe(false);
    expect(readFileSync(`${claimDir}/owner`, "utf8")).toBe("live-claimant");

    process.env.RUN_LOCK_WAIT_SECS = prevWait;
    rmSync(lockDir, { recursive: true });
    rmSync(claimDir, { recursive: true });
  });

  it("never evicts a live holder solely because its lock directory is old", () => {
    const prevWait = process.env.RUN_LOCK_WAIT_SECS;
    process.env.RUN_LOCK_WAIT_SECS = "0";
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { withRunJsonLock: lockFresh } = require("../run-json-lock") as typeof import("../run-json-lock");

    const path = makeRunJson();
    const lockDir = `${path}.lock`;
    mkdirSync(lockDir);
    writeFileSync(`${lockDir}/pid`, String(process.pid));
    writeFileSync(`${lockDir}/owner`, "live-old-holder-token");
    const oldSecs = Math.floor(Date.now() / 1000) - 3600;
    utimesSync(lockDir, oldSecs, oldSecs);

    let ran = false;
    expect(() => lockFresh(path, () => { ran = true; })).toThrow("Could not acquire run.json lock");
    expect(ran).toBe(false);
    expect(readFileSync(`${lockDir}/pid`, "utf-8")).toBe(String(process.pid));
    expect(readFileSync(`${lockDir}/owner`, "utf-8")).toBe("live-old-holder-token");
    expect(existsSync(lockDir)).toBe(true);

    process.env.RUN_LOCK_WAIT_SECS = prevWait;
    rmSync(lockDir, { recursive: true });
  });

  it("an old holder release cannot delete a replacement lock instance", () => {
    const path = makeRunJson();
    const lockDir = `${path}.lock`;
    const successorToken = "successor-owner-token";

    withRunJsonLock(path, () => {
      expect(readFileSync(`${lockDir}/owner`, "utf-8")).not.toBe(successorToken);
      // Model an external replacement between acquisition and the old holder's
      // finally release. Release must compare the per-instance owner token.
      rmSync(lockDir, { recursive: true });
      mkdirSync(lockDir);
      writeFileSync(`${lockDir}/owner`, successorToken);
      writeFileSync(`${lockDir}/pid`, String(process.pid));
    });

    expect(existsSync(lockDir)).toBe(true);
    expect(readFileSync(`${lockDir}/owner`, "utf-8")).toBe(successorToken);
    rmSync(lockDir, { recursive: true });
  });

  it("propagates non-EEXIST mkdir failures without running the mutation", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-runjson-lock-error-"));
    const nonDirectory = join(root, "not-a-directory");
    writeFileSync(nonDirectory, "blocking parent");
    const path = join(nonDirectory, "run.json");
    let ran = false;

    let thrown: NodeJS.ErrnoException | undefined;
    try {
      withRunJsonLock(path, () => { ran = true; });
    } catch (error) {
      thrown = error as NodeJS.ErrnoException;
    }
    expect(thrown?.code).toBe("ENOTDIR");
    expect(ran).toBe(false);
  });

  it("fails closed and invokes onTimeout without running the mutation", () => {
    const prevWait = process.env.RUN_LOCK_WAIT_SECS;
    // 0 ticks => give up immediately while the holder PID remains live.
    process.env.RUN_LOCK_WAIT_SECS = "0";
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { withRunJsonLock: lockFresh } = require("../run-json-lock") as typeof import("../run-json-lock");

    const path = makeRunJson();
    const lockDir = `${path}.lock`;
    // hold the lock with OUR (live) pid so the break rule never triggers.
    mkdirSync(lockDir);
    writeFileSync(`${lockDir}/pid`, String(process.pid));

    let timedOut = false;
    let ran = false;
    expect(() => lockFresh(path, () => { ran = true; }, () => { timedOut = true; }))
      .toThrow("Could not acquire run.json lock");

    expect(timedOut).toBe(true); // onTimeout fired
    expect(ran).toBe(false);     // mutation never runs without lock ownership

    process.env.RUN_LOCK_WAIT_SECS = prevWait;
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
