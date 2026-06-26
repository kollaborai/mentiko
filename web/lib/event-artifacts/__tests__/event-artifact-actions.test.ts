import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { applyDraftChildTasks } from "@/lib/event-artifacts/event-artifact-actions";
import { closeAll, taskCreate, taskGet } from "@/lib/tasks/task-store";

jest.mock("@/lib/config", () => ({
  __esModule: true,
  default: {
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

  it("imports draft child tasks once and pauses the parent", () => {
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
      type: "task",
      priority: 1,
      subtasks: [
        { title: "Fix failing tests", description: "Repair regression", type: "bug" },
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
    expect([...second.createdTaskIds].sort()).toEqual([...first.createdTaskIds].sort());
    expect(taskGet("default", parent.id, "default")?.metadata).toMatchObject({
      auto_run: false,
      event_artifact_status: "waiting_on_children",
      event_artifact_execution_id: "exec-1",
    });
  });
});
