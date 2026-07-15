import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { applyDraftChildTasks } from "@/lib/event-artifacts/event-artifact-actions";
import { closeAll, taskCreate, taskGet } from "@/lib/tasks/task-store";

jest.mock("@/lib/config", () => ({
  __esModule: true,
  default: {
    root: join(process.cwd(), ".."),
    get globalRoot() {
      return globalThis.__EVENT_ARTIFACT_TASK_ROOT__;
    },
    codeRoot: "/repo",
    chainsDir: "/repo/chains",
  },
}));

declare global {
  var __EVENT_ARTIFACT_TASK_ROOT__: string;
}

describe("event artifact actions", () => {
  beforeEach(() => {
    closeAll();
    globalThis.__EVENT_ARTIFACT_TASK_ROOT__ = mkdtempSync(join(tmpdir(), "event-artifact-tasks-"));
  });

  afterEach(() => {
    closeAll();
  });

  it("creates one follow-up child task, blocks the parent, and keeps auto-run armed", () => {
    const parent = taskCreate("default", {
      title: "Parent feature",
      issue_type: "feature",
      metadata: { auto_run: true },
      created_by: "test",
    }, "default");
    const artifactsDir = mkdtempSync(join(tmpdir(), "event-artifact-actions-"));
    const draftPath = join(artifactsDir, "draft-child-tasks.json");
    writeFileSync(draftPath, JSON.stringify({
      title: "Fix quality gate failure for Parent feature",
      description: "Generated from quality gate failure.",
      type: "epic",
      priority: 1,
      subtasks: [
        { title: "Fix failing tests", description: "Repair regression", type: "bug", priority: 1 },
      ],
    }), "utf8");

    const first = applyDraftChildTasks({
      namespaceId: "default",
      orgId: "default",
      parentTaskId: parent.id,
      draftTaskPath: draftPath,
      executionId: "exec-1",
      runId: "run-1",
      artifactPath: join(artifactsDir, "triage-result.json"),
      createdBy: "event-artifact",
    });
    const second = applyDraftChildTasks({
      namespaceId: "default",
      orgId: "default",
      parentTaskId: parent.id,
      draftTaskPath: draftPath,
      executionId: "exec-1",
      runId: "run-1",
      artifactPath: join(artifactsDir, "triage-result.json"),
      createdBy: "event-artifact",
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(first.createdTaskIds).toHaveLength(1);
    expect([...second.createdTaskIds].sort()).toEqual([...first.createdTaskIds].sort());
    const child = taskGet("default", first.createdTaskIds[0], "default");
    expect(child).toMatchObject({
      issue_type: "bug",
      parent_id: parent.id,
    });
    expect(child?.description).toContain("Follow-up checklist:");
    expect(child?.description).toContain("Fix failing tests");
    const updatedParent = taskGet("default", parent.id, "default");
    expect(updatedParent?.metadata).toMatchObject({
      auto_run: true,
      event_artifact_blocks_auto_run: true,
      event_artifact_status: "waiting_on_children",
      event_artifact_execution_id: "exec-1",
    });
    expect(updatedParent?.dependencies?.map((dep) => dep.depends_on_id)).toContain(child?.id);
  });

  it("rejects a draft that does not match task.schema.json before importing it", () => {
    const parent = taskCreate("default", {
      title: "Parent feature",
      issue_type: "feature",
      created_by: "test",
    }, "default");
    const artifactsDir = mkdtempSync(join(tmpdir(), "event-artifact-actions-invalid-"));
    const draftPath = join(artifactsDir, "draft-child-tasks.json");
    writeFileSync(draftPath, JSON.stringify({
      title: "Invalid follow-up tree",
      description: "This parent has subtasks but is not an epic.",
      type: "bug",
      priority: 1,
      subtasks: [
        { title: "Repair it", description: "Repair the invalid tree", type: "bug", priority: 1 },
      ],
    }), "utf8");

    expect(() => applyDraftChildTasks({
      namespaceId: "default",
      orgId: "default",
      parentTaskId: parent.id,
      draftTaskPath: draftPath,
      executionId: "exec-invalid",
      runId: "run-invalid",
      artifactPath: join(artifactsDir, "triage-result.json"),
      createdBy: "event-artifact",
    })).toThrow("generated task does not match task.schema.json");

    expect(taskGet("default", parent.id, "default")?.metadata).not.toHaveProperty("event_artifact_execution_id");
  });
});
