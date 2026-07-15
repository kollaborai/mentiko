import { describe, expect, it } from "@jest/globals";
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildFailureEntry,
  buildRcloneInvocation,
  deriveDatePartition,
  deriveEpochMs,
  deriveShortId,
  parseAuditEntry,
  parseS3Url,
  resolveAuditTarget,
  shipAuditEntry,
} from "@/lib/runner-v2/audit-ship";

const FIXED_NOW = () => new Date("2026-07-15T10:30:45.123Z");
const secondFloor = (d: Date) => Math.floor(d.getTime() / 1000) * 1000;

describe("parseAuditEntry", () => {
  it("parses a valid object", () => {
    expect(parseAuditEntry('{"id":"evt_abc","timestamp":"2026-04-22T10:30:45Z"}')).toEqual({
      id: "evt_abc",
      timestamp: "2026-04-22T10:30:45Z",
    });
  });

  it("rejects unparseable raw input", () => {
    expect(() => parseAuditEntry("not json")).toThrow(/invalid JSON/);
  });

  it("rejects non-object raw input", () => {
    expect(() => parseAuditEntry("[1,2,3]")).toThrow(/JSON object/);
    expect(() => parseAuditEntry('"x"')).toThrow(/JSON object/);
    expect(() => parseAuditEntry("")).toThrow(/empty JSONL/);
  });

  it("rejects normalized records with missing identity or invalid timestamps", () => {
    expect(() => parseAuditEntry("{}")).toThrow(/id is required/);
    expect(() => parseAuditEntry('{"id":"evt_1"}')).toThrow(/timestamp is required/);
    expect(() => parseAuditEntry('{"id":"evt_1","timestamp":"garbage"}')).toThrow(/timestamp is invalid/);
  });
});

describe("deriveEpochMs", () => {
  it("truncates a parseable timestamp to the whole second", () => {
    const ts = "2026-04-22T10:30:45.987+00:00";
    expect(deriveEpochMs({ timestamp: ts }, FIXED_NOW, Math.random)).toBe(Math.floor(Date.parse(ts) / 1000) * 1000);
  });

  it("falls back to the current second (no jitter) when the timestamp is unparseable", () => {
    expect(deriveEpochMs({ timestamp: "garbage" }, FIXED_NOW, () => 0.999)).toBe(secondFloor(FIXED_NOW()));
  });

  it("adds 0..999ms jitter when no timestamp is present", () => {
    expect(deriveEpochMs({}, FIXED_NOW, () => 0.0)).toBe(secondFloor(FIXED_NOW()));
    expect(deriveEpochMs({}, FIXED_NOW, () => 0.5)).toBe(secondFloor(FIXED_NOW()) + 500);
    expect(deriveEpochMs({}, FIXED_NOW, () => 0.999)).toBe(secondFloor(FIXED_NOW()) + 999);
  });
});

describe("deriveShortId", () => {
  it("takes the first eight chars after the last underscore", () => {
    expect(deriveShortId({ id: "evt_1234567890abcdef" })).toBe("12345678");
  });

  it("uses the whole id when there is no underscore", () => {
    expect(deriveShortId({ id: "abc" })).toBe("abc");
  });

  it("defaults to unknown", () => {
    expect(deriveShortId({})).toBe("unknown");
  });
});

describe("deriveDatePartition", () => {
  it("slices the date part lexicographically from the timestamp", () => {
    expect(deriveDatePartition({ timestamp: "2026-04-22T10:30:45+00:00" }, FIXED_NOW)).toEqual({
      year: "2026",
      month: "04",
      day: "22",
    });
  });

  it("falls back to the current local date when no timestamp is present", () => {
    const partition = deriveDatePartition({}, FIXED_NOW);
    expect(partition.year).toMatch(/^\d{4}$/);
    expect(partition.month).toMatch(/^\d{2}$/);
    expect(partition.day).toMatch(/^\d{2}$/);
  });
});

describe("parseS3Url", () => {
  it("splits bucket + prefix and trims a single trailing slash", () => {
    expect(parseS3Url("s3://mentiko-audit-prod/tenants/ns1/")).toEqual({ bucket: "mentiko-audit-prod", prefix: "tenants/ns1" });
  });

  it("handles a bare bucket with no prefix", () => {
    expect(parseS3Url("s3://mentiko-audit-prod")).toEqual({ bucket: "mentiko-audit-prod", prefix: "" });
  });

  it("accepts a scheme-less bucket fallback", () => {
    expect(parseS3Url("mentiko-audit-prod")).toEqual({ bucket: "mentiko-audit-prod", prefix: "" });
  });

  it("returns null when no bucket can be derived", () => {
    expect(parseS3Url("s3:///only-a-prefix")).toBeNull();
    expect(parseS3Url("")).toBeNull();
  });
});

