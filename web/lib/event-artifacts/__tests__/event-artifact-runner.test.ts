import { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runQualityGateEventArtifact } from "@/lib/event-artifacts/event-artifact-runner";
import { validateGeneratedTask } from "@/lib/tasks/generated-task-validation";

jest.mock("@/lib/config", () => ({
  __esModule: true,
  default: { root: join(process.cwd(), "..") },
  orgPath: (...parts: string[]) => join(globalThis.__EVENT_ARTIFACT_RUNNER_ROOT__, ...parts),
}));

declare global {
  var __EVENT_ARTIFACT_RUNNER_ROOT__: string;
}

describe("event artifact runner", () => {
  beforeEach(() => {
    globalThis.__EVENT_ARTIFACT_RUNNER_ROOT__ = mkdtempSync(join(tmpdir(), "event-artifact-runner-org-"));
  });

  it("writes a run-attached triage artifact and draft tasks for quality gate failures", () => {
    const runRoot = mkdtempSync(join(tmpdir(), "event-artifact-runner-"));
    const artifactsDir = join(runRoot, "artifacts");
    mkdirSync(artifactsDir, { recursive: true });

    const result = runQualityGateEventArtifact({
      namespaceId: "default",
      orgId: "default",
      runId: "run-1",
      runArtifactsDir: artifactsDir,
      payload: {
        event: { name: "quality_gate.failed", source: "runner-v2", timestamp: "2026-06-26T00:00:00.000Z" },
        namespace: { id: "default" },
        org: { id: "default" },
        run: { id: "run-1", status: "failed", artifactsDir },
        task: { id: "FEAT-1", title: "Fix stash API", status: "in_progress", priority: 1 },
        qualityGate: {
          status: "failed",
          agentId: "validator",
          reason: "tests failed",
          findings: ["stash tests failed"],
          risks: ["regression"],
          nextActions: ["fix stash endpoint"],
        },
        evidence: { changedFiles: ["web/app/api/git/stashes/route.ts"], liveSessions: [], artifacts: [] },
      },
    });

    expect(result.status).toBe("awaiting_review");
    expect(existsSync(join(artifactsDir, "triage-result.json"))).toBe(true);
    expect(existsSync(join(artifactsDir, "draft-child-tasks.json"))).toBe(true);
    expect(readFileSync(join(artifactsDir, "triage-result.json"), "utf8")).toContain("Fix stash api validator findings for FEAT-1 Fix stash API");
    const draft = JSON.parse(readFileSync(join(artifactsDir, "draft-child-tasks.json"), "utf8"));
    expect(validateGeneratedTask(draft)).toMatchObject({ valid: true, errors: [] });
    expect(draft).toMatchObject({
      type: "epic",
      acceptance_criteria: expect.any(String),
    });
  });

  it("uses validator summary details when the quality gate points at a summary artifact", () => {
    const runRoot = mkdtempSync(join(tmpdir(), "event-artifact-runner-"));
    const artifactsDir = join(runRoot, "artifacts");
    mkdirSync(artifactsDir, { recursive: true });
    const summaryPath = join(artifactsDir, "validator-summary.json");
    writeFileSync(summaryPath, JSON.stringify({
      status: "partial",
      executiveSummary: "Git API validation complete: 132/141 tests passing. 9 failures in Stash API tests are mock implementation limitations.",
      findings: [
        "Stash API: 87.3% pass rate (62/71 tests) - 9 failures are mock limitations",
        "Mock Git API needs enhancements for conflict detection and diff generation",
      ],
      risks: ["Mock implementation gaps prevent full validation of advanced stash operations"],
      nextAgentHints: [
        "Consider enhancing mock Git API implementation to fix the 9 failing tests",
        "Fix Permission Mock",
      ],
    }), "utf8");

    runQualityGateEventArtifact({
      namespaceId: "default",
      orgId: "default",
      runId: "run-1",
      runArtifactsDir: artifactsDir,
      payload: {
        event: { name: "quality_gate.failed", source: "runner-v2", timestamp: "2026-06-26T00:00:00.000Z" },
        namespace: { id: "default" },
        org: { id: "default" },
        run: { id: "run-1", status: "failed", artifactsDir },
        task: { id: "FEAT-021", title: "Write comprehensive tests", status: "in_progress", priority: 1 },
        qualityGate: {
          status: "failed",
          agentId: "git-api-test-validator-v2",
          reason: "quality gate agent summary status is partial",
          findings: [`summary=${summaryPath}`],
          risks: [],
          nextActions: ["Review the quality gate artifact and fix the failing condition."],
        },
        evidence: { changedFiles: [], liveSessions: [], artifacts: [summaryPath] },
      },
    });

    const draft = JSON.parse(readFileSync(join(artifactsDir, "draft-child-tasks.json"), "utf8"));
    expect(draft.title).toBe("Fix 9 failing stash api tests from mock limitations for FEAT-021 Write comprehensive tests");
    expect(draft.description).toContain("132/141 tests passing");
    expect(draft.subtasks[0].title).toBe("Enhance the mock Git API so stash API edge cases pass validation.");
  });

  it("dedupes repeat handling for the same run and task", () => {
    const runRoot = mkdtempSync(join(tmpdir(), "event-artifact-runner-"));
    const artifactsDir = join(runRoot, "artifacts");
    mkdirSync(artifactsDir, { recursive: true });
    const input = {
      namespaceId: "default",
      orgId: "default",
      runId: "run-1",
      runArtifactsDir: artifactsDir,
      payload: {
        event: { name: "quality_gate.failed" as const, source: "runner-v2" as const, timestamp: "2026-06-26T00:00:00.000Z" },
        namespace: { id: "default" },
        org: { id: "default" },
        run: { id: "run-1", status: "failed", artifactsDir },
        task: { id: "FEAT-1", title: "Fix stash API", status: "in_progress" },
        qualityGate: { status: "failed" as const, reason: "tests failed", findings: [], risks: [], nextActions: [] },
        evidence: { changedFiles: [], liveSessions: [], artifacts: [] },
      },
    };

    const first = runQualityGateEventArtifact(input);
    const second = runQualityGateEventArtifact(input);

    expect(first.status).toBe("awaiting_review");
    expect(second.status).toBe("deduped");
    expect(second.executionId).toBe(first.executionId);
  });

  it("recovers stale pending records instead of suppressing artifact generation", () => {
    const runRoot = mkdtempSync(join(tmpdir(), "event-artifact-runner-"));
    const artifactsDir = join(runRoot, "artifacts");
    mkdirSync(artifactsDir, { recursive: true });
    const input = {
      namespaceId: "default",
      orgId: "default",
      runId: "run-1",
      runArtifactsDir: artifactsDir,
      payload: {
        event: { name: "quality_gate.failed" as const, source: "runner-v2" as const, timestamp: "2026-06-26T00:00:00.000Z" },
        namespace: { id: "default" },
        org: { id: "default" },
        run: { id: "run-1", status: "failed", artifactsDir },
        task: { id: "FEAT-1", title: "Fix stash API", status: "in_progress" },
        qualityGate: { status: "failed" as const, reason: "tests failed", findings: [], risks: [], nextActions: [] },
        evidence: { changedFiles: [], liveSessions: [], artifacts: [] },
      },
    };

    const first = runQualityGateEventArtifact(input);
    const ledgerPath = join(artifactsDir, "event-artifact-executions.jsonl");
    const pendingOnly = readFileSync(ledgerPath, "utf8").split("\n").find((line) => line.includes("artifact_pending"));
    expect(pendingOnly).toBeTruthy();
    writeFileSync(ledgerPath, `${pendingOnly}\n`, "utf8");
    unlinkSync(join(artifactsDir, "triage-result.json"));
    unlinkSync(join(artifactsDir, "draft-child-tasks.json"));

    const recovered = runQualityGateEventArtifact(input);

    expect(recovered.status).toBe("awaiting_review");
    expect(recovered.executionId).toBe(first.executionId);
    expect(existsSync(join(artifactsDir, "triage-result.json"))).toBe(true);
  });
});
