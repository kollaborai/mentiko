import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  authorizeTypedRelaunch,
  buildTypedRelaunchPlan,
  calculateRetryDelay,
  detectAgentError,
  handleAgentError,
} from "@/lib/runner-v2/error-handling";
import { createRunnerAgentState, readRunnerAgentState, runnerAgentStatePath } from "@/lib/runner-v2/agent-state";

describe("typed error handling", () => {
  let root: string;

  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "mentiko-error-handling-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("detects timeout before general errors and ignores explicit no-error text", () => {
    const clean = join(root, "clean.txt");
    const error = join(root, "error.txt");
    const timeout = join(root, "timeout.txt");
    writeFileSync(clean, "no error\nzero errors\n");
    writeFileSync(error, "fatal: failed\n");
    writeFileSync(timeout, "error before deadline exceeded\n");
    expect(detectAgentError(join(root, "missing.txt"))).toBe(0);
    expect(detectAgentError(clean)).toBe(0);
    expect(detectAgentError(error)).toBe(1);
    expect(detectAgentError(timeout)).toBe(2);
  });

  it("preserves fixed, linear, and exponential retry policy semantics", () => {
    expect(calculateRetryDelay(4, "fixed", 10, 300, 2)).toBe(10);
    expect(calculateRetryDelay(2, "linear", 5, 300, 2)).toBe(15);
    expect(calculateRetryDelay(3, "exponential", 5, 300, 2)).toBe(40);
    expect(calculateRetryDelay(10, "exponential", 5, 100, 2)).toBe(100);
  });

  it("increments typed retry state and schedules a retry through the external runner boundary", () => {
    const stateDir = join(root, "state");
    mkdirSync(stateDir, { recursive: true });
    const chainFile = join(root, "chain.json");
    const reportFile = join(root, "report.txt");
    writeFileSync(chainFile, JSON.stringify({ name: "chain", agents: [{ id: "agent-1", name: "Agent", retry: { max_retries: 2, backoff: "fixed", initial_delay: 1 } }] }));
    writeFileSync(reportFile, "error: transient\n");
    createRunnerAgentState(runnerAgentStatePath(stateDir, "agent-1", "run-1"), { session: "agent-1-run-1", agent_id: "agent-1" });
    const scheduled: Array<[string, string, number]> = [];
    const result = handleAgentError({ agentId: "agent-1", errorType: "error", reportFile, chainFile, stateDir, runId: "run-1" }, () => undefined, (...args) => scheduled.push(args));
    expect(result).toMatchObject({ code: 0, action: "retry", retryCount: 0, maxRetries: 2 });
    expect(scheduled).toEqual([[chainFile, "agent-1", 1]]);
    expect(readRunnerAgentState(runnerAgentStatePath(stateDir, "agent-1", "run-1"))?.retry_attempt).toBe("1");
  });

  it("marks failed state and routes to a typed handler after retry exhaustion", () => {
    const stateDir = join(root, "state");
    mkdirSync(stateDir, { recursive: true });
    const chainFile = join(root, "chain.json");
    const reportFile = join(root, "report.txt");
    writeFileSync(chainFile, JSON.stringify({ agents: [{ id: "agent-1", retry: { max_retries: 1 }, on_error: "handler" }, { id: "handler" }] }));
    writeFileSync(reportFile, "fatal: unrecoverable\n");
    const statePath = runnerAgentStatePath(stateDir, "agent-1", "run-1");
    createRunnerAgentState(statePath, { session: "agent-1-run-1", agent_id: "agent-1", retry_attempt: "1" });
    const scheduled: Array<[string, string, number]> = [];
    const result = handleAgentError({ agentId: "agent-1", errorType: "error", reportFile, chainFile, stateDir, runId: "run-1" }, () => undefined, (...args) => scheduled.push(args));
    expect(result).toMatchObject({ code: 0, action: "handler", handlerAgent: "handler" });
    expect(scheduled).toEqual([[chainFile, "handler", 2]]);
    expect(readRunnerAgentState(statePath)).toMatchObject({ status: "failed", failed_reason: "error" });
    expect(readFileSync(statePath, "utf8")).toContain("status: failed");
  });

  describe("typed retry/handler relaunch dispatch", () => {
    const envKeys = ["MENTIKO_RUN_ID", "RUN_ID", "MENTIKO_RUN_DIR"];
    const savedEnv: Record<string, string | undefined> = {};
    beforeEach(() => envKeys.forEach((key) => { savedEnv[key] = process.env[key]; }));
    afterEach(() => envKeys.forEach((key) => {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }));

    it("builds a typed launch-agent plan that reuses the exact run id, run-local snapshot, and run dir", () => {
      const runRoot = mkdtempSync(join(tmpdir(), "mentiko-error-relaunch-"));
      const bundleDir = mkdtempSync(join(tmpdir(), "mentiko-error-bundle-"));
      // sibling launch-agent bundle must resolve from the dispatch bundle's own dir
      const launcher = join(bundleDir, "runner-v2-launch-agent.js");
      writeFileSync(launcher, "#!/usr/bin/env node\n");
      const bundlePath = join(bundleDir, "runner-error-handling.js");
      const chainFile = join(runRoot, "chain.json");
      writeFileSync(chainFile, "{}");

      process.env.MENTIKO_RUN_ID = "run-relaunch";
      delete process.env.MENTIKO_RUN_DIR;

      const plan = buildTypedRelaunchPlan(chainFile, "agent-1", bundlePath);
      expect(plan).toMatchObject({
        launcher,
        args: [chainFile, "agent-1"],
        runId: "run-relaunch",
        runDir: runRoot,
        runJsonPath: join(runRoot, "run.json"),
      });
      expect(plan.env.MENTIKO_RUN_ID).toBe("run-relaunch");
      expect(plan.env.RUN_ID).toBe("run-relaunch");
      expect(plan.env.MENTIKO_RUN_DIR).toBe(runRoot);
    });

    it("prefers an explicit MENTIKO_RUN_DIR and fails closed without a run id", () => {
      const runRoot = mkdtempSync(join(tmpdir(), "mentiko-error-explicit-"));
      const bundleDir = mkdtempSync(join(tmpdir(), "mentiko-error-bundle2-"));
      writeFileSync(join(bundleDir, "runner-v2-launch-agent.js"), "");
      const chainFile = join(runRoot, "chain.json");
      writeFileSync(chainFile, "{}");

      process.env.MENTIKO_RUN_ID = "run-explicit";
      process.env.MENTIKO_RUN_DIR = runRoot;
      expect(buildTypedRelaunchPlan(chainFile, "agent-1", join(bundleDir, "runner-error-handling.js")).runDir).toBe(runRoot);

      delete process.env.MENTIKO_RUN_ID;
      delete process.env.RUN_ID;
      expect(() => buildTypedRelaunchPlan(chainFile, "agent-1", join(bundleDir, "runner-error-handling.js"))).toThrow("MENTIKO_RUN_ID");
    });

    it("fails closed when the typed launch-agent bundle is missing", () => {
      const runRoot = mkdtempSync(join(tmpdir(), "mentiko-error-missing-"));
      const bundleDir = mkdtempSync(join(tmpdir(), "mentiko-error-bundle3-"));
      const chainFile = join(runRoot, "chain.json");
      writeFileSync(chainFile, "{}");
      process.env.MENTIKO_RUN_ID = "run-missing";
      expect(() => buildTypedRelaunchPlan(chainFile, "agent-1", join(bundleDir, "runner-error-handling.js"))).toThrow("launch-agent bundle missing");
    });

    it("authorizes one fresh occurrence for the matching run and leaves a foreign record untouched", () => {
      const runRoot = mkdtempSync(join(tmpdir(), "mentiko-error-authorize-"));
      const runJsonPath = join(runRoot, "run.json");
      const record = { id: "run-auth", chain: "c", goal: "g", started: "2026-07-16T00:00:00.000Z", status: "running", sessions: ["s1"], agents: [], parent_run_id: "run-parent" };
      writeFileSync(runJsonPath, JSON.stringify(record));

      authorizeTypedRelaunch(runJsonPath, "run-auth");
      const authorized = JSON.parse(readFileSync(runJsonPath, "utf8"));
      expect(authorized.id).toBe("run-auth");
      expect(authorized.parent_run_id).toBe("run-parent");
      expect(authorized.resumedAt).toEqual(expect.any(String));

      authorizeTypedRelaunch(runJsonPath, "run-foreign");
      const foreign = JSON.parse(readFileSync(runJsonPath, "utf8"));
      expect(foreign.id).toBe("run-auth");
      expect(foreign.resumedAt).toBe(authorized.resumedAt); // foreign id must not re-authorize or mutate

      // best-effort: a missing record never throws
      expect(() => authorizeTypedRelaunch(join(runRoot, "absent.json"), "run-auth")).not.toThrow();
    });
  });
});