describe("resolveAuditTarget", () => {
  const env = (overrides: Record<string, string> = {}) => ({
    AUDIT_REMOTE_URL: "s3://mentiko-audit-prod/tenants/{NAMESPACE_ID}/",
    NAMESPACE_ID: "ns-1",
    ...overrides,
  });

  it("is disabled when AUDIT_REMOTE_URL is unset", () => {
    expect(resolveAuditTarget({}, { NAMESPACE_ID: "ns-1" }, FIXED_NOW, Math.random)).toEqual({ status: "disabled" });
  });

  it("substitutes the namespace into the url and derives the prefix-partitioned key", () => {
    const target = resolveAuditTarget(
      { id: "evt_deadbeef", timestamp: "2026-04-22T10:30:45Z" },
      env(),
      FIXED_NOW,
      Math.random,
    );
    expect(target).toEqual({
      status: "ok",
      bucket: "mentiko-audit-prod",
      remoteKey: `tenants/ns-1/2026/04/22/audit-${Math.floor(Date.parse("2026-04-22T10:30:45Z") / 1000) * 1000}-deadbeef.json`,
      entryId: "evt_deadbeef",
      remoteUrl: "s3://mentiko-audit-prod/tenants/ns-1/",
      epochMs: Math.floor(Date.parse("2026-04-22T10:30:45Z") / 1000) * 1000,
    });
  });

  it("uses the raw namespace id as the key prefix when the url has no prefix", () => {
    const target = resolveAuditTarget(
      { id: "evt_deadbeef", timestamp: "2026-04-22T10:30:45Z" },
      env({ AUDIT_REMOTE_URL: "s3://mentiko-audit-prod" }),
      FIXED_NOW,
      Math.random,
    );
    expect(target.status).toBe("ok");
    if (target.status !== "ok") return;
    expect(target.bucket).toBe("mentiko-audit-prod");
    expect(target.remoteKey.startsWith("ns-1/2026/04/22/audit-")).toBe(true);
  });

  it("reports malformed when no bucket can be derived", () => {
    const target = resolveAuditTarget({}, env({ AUDIT_REMOTE_URL: "s3:///no-bucket" }), FIXED_NOW, Math.random);
    expect(target).toEqual({ status: "malformed", url: "s3:///no-bucket" });
  });
});

describe("buildFailureEntry", () => {
  it("produces the compact failure breadcrumb shape", () => {
    const line = buildFailureEntry({
      failedAt: "2026-07-15T10:30:45Z",
      entryId: "evt_1",
      remoteKey: "tenants/ns-1/2026/04/22/audit-1-deadbeef.json",
      remoteUrl: "s3://mentiko-audit-prod/tenants/ns-1/",
      attempts: 3,
    });
    expect(JSON.parse(line)).toEqual({
      failed_at: "2026-07-15T10:30:45Z",
      entry_id: "evt_1",
      remote_key: "tenants/ns-1/2026/04/22/audit-1-deadbeef.json",
      remote_url: "s3://mentiko-audit-prod/tenants/ns-1/",
      attempts: 3,
    });
  });
});

describe("buildRcloneInvocation", () => {
  it("builds the copyto argv and credential env", () => {
    const { args, spawnEnv } = buildRcloneInvocation(
      "/tmp/audit-ship/entry.json",
      { bucket: "b", remoteKey: "k/audit.json" },
      { AUDIT_S3_ENDPOINT: "https://obj.linode.com", AUDIT_REMOTE_ACCESS_KEY: "AK", AUDIT_REMOTE_SECRET_KEY: "SK" },
    );
    expect(args).toEqual([
      "copyto",
      "/tmp/audit-ship/entry.json",
      ":s3:b/k/audit.json",
      "--s3-provider=Other",
      "--s3-endpoint=https://obj.linode.com",
      "--s3-env-auth=false",
      "--quiet",
    ]);
    expect(spawnEnv.RCLONE_S3_ACCESS_KEY_ID).toBe("AK");
    expect(spawnEnv.RCLONE_S3_SECRET_ACCESS_KEY).toBe("SK");
  });
});

