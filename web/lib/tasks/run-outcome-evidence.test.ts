/** @jest-environment node */

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  currentRunArtifacts,
  currentRunStatus,
  currentRunSummary,
  isOutcomeSummaryTerminalStatus,
} from "./run-outcome-evidence";

let mockRoot = "";

jest.mock("@/lib/config", () => ({
  orgPath: (namespaceId: string, orgId: string, ...segments: string[]) => join(
    mockRoot,
    "namespaces",
    namespaceId,
    ...(orgId === "default" ? [] : ["orgs", orgId]),
    ...segments,
  ),
}));

jest.mock("@/lib/links/link-run-runtime", () => ({
  resolveLinkRunsDir: (namespaceId: string, orgId: string) => join(
    mockRoot,
    "request-roots",
    namespaceId,
    orgId,
    "runs",
  ),
}));

function writeScopedRun(scope: {
  taskId: string;
  runId: string;
  namespaceId: string;
  orgId: string;
}, status: string, summary?: unknown) {
  const runDir = join(
    mockRoot,
    "namespaces",
    scope.namespaceId,
    ...(scope.orgId === "default" ? [] : ["orgs", scope.orgId]),
    "runs",
    scope.runId,
  );
  mkdirSync(join(runDir, "artifacts"), { recursive: true });
  writeFileSync(join(runDir, "run.json"), JSON.stringify({
    id: scope.runId,
    taskId: scope.taskId,
    chain: "Task execution",
    goal: "Verify direct task-run evidence lookup.",
    started: "2026-07-15T12:00:00.000Z",
    status,
    agents: [],
    metadata: { taskExecution: true },
  }));
  if (summary) writeFileSync(join(runDir, "artifacts", "run-summary.json"), JSON.stringify(summary));
}

beforeEach(() => {
  mockRoot = mkdtempSync(join(tmpdir(), "mentiko-run-outcome-evidence-"));
});

/** Unscoped run dir: the same root currentRunArtifacts/currentRunSummary resolve to when no task_run_scope is persisted. */
function directRunDir(namespaceId: string, orgId: string, runId: string): string {
  return join(mockRoot, "request-roots", namespaceId, orgId, "runs", runId);
}

describe("outcome-summary execution terminal statuses", () => {
  it("accepts a blocked run so its terminal cause can be summarized", () => {
    expect(isOutcomeSummaryTerminalStatus("blocked")).toBe(true);
  });

  it("does not treat an active run as summary-ready", () => {
    expect(isOutcomeSummaryTerminalStatus("running")).toBe(false);
  });

  it("reads a persisted task-run scope directly instead of the request root", () => {
    const taskRunScope = {
      version: 1 as const,
      taskId: "TASK-059",
      runId: "run-task-059",
      namespaceId: "persisted-namespace",
      orgId: "engineering",
    };
    writeScopedRun(taskRunScope, "blocked", { conclusion: "agent MCP tool was unavailable" });

    const metadata = { task_run_scope: taskRunScope };
    expect(currentRunStatus("request-namespace", "default", "run-task-059", metadata)).toBe("blocked");
    expect(currentRunSummary(
      "request-namespace",
      "default",
      "run-task-059",
      null,
      metadata,
    )).toEqual({ conclusion: "agent MCP tool was unavailable" });
  });
});

describe("currentRunArtifacts", () => {
  it("is self-locating: carries the absolute artifacts root and source run id so a reader can never resolve against the wrong directory", () => {
    const runDir = directRunDir("default", "default", "run-abc");
    mkdirSync(join(runDir, "artifacts"), { recursive: true });
    writeFileSync(
      join(runDir, "artifacts", "final-verifier-summary.json"),
      JSON.stringify({ verdict: "pass" }),
    );

    const result = currentRunArtifacts("default", "default", "run-abc", undefined) as {
      sourceRunId: string;
      artifactsRoot: string;
      disk: Array<{ path: string; absolutePath: string; name: string }>;
    };

    expect(result.sourceRunId).toBe("run-abc");
    expect(result.artifactsRoot).toBe(join(runDir, "artifacts"));
    expect(result.disk).toHaveLength(1);
    expect(result.disk[0].path).toBe(join("artifacts", "final-verifier-summary.json"));
    expect(result.disk[0].absolutePath).toBe(join(runDir, "artifacts", "final-verifier-summary.json"));
  });
});

describe("currentRunSummary aggregation (run-summary.json absent)", () => {
  it("aggregates per-agent *-summary.json files and generation-result.json, with final-verifier first", () => {
    const runDir = directRunDir("default", "default", "run-agg");
    mkdirSync(join(runDir, "artifacts"), { recursive: true });
    writeFileSync(join(runDir, "artifacts", "orchestrator-summary.json"), JSON.stringify({ status: "ok" }));
    writeFileSync(join(runDir, "artifacts", "final-verifier-summary.json"), JSON.stringify({ verdict: "pass" }));
    writeFileSync(join(runDir, "artifacts", "generation-result.json"), JSON.stringify({ output: "done" }));

    const result = currentRunSummary("default", "default", "run-agg", null) as {
      source: string;
      agentSummaries: Record<string, unknown>;
      generationResult: unknown;
    };

    expect(result.source).toBe("aggregated-agent-summaries");
    expect(Object.keys(result.agentSummaries)).toEqual([
      "final-verifier-summary.json",
      "orchestrator-summary.json",
    ]);
    expect(result.agentSummaries["final-verifier-summary.json"]).toEqual({ verdict: "pass" });
    expect(result.generationResult).toEqual({ output: "done" });
  });

  it("caps oversized per-agent summary strings so the prompt stays bounded", () => {
    const runDir = directRunDir("default", "default", "run-huge");
    mkdirSync(join(runDir, "artifacts"), { recursive: true });
    const huge = "x".repeat(10000);
    writeFileSync(join(runDir, "artifacts", "chatty-agent-summary.json"), JSON.stringify({ notes: huge }));

    const result = currentRunSummary("default", "default", "run-huge", null) as {
      agentSummaries: Record<string, { notes: string }>;
    };

    expect(result.agentSummaries["chatty-agent-summary.json"].notes.length).toBeLessThan(huge.length);
    expect(result.agentSummaries["chatty-agent-summary.json"].notes).toContain("[truncated]");
  });

  it("falls back to the provided fallback when nothing is on disk", () => {
    const runDir = directRunDir("default", "default", "run-empty");
    mkdirSync(join(runDir, "artifacts"), { recursive: true });

    expect(currentRunSummary("default", "default", "run-empty", { fallback: true })).toEqual({ fallback: true });
  });
});
