import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("typed audit index", () => {
  const originalEnv = process.env;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "mentiko-audit-store-"));
    process.env = { ...originalEnv, MENTIKO_GLOBAL_ROOT: root, NAMESPACE_ID: "audit-test" };
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    rmSync(root, { recursive: true, force: true });
  });

  it("writes the append-only log and bounded index using the established numeric audit id grammar", async () => {
    const { queryAuditLog, resolveAuditPaths, writeAuditLog } = await import("@/lib/system/audit-log");
    const entry = writeAuditLog({ eventType: "chain_start", description: "Started chain", metadata: { run_id: "run-1", ignored_email: "person@example.test" }, source: "cli" });
    const paths = resolveAuditPaths();

    expect(entry.id).toMatch(/^audit_\d+_\d+$/);
    expect(readFileSync(paths.logFile, "utf8")).toContain(entry.id);
    expect(queryAuditLog({ filterType: "run_id", filterValue: "run-1" })).toEqual([expect.objectContaining({ id: entry.id })]);
    expect(entry.metadata).not.toHaveProperty("ignored_email");
  });

  it("fails closed on a malformed persisted index instead of treating it as an empty registry", async () => {
    const { queryAuditLog, resolveAuditPaths } = await import("@/lib/system/audit-log");
    const paths = resolveAuditPaths();
    mkdirSync(paths.dir, { recursive: true });
    writeFileSync(paths.indexFile, "not json");
    expect(() => queryAuditLog({})).toThrow(/Invalid audit index/);
    expect(existsSync(paths.indexFile)).toBe(true);
  });
});
