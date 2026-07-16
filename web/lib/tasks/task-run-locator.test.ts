/** @jest-environment node */

import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunRecord } from "@/lib/runs/run-record";
import {
  DuplicateTaskRunLocationError,
  TaskRunMismatchError,
  TaskRunMissingError,
  createTaskRunScope,
  assertNoDuplicateTaskRunLocations,
  locateTaskRun,
  parseTaskRunScope,
  resolveTaskRunLocation,
  verifyTaskRunRecord,
} from "./task-run-locator";

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

function scope(overrides: Partial<{
  version: 1;
  taskId: string;
  runId: string;
  namespaceId: string;
  orgId: string;
}> = {}) {
  return {
    version: 1 as const,
    taskId: "TASK-059",
    runId: "run-task-059",
    namespaceId: "default",
    orgId: "default",
    ...overrides,
  };
}

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-task-059",
    chain: "Task execution",
    goal: "Verify one task run location.",
    started: "2026-07-15T12:00:00.000Z",
    status: "running",
    agents: [],
    taskId: "TASK-059",
    metadata: { taskExecution: true },
    ...overrides,
  };
}

function writeRun(scopeValue = scope(), record = run()): string {
  const location = resolveTaskRunLocation(scopeValue);
  mkdirSync(location.runDir, { recursive: true });
  writeFileSync(location.runJsonPath, JSON.stringify(record));
  return location.runJsonPath;
}

beforeEach(() => {
  mockRoot = mkdtempSync(join(tmpdir(), "mentiko-task-run-locator-"));
});

describe("task run locator", () => {
  it("freezes an explicit scope and resolves the default org directly under its namespace", () => {
    const persisted = createTaskRunScope(scope());
    const location = resolveTaskRunLocation(persisted);

    expect(Object.isFrozen(persisted)).toBe(true);
    expect(location.runsDir).toBe(join(realpathSync(mockRoot), "namespaces", "default", "runs"));
    expect(location.runJsonPath).toBe(join(location.runsDir, "run-task-059", "run.json"));
  });

  it("rejects malformed persisted scope values before any path is resolved", () => {
    expect(() => parseTaskRunScope(null)).toThrow("Task run scope must be an object");
    expect(() => parseTaskRunScope({ ...scope(), runId: "not-a-run" })).toThrow("runId is invalid");
  });

  it("reads only the run at its persisted scope and validates task ownership", () => {
    const persisted = scope({ namespaceId: "tenant-a", orgId: "engineering" });
    writeRun(persisted);

    expect(locateTaskRun(persisted)).toMatchObject({
      scope: persisted,
      run: { id: "run-task-059", taskId: "TASK-059" },
    });
  });

  it("does not scan another root when the declared location is missing", () => {
    writeRun(scope({ namespaceId: "other-namespace" }));

    expect(() => locateTaskRun(scope())).toThrow(TaskRunMissingError);
  });

  it("rejects record identity, task ownership, and non-execution provenance mismatches", () => {
    const persisted = scope();
    expect(() => verifyTaskRunRecord(persisted, run({ id: "run-other" }))).toThrow(TaskRunMismatchError);
    expect(() => verifyTaskRunRecord(persisted, run({ taskId: "TASK-other" }))).toThrow(TaskRunMismatchError);
    expect(() => verifyTaskRunRecord(persisted, run({ metadata: { generationKind: "run_summary" } })))
      .toThrow(TaskRunMismatchError);
  });

  it("rejects duplicate persisted locations without searching filesystem roots", () => {
    expect(() => assertNoDuplicateTaskRunLocations([
      scope(),
      scope({ taskId: "TASK-060" }),
    ])).toThrow(DuplicateTaskRunLocationError);
    expect(() => assertNoDuplicateTaskRunLocations([
      scope(),
      scope({ namespaceId: "other-namespace" }),
    ])).toThrow(DuplicateTaskRunLocationError);
  });
});