describe("shipAuditEntry", () => {
  const baseEntry = '{"id":"evt_deadbeef","timestamp":"2026-04-22T10:30:45Z"}';
  const enabledEnv = {
    AUDIT_REMOTE_URL: "s3://mentiko-audit-prod/tenants/{NAMESPACE_ID}/",
    NAMESPACE_ID: "ns-1",
    AUDIT_REMOTE_ACCESS_KEY: "AK",
    AUDIT_REMOTE_SECRET_KEY: "SK",
    AUDIT_DIR: "/var/audit",
  };

  const recorder = () => {
    const calls = { tempDirs: [] as string[], writes: [] as Array<{ path: string; data: string }>, removed: [] as string[], appends: [] as Array<{ path: string; data: string }>, stderr: [] as string[], sleeps: [] as number[] };
    return {
      calls,
      deps: {
        mkdtemp: (prefix: string) => {
          const dir = `/tmp/${prefix}${calls.tempDirs.length}`;
          calls.tempDirs.push(dir);
          return dir;
        },
        writeFile: (path: string, data: string) => calls.writes.push({ path, data }),
        removeFile: (path: string) => calls.removed.push(path),
        appendFile: (path: string, data: string) => calls.appends.push({ path, data }),
        stderr: (line: string) => calls.stderr.push(line),
        sleep: (ms: number) => {
          calls.sleeps.push(ms);
          return Promise.resolve();
        },
      },
    };
  };

  it("is a no-op when the entry line is empty", async () => {
    const r = recorder();
    const code = await shipAuditEntry("", { env: enabledEnv, now: FIXED_NOW, random: Math.random, ...r.deps });
    expect(code).toBe(0);
    expect(r.calls.writes).toHaveLength(0);
  });

  it("is disabled (no spawn) when AUDIT_REMOTE_URL is unset", async () => {
    const r = recorder();
    const spawn = jest.fn();
    const code = await shipAuditEntry(baseEntry, { env: { NAMESPACE_ID: "ns-1" }, now: FIXED_NOW, random: Math.random, spawnRclone: spawn, ...r.deps });
    expect(code).toBe(0);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rejects malformed raw input without creating a remote object", async () => {
    const r = recorder();
    const spawn = jest.fn();
    const code = await shipAuditEntry("not json", { env: enabledEnv, spawnRclone: spawn, ...r.deps });
    expect(code).toBe(0);
    expect(spawn).not.toHaveBeenCalled();
    expect(r.calls.writes).toHaveLength(0);
    expect(r.calls.stderr.join(" ")).toMatch(/rejected raw entry/);
  });

  it("warns and skips (no spawn) on a malformed url", async () => {
    const r = recorder();
    const spawn = jest.fn();
    const code = await shipAuditEntry(baseEntry, {
      env: { ...enabledEnv, AUDIT_REMOTE_URL: "s3:///no-bucket" },
      now: FIXED_NOW,
      random: Math.random,
      spawnRclone: spawn,
      ...r.deps,
    });
    expect(code).toBe(0);
    expect(spawn).not.toHaveBeenCalled();
    expect(r.calls.stderr[0]).toMatch(/malformed/);
  });

  it("uploads on the first attempt and cleans up the temp entry", async () => {
    const r = recorder();
    const spawn = jest.fn().mockResolvedValue(0);
    const code = await shipAuditEntry(baseEntry, { env: enabledEnv, now: FIXED_NOW, random: Math.random, spawnRclone: spawn, ...r.deps });
    expect(code).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(r.calls.writes[0].data).toBe(`${baseEntry}\n`);
    expect(r.calls.removed).toEqual(r.calls.tempDirs);
    expect(r.calls.appends).toHaveLength(0);
  });

  it("removes the real temporary directory with the default cleanup", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "mentiko-audit-ship-test-"));
    const tempDir = join(tempRoot, "staged");
    try {
      const spawn = jest.fn().mockResolvedValue(0);
      const code = await shipAuditEntry(baseEntry, {
        env: enabledEnv,
        now: FIXED_NOW,
        random: Math.random,
        mkdtemp: () => {
          mkdirSync(tempDir, { recursive: true });
          return tempDir;
        },
        spawnRclone: spawn,
      });
      expect(code).toBe(0);
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(existsSync(tempDir)).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("retries with backoff then succeeds", async () => {
    const r = recorder();
    const spawn = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const code = await shipAuditEntry(baseEntry, { env: enabledEnv, now: FIXED_NOW, random: Math.random, spawnRclone: spawn, ...r.deps });
    expect(code).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(r.calls.sleeps).toEqual([1000]);
  });

  it("records a failure breadcrumb after all attempts are exhausted", async () => {
    const r = recorder();
    const spawn = jest.fn().mockResolvedValue(1);
    const code = await shipAuditEntry(baseEntry, { env: enabledEnv, now: FIXED_NOW, random: Math.random, spawnRclone: spawn, ...r.deps });
    expect(code).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(3);
    expect(r.calls.sleeps).toEqual([1000, 5000]);
    expect(r.calls.appends).toHaveLength(1);
    expect(r.calls.appends[0].path).toBe("/var/audit/ship-failures.log");
    const record = JSON.parse(r.calls.appends[0].data);
    expect(record.entry_id).toBe("evt_deadbeef");
    expect(record.attempts).toBe(3);
    expect(record.remote_url).toBe("s3://mentiko-audit-prod/tenants/ns-1/");
    expect(record.failed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(r.calls.appends[0].data.endsWith("\n")).toBe(true);
    expect(r.calls.stderr.some((line) => line.includes("failed after 3"))).toBe(true);
  });

  it("keeps cleanup and breadcrumb write failures non-blocking", async () => {
    const r = recorder();
    const spawn = jest.fn().mockResolvedValue(1);
    const code = await shipAuditEntry(baseEntry, {
      env: enabledEnv,
      now: FIXED_NOW,
      random: Math.random,
      spawnRclone: spawn,
      ...r.deps,
      removeFile: () => { throw new Error("cleanup denied"); },
      appendFile: () => { throw new Error("audit directory denied"); },
    });
    expect(code).toBe(0);
    expect(r.calls.stderr.some((line) => line.includes("cleanup failed"))).toBe(true);
    expect(r.calls.stderr.some((line) => line.includes("breadcrumb could not be written"))).toBe(true);
  });
});
