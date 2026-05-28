/**
 * audit-exec smoke test.
 *
 * End-to-end: call execAuditLog / execAuditQuery, confirm the entry lands
 * in the audit.log file. No mocks. This test would have caught the
 * /bin/sh-vs-hyphen-in-function-name bug in the audit exec pipeline.
 *
 * The bar is "if this passes, the production audit log pipeline works
 * from a web-origin Node.js context." Silent failure in .catch(() => {})
 * is the enemy; this test shouts when it breaks.
 */

import { mkdtempSync, existsSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const originalEnv = process.env;

let tmpGlobalRoot: string;

describe("audit-exec smoke test", () => {
  beforeAll(() => {
    tmpGlobalRoot = mkdtempSync(join(tmpdir(), "mentiko-audit-smoke-"));
    process.env = {
      ...originalEnv,
      MENTIKO_GLOBAL_ROOT: tmpGlobalRoot,
      MENTIKO_CODE_ROOT: join(__dirname, "..", "..", ".."),
      NAMESPACE_ID: "default",
      ORG_ID: "default",
    };
    // bust the module cache so audit-exec / config pick up the new env
    jest.resetModules();
  });

  afterAll(() => {
    process.env = originalEnv;
    if (tmpGlobalRoot && existsSync(tmpGlobalRoot)) {
      rmSync(tmpGlobalRoot, { recursive: true, force: true });
    }
  });

  it("execAuditLog writes a real entry that can be read back", async () => {
    // require inside the test so the env override is in effect.
    const { execAuditLog } = await import("../audit-exec");

    const uniqueTag = `smoke_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const id = await execAuditLog("smoke_event", uniqueTag, {
      foo: "bar",
      number: 42,
    });

    expect(id).toMatch(/^audit_\d+_\d+$/);

    const auditFile = join(tmpGlobalRoot, "namespaces", "default", "audit", "audit.log");
    expect(existsSync(auditFile)).toBe(true);

    const lines = readFileSync(auditFile, "utf-8").trim().split("\n").filter(Boolean);
    const entry = lines.find((l) => l.includes(uniqueTag));
    expect(entry).toBeDefined();

    const parsed = JSON.parse(entry as string);
    expect(parsed.event_type).toBe("smoke_event");
    expect(parsed.description).toBe(uniqueTag);
    expect(parsed.metadata.foo).toBe("bar");
    expect(parsed.metadata.number).toBe("42");
    expect(parsed.source).toBe("web");
    expect(parsed.id).toBe(id);
  });

  it("execAuditLog neutralizes shell-injection payloads (SEC-1 regression)", async () => {
    const { execAuditLog } = await import("../audit-exec");

    const pwnFile = join(tmpGlobalRoot, "sec1_smoke_pwned");
    const payload = `x"; touch ${pwnFile}; echo "`;

    // must succeed (logged as literal text), not execute the injection
    await expect(execAuditLog("injection_test", payload, { q: payload })).resolves.toBeDefined();

    expect(existsSync(pwnFile)).toBe(false);

    // parse the last entry and verify the raw description matches the attack payload
    const auditFile = join(tmpGlobalRoot, "namespaces", "default", "audit", "audit.log");
    const lines = readFileSync(auditFile, "utf-8").trim().split("\n").filter(Boolean);
    const injectionLine = lines.find((l) => l.includes("injection_test"));
    expect(injectionLine).toBeDefined();
    const parsed = JSON.parse(injectionLine as string);
    expect(parsed.description).toBe(payload);
    expect(parsed.metadata.q).toBe(payload);
  });

  it("execAuditQuery returns entries written by execAuditLog", async () => {
    const { execAuditLog, execAuditQuery } = await import("../audit-exec");

    const tag = `query_smoke_${Date.now()}`;
    await execAuditLog("query_probe", tag, {});

    const output = await execAuditQuery({ filterType: "all", limit: 50 });
    expect(output).toContain(tag);

    // query should be parseable JSON (array)
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("hyphenated function names work (proves shell: /bin/bash, not /bin/sh)", async () => {
    // This is the canary for the SEC-1 regression. /bin/sh (dash or bash -p)
    // rejects `audit-log` as "not a valid identifier". /bin/bash accepts it.
    const { execAuditLog } = await import("../audit-exec");

    // if this throws "not a valid identifier", audit-exec has regressed to /bin/sh.
    await expect(execAuditLog("bash_canary", "hyphen function name", {})).resolves.toBeDefined();
  });
});
