/** @jest-environment node */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const codeRoot = resolve(__dirname, "../../..");
const webRoot = join(codeRoot, "web");
const compiledRunRecord = join(codeRoot, "lib", "runner-run-record.js");
const sourceRunRecord = join(webRoot, "lib", "runner-v2", "run-record-cli.ts");

describe("typed Run Record runtime binding", () => {
  it("binds the canonical CLI source into the tenant image", () => {
    const dockerfile = readFileSync(join(codeRoot, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("run-record-cli.ts");
    expect(dockerfile).toContain("--outfile=/context/lib/runner-run-record.js");
  });

  it("keeps the checked-in runtime bundle byte-identical to a fresh esbuild", () => {
    const root = mkdtempSync(join(tmpdir(), "runner-run-record-bundle-"));
    const freshBundle = join(root, "runner-run-record.js");
    execFileSync("npx", [
      "--yes", "esbuild", sourceRunRecord,
      "--bundle", "--platform=node", "--target=node20", `--outfile=${freshBundle}`,
    ], { cwd: webRoot, encoding: "utf8", stdio: "pipe" });
    expect(readFileSync(compiledRunRecord, "utf8")).toBe(readFileSync(freshBundle, "utf8"));
  });

  it("executes create and named mutations through the real compiled bundle", () => {
    const root = mkdtempSync(join(tmpdir(), "runner-run-record-runtime-"));
    const runsDir = join(root, "runs");
    const chainPath = join(root, "chain.json");
    writeFileSync(chainPath, '{"name":"bundle-chain"}\n');
    const environment = { ...process.env, MENTIKO_CODE_ROOT: codeRoot, RUNS_DIR: runsDir };
    const created = spawnSync(process.execPath, [
      compiledRunRecord, "create", "--runs-dir", runsDir,
      "--chain-file", chainPath, "--goal", "bundle proof",
    ], { encoding: "utf8", env: environment });
    expect(created.status).toBe(0);
    const runId = created.stdout.trim();
    expect(runId).toMatch(/^run-/);

    const session = spawnSync(process.execPath, [
      compiledRunRecord, "add-session", "--runs-dir", runsDir, "--run-id", runId,
      "--session", "writer-session", "--agent-id", "writer", "--agent-name", "Writer",
    ], { encoding: "utf8", env: environment });
    expect(session.status).toBe(0);
    expect(JSON.parse(session.stdout)).toMatchObject({
      status: "running",
      agents: [{ id: "writer", session: "writer-session", status: "running" }],
    });
  });

  it("fails closed when the compiled bundle is absent", () => {
    const missingRoot = mkdtempSync(join(tmpdir(), "runner-run-record-missing-"));
    const result = spawnSync("bash", ["-lc", `
      source ${JSON.stringify(join(codeRoot, "lib", "config.sh"))}
      source ${JSON.stringify(join(codeRoot, "lib", "run-record-client.sh"))}
      _run_record_cli inspect --runs-dir ${JSON.stringify(join(missingRoot, "runs"))} --run-id run-1
    `], {
      encoding: "utf8",
      env: { ...process.env, MENTIKO_CODE_ROOT: missingRoot, MENTIKO_GLOBAL_ROOT: missingRoot },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("typed run-record bundle missing");
    expect(result.stderr).not.toContain("npx");
    expect(result.stderr).not.toContain("tsx");
  });

  it("invokes the typed owner selection from standalone GDPR cleanup", () => {
    const root = mkdtempSync(join(tmpdir(), "runner-run-record-gdpr-"));
    const runsDir = join(root, "namespaces", "default", "runs");
    const runDir = join(runsDir, "run-owned");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "run.json"), JSON.stringify({
      id: "run-owned",
      chain: "gdpr",
      goal: "delete owned data",
      started: "2026-07-15T00:00:00Z",
      status: "completed",
      agents: [],
      user_id: "user-1",
    }));
    const result = spawnSync("bash", [join(codeRoot, "lib", "gdpr-sweep.sh"), "user-1", "default"], {
      encoding: "utf8",
      env: { ...process.env, MENTIKO_CODE_ROOT: codeRoot, MENTIKO_GLOBAL_ROOT: root },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("removed run:");
    expect(result.stdout).toContain("/runs/run-owned");
    expect(existsSync(runDir)).toBe(false);
  });

  it("builds a GitHub error report through the typed Run Record query when sourced standalone", () => {
    const root = mkdtempSync(join(tmpdir(), "runner-run-record-github-"));
    const runsDir = join(root, "runs");
    const captureDir = join(root, "capture");
    mkdirSync(captureDir);
    const environment = { ...process.env, MENTIKO_CODE_ROOT: codeRoot, MENTIKO_GLOBAL_ROOT: root, RUNS_DIR: runsDir };
    const created = spawnSync(process.execPath, [
      compiledRunRecord, "create", "--runs-dir", runsDir,
      "--run-id", "run-1", "--chain", "github-chain", "--goal", "report typed context",
    ], { encoding: "utf8", env: environment });
    expect(created.status).toBe(0);

    const result = spawnSync("bash", ["-lc", `
      source ${JSON.stringify(join(codeRoot, "lib", "github-integration.sh"))}
      github-get-token() { printf token; }
      github-create-issue() {
        printf '%s' "$2" > ${JSON.stringify(join(captureDir, "title"))}
        printf '%s' "$3" > ${JSON.stringify(join(captureDir, "body"))}
      }
      github-agent-error-issue owner/repo run-1 writer 'startup failed'
    `], { encoding: "utf8", env: environment });
    expect(result.status).toBe(0);
    expect(readFileSync(join(captureDir, "title"), "utf8")).toBe("Agent Error: writer failed in github-chain");
    expect(readFileSync(join(captureDir, "body"), "utf8")).toContain("report typed context");
    expect(readFileSync(join(captureDir, "body"), "utf8")).toContain("startup failed");
  });

  it("leaves shell callers as semantic invocations with no Run Record parser or writer", () => {
    const sources = [
      "lib/run-lib.sh",
      "lib/chain-runner.sh",
      "lib/agent-activity-capture.sh",
      "lib/concurrency-cap.sh",
      "lib/github-integration.sh",
      "lib/gdpr-sweep.sh",
      "bin/peer-manager",
      "bin/test-relay-prompt",
      "lib/run-record-client.sh",
    ].map((path) => readFileSync(join(codeRoot, path), "utf8")).join("\n");
    expect(sources).not.toContain("_with_run_lock");
    expect(sources).not.toMatch(/_rmw_[A-Za-z0-9_]*run/i);
    expect(sources).not.toMatch(/jq[^\n]*(?:run\.json|\$run_file|\$run_json)/);
    expect(sources).not.toMatch(/(?:cat|grep)[^\n]*(?:run\.json|\$run_file|\$run_json)/);
  });
});
