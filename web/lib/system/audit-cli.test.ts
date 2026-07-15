import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("audit cli write metadata", () => {
  const originalEnv = process.env;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "mentiko-audit-cli-"));
    process.env = { ...originalEnv, MENTIKO_GLOBAL_ROOT: root, NAMESPACE_ID: "audit-cli-test" };
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    rmSync(root, { recursive: true, force: true });
  });

  const run = async (argv: string[]): Promise<Record<string, unknown>> => {
    const { runAuditCli } = await import("@/lib/system/audit-cli");
    const lines: string[] = [];
    runAuditCli(argv, (line) => lines.push(line));
    return JSON.parse(lines[0]);
  };

  it("forwards repeated --meta primitives as metadata", async () => {
    const entry = await run([
      "write", "--namespace-id", "audit-cli-test", "--event-type", "agent_launch",
      "--description", "Launched agent", "--meta", "agent_id=a1", "--meta", "run_id=r1", "--source", "cli",
    ]);
    expect(entry.event_type).toBe("agent_launch");
    expect(entry.metadata).toEqual({ agent_id: "a1", run_id: "r1" });
  });

  it("keeps --metadata-json for legacy bin/mentiko callers", async () => {
    const entry = await run([
      "write", "--namespace-id", "audit-cli-test", "--event-type", "cli_command",
      "--description", "cmd", "--metadata-json", '{"command":"run","args":"x"}',
    ]);
    expect(entry.metadata).toEqual({ command: "run", args: "x" });
  });

  it("lets --meta override --metadata-json for the same key", async () => {
    const entry = await run([
      "write", "--namespace-id", "audit-cli-test", "--event-type", "t", "--description", "d",
      "--metadata-json", '{"k":"json"}', "--meta", "k=meta", "--meta", "extra=y",
    ]);
    expect(entry.metadata).toEqual({ k: "meta", extra: "y" });
  });

  it("preserves a numeric-shaped --meta value as a string (sanitizeMetadata stringifies)", async () => {
    const entry = await run([
      "write", "--namespace-id", "audit-cli-test", "--event-type", "chain_start",
      "--description", "d", "--meta", "agent_count=3",
    ]);
    expect(entry.metadata).toEqual({ agent_count: "3" });
  });

  it("forwards a value containing an equals sign", async () => {
    const entry = await run([
      "write", "--namespace-id", "audit-cli-test", "--event-type", "t", "--description", "d",
      "--meta", "details=a=b",
    ]);
    expect(entry.metadata).toEqual({ details: "a=b" });
  });

  it("does not reinterpret a normal flag value equal to --meta", async () => {
    const entry = await run([
      "write", "--namespace-id", "audit-cli-test", "--event-type", "t",
      "--description", "--meta", "--source", "cli",
    ]);
    expect(entry.description).toBe("--meta");
    expect(entry.source).toBe("cli");
    expect(entry.metadata).toEqual({});
  });

  it("rejects a --meta argument without key=value", async () => {
    const { runAuditCli } = await import("@/lib/system/audit-cli");
    expect(() => runAuditCli(["write", "--event-type", "t", "--description", "d", "--meta", "noeq"], () => {})).toThrow(/key=value/);
    expect(() => runAuditCli(["write", "--event-type", "t", "--description", "d", "--meta"], () => {})).toThrow(/key=value/);
  });

  it("rejects --meta on non-write commands", async () => {
    const { runAuditCli } = await import("@/lib/system/audit-cli");
    expect(() => runAuditCli(["summary", "--namespace-id", "audit-cli-test", "--meta", "k=v"], () => {})).toThrow(/not valid for audit/);
  });
});
