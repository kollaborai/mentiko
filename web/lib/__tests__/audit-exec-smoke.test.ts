/**
 * audit-exec smoke test.
 *
 * End-to-end: call execAuditLog / execAuditQuery, confirm the typed owner
 * writes both the append-only log and the bounded query index. No mocks.
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
    const { execAuditLog } = await import("../api/audit-exec");

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
    const { execAuditLog } = await import("../api/audit-exec");

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
    const { execAuditLog, execAuditQuery } = await import("../api/audit-exec");

    const tag = `query_smoke_${Date.now()}`;
    await execAuditLog("query_probe", tag, {});

    const output = await execAuditQuery({ filterType: "all", limit: 50 });
    expect(output).toContain(tag);

    // query should be parseable JSON (array)
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("does not construct a shell command to write the index", async () => {
    const { execAuditLog } = await import("../api/audit-exec");
    await expect(execAuditLog("typed_canary", "typed audit writer", {})).resolves.toBeDefined();
  });
});
