import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
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
    const scheduled: Array<[string, string, string, number]> = [];
    const result = handleAgentError({ agentId: "agent-1", errorType: "error", reportFile, chainFile, chainRunner: "/bin/true", stateDir, runId: "run-1" }, () => undefined, (...args) => scheduled.push(args));
    expect(result).toMatchObject({ code: 0, action: "retry", retryCount: 0, maxRetries: 2 });
    expect(scheduled).toEqual([["/bin/true", chainFile, "agent-1", 1]]);
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
    const scheduled: Array<[string, string, string, number]> = [];
    const result = handleAgentError({ agentId: "agent-1", errorType: "error", reportFile, chainFile, chainRunner: "/bin/true", stateDir, runId: "run-1" }, () => undefined, (...args) => scheduled.push(args));
    expect(result).toMatchObject({ code: 0, action: "handler", handlerAgent: "handler" });
    expect(scheduled).toEqual([["/bin/true", chainFile, "handler", 2]]);
    expect(readRunnerAgentState(statePath)).toMatchObject({ status: "failed", failed_reason: "error" });
    expect(readFileSync(statePath, "utf8")).toContain("status: failed");
  });
});
