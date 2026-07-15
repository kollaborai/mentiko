/** @jest-environment node */

import { mkdtempSync, readFileSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configuredRunsDir, runRunRecordCli } from "./run-record-cli";

describe("runner run record CLI", () => {
  it("requires one canonical explicit configured runs root", () => {
    expect(() => configuredRunsDir(undefined, undefined)).toThrow("Configured runs root required");
    expect(() => configuredRunsDir("relative", undefined)).toThrow("must be absolute");
    expect(() => configuredRunsDir("/tmp/runs-a", "/tmp/runs-b")).toThrow("different runs roots");
    expect(configuredRunsDir("/tmp/runs", "/tmp/runs/../runs")).toBe(join(realpathSync("/tmp"), "runs"));

    const actual = mkdtempSync(join(tmpdir(), "mentiko-run-record-cli-root-"));
    const alias = `${actual}-alias`;
    symlinkSync(actual, alias);
    expect(configuredRunsDir(alias, actual)).toBe(realpathSync(actual));
  });

  it("rejects named mutations through a symlinked run directory", async () => {
    const runsDir = mkdtempSync(join(tmpdir(), "mentiko-run-record-cli-safe-root-"));
    const outsideRunsDir = mkdtempSync(join(tmpdir(), "mentiko-run-record-cli-outside-root-"));
    await runRunRecordCli([
      "create", "--runs-dir", outsideRunsDir, "--run-id", "run-1",
      "--chain", "outside-chain", "--goal", "must remain unchanged",
    ], {}, () => {});
    symlinkSync(join(outsideRunsDir, "run-1"), join(runsDir, "run-1"));

    await expect(runRunRecordCli([
      "set-status", "--runs-dir", runsDir, "--run-id", "run-1", "--status", "completed",
    ], {}, () => {})).rejects.toThrow("Run directory must not be a symbolic link");
    expect(JSON.parse(readFileSync(join(outsideRunsDir, "run-1", "run.json"), "utf8")).status).toBe("pending");
  });

  it("creates, inspects, and performs only named mutations", async () => {
    const runsDir = mkdtempSync(join(tmpdir(), "mentiko-run-record-cli-"));
    const output: string[] = [];
    const write = (line: string) => output.push(line);

    await runRunRecordCli([
      "create", "--runs-dir", runsDir, "--run-id", "run-1",
      "--chain", "typed-chain", "--goal", "prove named operations",
    ], {}, write);
    await runRunRecordCli([
      "add-session", "--runs-dir", runsDir, "--run-id", "run-1",
      "--session", "writer-run-1", "--agent-id", "writer", "--agent-name", "Writer",
    ], {}, write);
    await runRunRecordCli([
      "set-agent-status", "--runs-dir", runsDir, "--run-id", "run-1",
      "--agent-id", "writer", "--status", "complete",
    ], {}, write);
    await runRunRecordCli([
      "set-status", "--runs-dir", runsDir, "--run-id", "run-1",
      "--status", "completed",
    ], {}, write);
    await runRunRecordCli(["inspect", "--runs-dir", runsDir, "--run-id", "run-1"], {}, write);

    const persisted = JSON.parse(readFileSync(join(runsDir, "run-1", "run.json"), "utf8"));
    expect(persisted).toMatchObject({
      id: "run-1",
      status: "completed",
      sessions: ["writer-run-1"],
      agents: [{ id: "writer", name: "Writer", status: "complete" }],
    });
    expect(JSON.parse(output.at(-1)!)).toEqual(persisted);
  });

  it("has no generic patch command or patch option", async () => {
    const runsDir = mkdtempSync(join(tmpdir(), "mentiko-run-record-cli-no-patch-"));
    await expect(runRunRecordCli(["patch", "--runs-dir", runsDir], {}, () => {}))
      .rejects.toThrow("usage: runner-run-record");
    await expect(runRunRecordCli([
      "create", "--runs-dir", runsDir, "--chain", "chain", "--goal", "goal",
      "--patch", "{}",
    ], {}, () => {})).rejects.toThrow("--patch is not valid for create");
  });

  it("requires an unambiguous chain source and lists a missing root as empty", async () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-run-record-cli-source-"));
    const chainFile = join(root, "chain.json");
    const missingRunsDir = join(root, "missing-runs");
    const output: string[] = [];
    require("node:fs").writeFileSync(chainFile, '{"name":"from-file"}\n');

    await expect(runRunRecordCli([
      "create", "--runs-dir", missingRunsDir, "--chain", "inline", "--chain-file", chainFile,
      "--goal", "ambiguous",
    ], {}, () => {})).rejects.toThrow("exactly one of --chain or --chain-file");
    await expect(runRunRecordCli(["list", "--runs-dir", missingRunsDir], {}, (line) => output.push(line)))
      .resolves.toBeUndefined();
    expect(output).toEqual(["[]"]);
  });
});
