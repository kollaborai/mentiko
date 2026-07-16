/** @jest-environment node */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const codeRoot = resolve(__dirname, "../../..");
const webRoot = join(codeRoot, "web");
const compiledSystemLog = join(codeRoot, "lib", "runner-system-log.js");
const sourceSystemLog = join(webRoot, "lib", "system", "system-log-cli.ts");
const runLib = join(codeRoot, "lib", "run-lib.sh");

describe("typed system log runtime binding", () => {
  it("binds the canonical CLI source into the tenant image", () => {
    const dockerfile = readFileSync(join(codeRoot, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("system-log-cli.ts");
    expect(dockerfile).toContain("--outfile=/context/lib/runner-system-log.js");
  });

  it("keeps the checked-in runtime bundle byte-identical to a fresh esbuild", () => {
    const root = mkdtempSync(join(tmpdir(), "runner-system-log-bundle-"));
    const freshBundle = join(root, "runner-system-log.js");
    execFileSync("npx", [
      "--yes", "esbuild", sourceSystemLog,
      "--bundle", "--platform=node", "--target=node20", `--outfile=${freshBundle}`,
    ], { cwd: webRoot, encoding: "utf8", stdio: "pipe" });
    expect(readFileSync(compiledSystemLog, "utf8")).toBe(readFileSync(freshBundle, "utf8"));
  });

  it("rejects a level outside the contract through the real compiled bundle", () => {
    const result = spawnSync(process.execPath, [
      compiledSystemLog, "--level", "bogus", "--source", "chain-runner", "--message", "m",
    ], { encoding: "utf8", env: { ...process.env, WEB_PORT: "59999" } });
    expect(result.stderr).toContain("level must be one of error, warn, info");
  });

  it("stays best-effort so a logging failure never masks the failure being reported", () => {
    // chain-runner.sh calls _sys_log from its ERR trap; an unreachable endpoint
    // or a rejected submission must still exit 0.
    const unreachable = spawnSync(process.execPath, [
      compiledSystemLog, "--level", "error", "--source", "chain-runner", "--message", "crash report",
    ], { encoding: "utf8", env: { ...process.env, WEB_PORT: "59999" } });
    expect(unreachable.status).toBe(0);

    const rejected = spawnSync(process.execPath, [
      compiledSystemLog, "--level", "bogus", "--source", "s", "--message", "m",
    ], { encoding: "utf8", env: { ...process.env, WEB_PORT: "59999" } });
    expect(rejected.status).toBe(0);
  });

  it("leaves the shell caller a semantic invocation with no payload construction", () => {
    const shell = readFileSync(runLib, "utf8");
    const sysLog = shell.slice(shell.indexOf("_sys_log() {"), shell.indexOf("emit-runner-event()"));

    expect(sysLog).toContain("runner-system-log.js");
    expect(sysLog).toContain("--level");
    // no JSON construction, no direct HTTP, and no shell fallback
    expect(sysLog).not.toContain("jq");
    expect(sysLog).not.toContain("curl");
  });
});
