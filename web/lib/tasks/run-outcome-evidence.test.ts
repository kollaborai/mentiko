/** @jest-environment node */

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
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
