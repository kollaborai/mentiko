/**
 * Workspace_id stamping for AI-generated task trees.
 *
 * A generated tree must never land with workspace_id NULL when a workspace is
 * knowable. Resolution order: explicit workspacePath -> existing parent's
 * workspace_id -> the generating run's workspace (run.json).
 *
 * @jest-environment node
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// jest hoists jest.mock above imports, so compute the temp paths INSIDE the
// factory (can't reference outer consts — TDZ). Re-derive the same paths in the
// test body via process.pid, which is stable for the process.
jest.mock("@/lib/config", () => {
  const path = jest.requireActual("node:path");
  const os = jest.requireActual("node:os");
  const root = path.join(os.tmpdir(), `mentiko-gen-test-${process.pid}`);
  return {
    __esModule: true,
    default: {
      globalRoot: root,
      codeRoot: root,
      runsDir: path.join(root, "runs"),
    },
  };
});

import { importGeneratedTaskTree, processTaskGenerationResult } from "../generated-task-import";
import { taskCreate, taskGet, closeAll } from "../task-store";

// createTaskDecision writes to decision-storage (filesystem); mock it so the
// decision-branch test doesn't need that setup.
const mockCreateTaskDecision = jest.fn();
jest.mock("@/lib/tasks/task-decision-link", () => ({
  createTaskDecision: (...args: unknown[]) => mockCreateTaskDecision(...args),
}));

const NS = "default";
const ORG = "default";
const RUNS_DIR = join(tmpdir(), `mentiko-gen-test-${process.pid}`, "runs");

afterAll(() => closeAll());

describe("importGeneratedTaskTree workspace_id stamping", () => {
  it("stamps explicit workspacePath on parent and every subtask", () => {
    const result = importGeneratedTaskTree({
      namespaceId: NS,
      orgId: ORG,
      generated: {
        title: "Build feature X",
        type: "feature",
        subtasks: [
          { title: "Sub A" },
          { title: "Sub B" },
        ],
      },
      workspacePath: "/ws/explicit",
      createdBy: "test",
      generationJobId: "job-explicit",
    });

    expect(taskGet(ORG, result.parentId, NS)!.workspace_id).toBe("/ws/explicit");
    for (const id of result.createdTaskIds) {
      expect(taskGet(ORG, id, NS)!.workspace_id).toBe("/ws/explicit");
    }
  });

  it("inherits an existing parent task's workspace when workspacePath is omitted", () => {
    // pre-existing scoped epic to generate under
    const host = taskCreate(ORG, {
      title: "Host epic",
      issue_type: "epic",
      workspace_id: "/ws/inherited",
    }, NS);

    const result = importGeneratedTaskTree({
      namespaceId: NS,
      orgId: ORG,
      generated: {
        title: "Generated under host",
        subtasks: [{ title: "Child of generated" }],
      },
      parentId: host.id,
      createdBy: "test",
      generationJobId: "job-parent",
    });

    expect(taskGet(ORG, result.parentId, NS)!.workspace_id).toBe("/ws/inherited");
    for (const id of result.createdTaskIds) {
      expect(taskGet(ORG, id, NS)!.workspace_id).toBe("/ws/inherited");
    }
  });

  it("falls back to the generating run's workspace (run.json) when nothing else is known", () => {
    const runId = "run-fallback-test";
    mkdirSync(join(RUNS_DIR, runId), { recursive: true });
    writeFileSync(
      join(RUNS_DIR, runId, "run.json"),
      JSON.stringify({ workspacePath: "/ws/from-run", status: "completed" }),
      "utf8",
    );

    const result = importGeneratedTaskTree({
      namespaceId: NS,
      orgId: ORG,
      generated: { title: "Run-scoped tree", subtasks: [{ title: "Sub" }] },
      createdBy: "test",
      generationRunId: runId,
      generationJobId: "job-run",
    });

    expect(taskGet(ORG, result.parentId, NS)!.workspace_id).toBe("/ws/from-run");
    for (const id of result.createdTaskIds) {
      expect(taskGet(ORG, id, NS)!.workspace_id).toBe("/ws/from-run");
    }
  });

  it("leaves workspace_id NULL only when no workspace is knowable (genuinely global)", () => {
    const result = importGeneratedTaskTree({
      namespaceId: NS,
      orgId: ORG,
      generated: { title: "Global tree", subtasks: [{ title: "Sub" }] },
      createdBy: "test",
      generationJobId: "job-global",
      // no workspacePath, no parentId, no generationRunId
    });

    expect(taskGet(ORG, result.parentId, NS)!.workspace_id).toBeNull();
  });

  it("explicit workspacePath wins over a run workspace", () => {
    const runId = "run-priority-test";
    mkdirSync(join(RUNS_DIR, runId), { recursive: true });
    writeFileSync(
      join(RUNS_DIR, runId, "run.json"),
      JSON.stringify({ workspacePath: "/ws/run-loses" }),
      "utf8",
    );

    const result = importGeneratedTaskTree({
      namespaceId: NS,
      orgId: ORG,
      generated: { title: "Priority tree" },
      workspacePath: "/ws/explicit-wins",
      generationRunId: runId,
      createdBy: "test",
      generationJobId: "job-priority",
    });

    expect(taskGet(ORG, result.parentId, NS)!.workspace_id).toBe("/ws/explicit-wins");
  });
});

describe("processTaskGenerationResult — agent-as-gate route handling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateTaskDecision.mockResolvedValue({
      decision: { id: "dec-x" },
      task: { id: "DEC-X" },
    });
  });

  it("route 'task' envelope -> imports result.task as a task tree", async () => {
    const outcome = await processTaskGenerationResult({
      namespaceId: NS, orgId: ORG, createdBy: "test", generationJobId: "j1",
      result: { route: "task", task: { title: "Via envelope", type: "task", priority: 2 } },
    });
    expect(outcome.kind).toBe("task");
    expect(taskGet(ORG, (outcome as { parentId: string }).parentId, NS)).toBeTruthy();
    expect(mockCreateTaskDecision).not.toHaveBeenCalled();
  });

  it("route 'decision' (routing allowed) -> creates a decision", async () => {
    const outcome = await processTaskGenerationResult({
      namespaceId: NS, orgId: ORG, createdBy: "test", generationJobId: "j2",
      result: { route: "decision", reason: "Multiple viable approaches with real tradeoffs." },
    });
    expect(outcome).toEqual({ kind: "decision", decisionId: "dec-x", taskId: "DEC-X", reason: "Multiple viable approaches with real tradeoffs." });
    expect(mockCreateTaskDecision).toHaveBeenCalledTimes(1);
  });

  it("route 'decision' with allowDecisionRouting:false -> forced into a task", async () => {
    const outcome = await processTaskGenerationResult({
      namespaceId: NS, orgId: ORG, createdBy: "test", generationJobId: "j3",
      allowDecisionRouting: false,
      result: { route: "decision", reason: "ignore me", task: { title: "Forced task", type: "task", priority: 2 } },
    });
    expect(outcome.kind).toBe("task");
    expect(mockCreateTaskDecision).not.toHaveBeenCalled();
  });

  it("bare task object (no route field) -> imports directly (backward compat)", async () => {
    const outcome = await processTaskGenerationResult({
      namespaceId: NS, orgId: ORG, createdBy: "test", generationJobId: "j4",
      result: { title: "Bare legacy task", type: "task", priority: 2 },
    });
    expect(outcome.kind).toBe("task");
    expect(taskGet(ORG, (outcome as { parentId: string }).parentId, NS)!.title).toBe("Bare legacy task");
  });

  it("decision hand-back without a reason -> uses a fallback reason", async () => {
    const outcome = await processTaskGenerationResult({
      namespaceId: NS, orgId: ORG, createdBy: "test", generationJobId: "j5",
      result: { route: "decision" },
    });
    expect(outcome.kind).toBe("decision");
    expect((outcome as { reason?: string }).reason).toMatch(/decision/i);
  });
});
