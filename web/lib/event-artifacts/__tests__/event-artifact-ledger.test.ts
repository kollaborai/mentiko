import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  appendExecutionRecord,
  findExecutionByDedupeKey,
  ledgerPathForArtifactsDir,
  resolveArtifactOutputPath,
} from "@/lib/event-artifacts/event-artifact-ledger";

describe("event artifact ledger", () => {
  it("writes and reads execution records by dedupe key", () => {
    const artifactsDir = mkdtempSync(join(tmpdir(), "event-artifact-ledger-"));

    appendExecutionRecord(artifactsDir, {
      id: "exec-1",
      mappingId: "quality-gate-failed-draft-tasks",
      event: "quality_gate.failed",
      evaluatedDedupeKey: "default:default:FEAT-1:run-1:quality_gate.failed",
      status: "awaiting_review",
      createdAt: "2026-06-26T00:00:00.000Z",
      updatedAt: "2026-06-26T00:00:00.000Z",
    });

    expect(existsSync(ledgerPathForArtifactsDir(artifactsDir))).toBe(true);
    expect(findExecutionByDedupeKey(artifactsDir, "default:default:FEAT-1:run-1:quality_gate.failed")).toMatchObject({
      id: "exec-1",
      status: "awaiting_review",
    });
    expect(readFileSync(ledgerPathForArtifactsDir(artifactsDir), "utf8")).toContain("\"exec-1\"");
  });

  it("rejects artifact output paths that escape the artifacts dir", () => {
    const artifactsDir = mkdtempSync(join(tmpdir(), "event-artifact-ledger-"));

    expect(() => resolveArtifactOutputPath(artifactsDir, "../bad.json")).toThrow(/artifact output must be a file name/);
    expect(resolveArtifactOutputPath(artifactsDir, "triage-result.json")).toBe(join(artifactsDir, "triage-result.json"));
  });

  it("creates the artifacts dir when writing the ledger", () => {
    const root = mkdtempSync(join(tmpdir(), "event-artifact-ledger-root-"));
    const artifactsDir = join(root, "run-1", "artifacts");

    appendExecutionRecord(artifactsDir, {
      id: "exec-1",
      mappingId: "map-1",
      event: "quality_gate.failed",
      evaluatedDedupeKey: "key",
      status: "failed",
      createdAt: "2026-06-26T00:00:00.000Z",
      updatedAt: "2026-06-26T00:00:00.000Z",
    });

    expect(existsSync(artifactsDir)).toBe(true);
  });
});
